"""私信 Chat —— REST（历史 / 发送 / 已读）+ WebSocket（实时收发）。

为什么 REST 与 WS 并存
---------------------
* 进入会话要先看到**历史** —— 请求/响应最自然 → REST；
* 在线时新消息要**秒到** → WebSocket；
* WS 断了（地铁里、切后台被系统回收）时发送不能丢 —— 前端自动降级为 REST 发送。
  两个入口共用同一个 ``persist_message()``，所以落库 / 去重 / 推送逻辑只有一份。

WebSocket 鉴权
-------------
浏览器 WebSocket **不能自定义 Header**，token 只能走 query string
(``/api/v1/ws/chat?token=...``)。因此：

* 连接建立时校验一次（token 无效 / 账号被封 → 4401 关闭，前端据此提示重新登录）；
* query 里的 token 会进访问日志 → 生产建议在反代（nginx）对 ``/api/v1/ws/``
  关闭 query 记录，或改用一次性 ticket（当前部署未开）。

未读与已读
----------
``Message.read_at`` 是**接收方**读到的时间。标记已读会把该会话所有"发给我的未读"
刷成已读，并通过 WS 回执给对方。
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Request,
    WebSocket,
    WebSocketDisconnect,
)
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import SessionLocal, get_session
from ..deps import get_current_user, limiter
from ..models import (
    MESSAGE_MAX_LEN,
    MESSAGE_MAX_MEDIA,
    Conversation,
    Message,
    User,
)
from ..push import notify_user
from ..push_payload import snippet, text as push_text
from ..realtime import manager
from ..schemas import (
    ChatPeerOut,
    ConversationCreated,
    ConversationOut,
    MarkReadIn,
    MessageCreated,
    MessageIn,
    MessageOut,
    Page,
    ReadResultOut,
    StartConversationIn,
    UnreadCountOut,
)
from ..security import decode_access_token

router = APIRouter(tags=["chat"])

OPENED_MSG = "Conversation ready."
SENT_MSG = "Message sent."


# =====================================================================
# 序列化
# =====================================================================


def _peer_out(user: User) -> ChatPeerOut:
    return ChatPeerOut(
        id=user.id,
        display_name=user.global_display_name,
        department_tag=user.department_tag,
    )


def _message_out(message: Message, viewer_id: str) -> MessageOut:
    return MessageOut(
        id=message.id,
        conversation_id=message.conversation_id,
        sender_id=message.sender_id,
        body=message.body or "",
        media_urls=list(message.media_urls or []),
        client_id=message.client_id,
        read_at=message.read_at,
        is_deleted=bool(message.is_deleted),
        created_at=message.created_at,
        is_mine=message.sender_id == viewer_id,
    )


def _message_payload(message: Message, viewer_id: str) -> dict:
    """WebSocket 帧专用的消息字典。

    ⚠️ 必须 ``model_dump(mode="json")``：REST 响应由 FastAPI 负责序列化，
    但 WS 是我们自己 ``json.dumps`` —— 直接把 Pydantic 对象丢进去会抛
    ``TypeError: Object of type MessageOut is not JSON serializable``，
    而该异常发生在 WS 处理器里 → 连接被关掉、消息也发不出去（踩过）。
    ``mode="json"`` 还会把 ``datetime`` 转成 ISO 字符串，两端格式与 REST 一致。
    """
    return _message_out(message, viewer_id).model_dump(mode="json")


async def _unread_by_conversation(
    session: AsyncSession, viewer_id: str, conversation_ids: list[str]
) -> dict[str, int]:
    """一次分组查询拿到多个会话的未读数（避免 N+1）。"""
    if not conversation_ids:
        return {}
    rows = await session.execute(
        select(Message.conversation_id, func.count(Message.id))
        .where(
            Message.conversation_id.in_(conversation_ids),
            Message.sender_id != viewer_id,
            Message.read_at.is_(None),
            Message.is_deleted.is_(False),
        )
        .group_by(Message.conversation_id)
    )
    return {conversation_id: count for conversation_id, count in rows.all()}


async def _conversation_out(
    session: AsyncSession, conversation: Conversation, viewer: User
) -> ConversationOut:
    peer_id = conversation.peer_of(viewer.id)
    peer = await session.get(User, peer_id)
    unread = await _unread_by_conversation(session, viewer.id, [conversation.id])
    return ConversationOut(
        id=conversation.id,
        peer=_peer_out(peer) if peer else ChatPeerOut(id=peer_id, display_name="—"),
        last_message_preview=conversation.last_message_preview or "",
        last_message_at=conversation.last_message_at,
        last_sender_id=conversation.last_sender_id,
        unread_count=unread.get(conversation.id, 0),
        created_at=conversation.created_at,
    )


async def _load_conversation(
    session: AsyncSession, conversation_id: str, viewer: User
) -> Conversation:
    """取会话并**校验访问权**。

    不是参与者一律 404（而不是 403）—— 403 会暴露"这个会话 id 存在"。
    """
    conversation = await session.get(Conversation, conversation_id)
    if conversation is None or viewer.id not in (conversation.user_a_id, conversation.user_b_id):
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


# =====================================================================
# 核心：落库 + 扇出（REST 与 WebSocket 共用）
# =====================================================================


async def persist_message(
    session: AsyncSession,
    *,
    conversation: Conversation,
    sender: User,
    body: str,
    media_urls: list[str] | None = None,
    client_id: str | None = None,
) -> tuple[Message, bool]:
    """把一条私信落库并更新会话摘要。返回 ``(message, created)``。

    ``created=False`` 表示这次是**幂等重发**（``client_id`` 已存在）：
    直接把老消息还回去，不产生第二个气泡、也不重复通知对方。
    """
    clean_body = (body or "").strip()
    media = [u for u in (media_urls or []) if isinstance(u, str) and u.strip()][:MESSAGE_MAX_MEDIA]
    if not clean_body and not media:
        raise HTTPException(status_code=400, detail="消息不能为空（文字或图片至少一个）")
    if len(clean_body) > MESSAGE_MAX_LEN:
        raise HTTPException(status_code=400, detail=f"消息超过 {MESSAGE_MAX_LEN} 字上限")

    if client_id:
        existing = await session.scalar(
            select(Message).where(
                Message.conversation_id == conversation.id,
                Message.client_id == client_id,
            )
        )
        if existing is not None:
            return existing, False

    message = Message(
        conversation_id=conversation.id,
        sender_id=sender.id,
        body=clean_body,
        media_urls=media or None,
        client_id=client_id,
    )
    session.add(message)

    conversation.last_message_at = datetime.now(timezone.utc)
    conversation.last_message_preview = snippet(clean_body or "📷", 120)
    conversation.last_sender_id = sender.id
    await session.commit()
    await session.refresh(message)
    return message, True


async def fan_out_message(session: AsyncSession, *, conversation: Conversation, message: Message) -> None:
    """把新消息推给双方：接收方（在线 → WS / 离线 → APNs）+ 发送方多设备回显。"""
    sender = await session.get(User, message.sender_id)
    recipient_id = conversation.peer_of(message.sender_id)

    # 双方看到的 is_mine 不同，所以各构造一份（必须是 dict，见 _message_payload）
    delivered = await manager.send_to_user(
        recipient_id, {"type": "message", "message": _message_payload(message, recipient_id)}
    )
    await manager.send_to_user(
        message.sender_id,
        {"type": "message", "message": _message_payload(message, message.sender_id)},
    )

    actor = sender.global_display_name if sender else "—"
    preview = snippet(message.body or "📷")
    await notify_user(
        session,
        user_id=recipient_id,
        kind="message",
        title=push_text("EN", "message_title"),
        body=push_text("EN", "message_body", actor=actor, snippet=preview),
        # 推送文案按**每台设备**的语言渲染（同一用户可能一台英文机一台俄文机）
        text_for=lambda locale: (
            push_text(locale, "message_title"),
            push_text(locale, "message_body", actor=actor, snippet=preview),
        ),
        route="chat",
        route_id=conversation.id,
        actor_name=actor,
        # 上面已经把消息帧发出去了：不要再发 notification 帧（重复），但仍要据此判断"在线"
        already_delivered=delivered,
    )


async def mark_conversation_read(
    session: AsyncSession, *, conversation: Conversation, reader: User
) -> int:
    """把"发给我的未读"全部标记已读，返回标记条数。"""
    result = await session.execute(
        update(Message)
        .where(
            Message.conversation_id == conversation.id,
            Message.sender_id != reader.id,
            Message.read_at.is_(None),
        )
        .values(read_at=datetime.now(timezone.utc))
    )
    await session.commit()
    marked = result.rowcount or 0
    if marked:
        # 已读回执给对方（UI 显示"已读"）
        await manager.send_to_user(
            conversation.peer_of(reader.id),
            {
                "type": "read",
                "conversation_id": conversation.id,
                "reader_id": reader.id,
                "at": datetime.now(timezone.utc).isoformat(),
            },
        )
    return marked


async def unread_message_count(session: AsyncSession, user_id: str) -> int:
    """所有会话里"发给我的未读"总数（头部入口的红点用它）。"""
    conversations = await session.scalars(
        select(Conversation.id).where(
            or_(Conversation.user_a_id == user_id, Conversation.user_b_id == user_id)
        )
    )
    ids = list(conversations.all())
    if not ids:
        return 0
    total = await session.scalar(
        select(func.count(Message.id)).where(
            Message.conversation_id.in_(ids),
            Message.sender_id != user_id,
            Message.read_at.is_(None),
            Message.is_deleted.is_(False),
        )
    )
    return int(total or 0)


# =====================================================================
# REST 端点
# =====================================================================


@router.get("/chat/conversations", response_model=Page[ConversationOut])
async def list_conversations(
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Page[ConversationOut]:
    """我的会话列表（按最后一条消息时间倒序）。

    一次批量取 peer + 未读数，避免"列表里每条会话各查一次用户/各查一次未读"的 N+1。
    """
    mine = or_(Conversation.user_a_id == current.id, Conversation.user_b_id == current.id)
    total = await session.scalar(select(func.count(Conversation.id)).where(mine)) or 0
    rows = (
        await session.scalars(
            select(Conversation)
            .where(mine)
            .order_by(Conversation.last_message_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()

    peer_ids = [conversation.peer_of(current.id) for conversation in rows]
    peers: dict[str, User] = {}
    if peer_ids:
        peers = {
            user.id: user
            for user in (await session.scalars(select(User).where(User.id.in_(peer_ids)))).all()
        }
    unread = await _unread_by_conversation(session, current.id, [c.id for c in rows])

    items = []
    for conversation in rows:
        peer_id = conversation.peer_of(current.id)
        peer = peers.get(peer_id)
        items.append(
            ConversationOut(
                id=conversation.id,
                peer=_peer_out(peer) if peer else ChatPeerOut(id=peer_id, display_name="—"),
                last_message_preview=conversation.last_message_preview or "",
                last_message_at=conversation.last_message_at,
                last_sender_id=conversation.last_sender_id,
                unread_count=unread.get(conversation.id, 0),
                created_at=conversation.created_at,
            )
        )
    return Page[ConversationOut](
        items=items,
        total=int(total),
        limit=limit,
        offset=offset,
        has_more=offset + len(items) < int(total),
    )


@router.post("/chat/conversations", response_model=ConversationCreated, status_code=201)
async def start_conversation(
    payload: StartConversationIn,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ConversationCreated:
    """开启（或取回已存在的）与某位用户的私信会话。

    **幂等**：同一对用户无论点多少次都只有一条会话（规范化 (a, b) + 唯一约束）。
    支持 ``peer_id``（从会话/评论点进来）与 ``peer_username``（从帖子作者点进来）。
    """
    peer: User | None = None
    if payload.peer_id:
        peer = await session.get(User, payload.peer_id)
    elif payload.peer_username:
        peer = await session.scalar(
            select(User).where(User.univer_username == payload.peer_username.strip())
        )
    if peer is None:
        raise HTTPException(status_code=404, detail="User not found")
    if peer.id == current.id:
        raise HTTPException(status_code=400, detail="不能和自己私信")
    if peer.is_banned:
        raise HTTPException(status_code=403, detail="对方账号已停用")

    user_a_id, user_b_id = Conversation.ordered(current.id, peer.id)
    conversation = await session.scalar(
        select(Conversation).where(
            Conversation.user_a_id == user_a_id, Conversation.user_b_id == user_b_id
        )
    )
    if conversation is None:
        conversation = Conversation(user_a_id=user_a_id, user_b_id=user_b_id)
        session.add(conversation)
        await session.commit()
        await session.refresh(conversation)

    return ConversationCreated(
        message=OPENED_MSG,
        conversation=await _conversation_out(session, conversation, current),
    )


@router.get("/chat/conversations/{conversation_id}/messages", response_model=Page[MessageOut])
async def list_messages(
    conversation_id: str,
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0, description="跳过最新的 N 条（往上翻历史）"),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Page[MessageOut]:
    """会话消息（**按时间倒序分页**：offset=0 就是最新一页）。

    客户端拿到后 reverse 一次即可按时间正序渲染；继续往上翻历史就 ``offset += limit``。
    这样天然复用 ``Page[T]`` 信封，不需要再造一套 "before cursor" 协议。
    """
    conversation = await _load_conversation(session, conversation_id, current)
    base = [Message.conversation_id == conversation.id, Message.is_deleted.is_(False)]
    total = await session.scalar(select(func.count(Message.id)).where(*base)) or 0
    rows = (
        await session.scalars(
            select(Message)
            .where(*base)
            .order_by(Message.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    items = [_message_out(message, current.id) for message in rows]
    return Page[MessageOut](
        items=items,
        total=int(total),
        limit=limit,
        offset=offset,
        has_more=offset + len(items) < int(total),
    )


@router.post(
    "/chat/conversations/{conversation_id}/messages",
    response_model=MessageCreated,
    status_code=201,
)
@limiter.limit("60/minute")
async def send_message(
    request: Request,
    conversation_id: str,
    payload: MessageIn,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MessageCreated:
    """REST 发送消息。

    WebSocket 断开时前端自动降级走这里 —— 两条通路共用 ``persist_message()``，
    所以幂等（``client_id``）、会话摘要更新、离线推送的行为完全一致，不会分叉。
    """
    conversation = await _load_conversation(session, conversation_id, current)
    message, created = await persist_message(
        session,
        conversation=conversation,
        sender=current,
        body=payload.body,
        media_urls=payload.media_urls,
        client_id=payload.client_id,
    )
    if created:
        await fan_out_message(session, conversation=conversation, message=message)
    return MessageCreated(message=SENT_MSG, sent=_message_out(message, current.id))


@router.post("/chat/read", response_model=ReadResultOut)
async def mark_read(
    payload: MarkReadIn,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ReadResultOut:
    """进入会话时清零未读（并把已读回执发给对方）。"""
    conversation = await _load_conversation(session, payload.conversation_id, current)
    marked = await mark_conversation_read(session, conversation=conversation, reader=current)
    return ReadResultOut(message="Marked as read.", marked=marked)


@router.get("/chat/unread-count", response_model=UnreadCountOut)
async def chat_unread_count(
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UnreadCountOut:
    """私信未读数（头部消息入口红点的兜底轮询；主通路是 WebSocket 事件）。"""
    messages = await unread_message_count(session, current.id)
    return UnreadCountOut(messages=messages, notifications=0, total=messages)


# =====================================================================
# WebSocket 实时通道
# =====================================================================

#: 应用级关闭码（WebSocket 规范保留 4000-4999 给应用自定义）
WS_UNAUTHORIZED = 4401


async def _authenticate_ws(token: str | None) -> User | None:
    """校验 WebSocket 的 token（只能走 query string），失败返回 None。"""
    if not token:
        return None
    payload = decode_access_token(token)
    if not payload or not payload.get("uid"):
        return None
    async with SessionLocal() as session:
        user = await session.get(User, payload["uid"])
    if user is None or user.is_banned:
        return None
    return user


async def _handle_ws_event(
    session: AsyncSession, websocket: WebSocket, user: User, raw: str
) -> None:
    """处理一条客户端事件（协议见 ``chat_socket`` 的 docstring）。"""
    try:
        event = json.loads(raw)
    except json.JSONDecodeError:
        await websocket.send_json({"type": "error", "reason": "bad-json"})
        return
    if not isinstance(event, dict):
        await websocket.send_json({"type": "error", "reason": "bad-event"})
        return

    kind = str(event.get("type") or "").lower()
    if kind == "ping":
        # 心跳：移动网络下长时间无数据会被运营商 NAT 掐断，客户端定时 ping 保活
        await websocket.send_json({"type": "pong"})
        return

    conversation_id = str(event.get("conversation_id") or "")
    if not conversation_id:
        await websocket.send_json({"type": "error", "reason": "missing-conversation"})
        return

    try:
        conversation = await _load_conversation(session, conversation_id, user)
    except HTTPException:
        await websocket.send_json({"type": "error", "reason": "conversation-not-found"})
        return

    if kind == "read":
        marked = await mark_conversation_read(session, conversation=conversation, reader=user)
        await websocket.send_json(
            {"type": "read-ack", "conversation_id": conversation.id, "marked": marked}
        )
        return

    if kind == "typing":
        # 只转发给对端；输入状态不需要落库
        await manager.send_to_user(
            conversation.peer_of(user.id),
            {"type": "typing", "conversation_id": conversation.id, "user_id": user.id},
        )
        return

    if kind != "send":
        await websocket.send_json({"type": "error", "reason": "unknown-event", "event": kind})
        return

    media = event.get("media_urls") or []
    if not isinstance(media, list):
        media = []
    try:
        message, created = await persist_message(
            session,
            conversation=conversation,
            sender=user,
            body=str(event.get("body") or ""),
            media_urls=[str(url) for url in media],
            client_id=str(event["client_id"]) if event.get("client_id") else None,
        )
    except HTTPException as exc:
        await websocket.send_json(
            {"type": "error", "reason": "rejected", "detail": str(exc.detail)}
        )
        return

    if created:
        # 发送方也会收到 type=message 的广播回显（多设备同步），所以这里不用再回 ack
        await fan_out_message(session, conversation=conversation, message=message)


@router.websocket("/ws/chat")
async def chat_socket(websocket: WebSocket, token: str | None = Query(default=None)) -> None:
    """私信实时通道（一个用户可同时开多条连接 = 多台设备）。

    **客户端 → 服务端**：

        {"type":"send","conversation_id":…,"body":…,"media_urls":[…],"client_id":…}
        {"type":"read","conversation_id":…}
        {"type":"typing","conversation_id":…}
        {"type":"ping"}

    **服务端 → 客户端**：

        {"type":"ready","user_id":…,"unread":n}         连接就绪（带上未读数）
        {"type":"message","message":{…}}                新消息（含多设备回显）
        {"type":"read","conversation_id":…,"reader_id":…}  对方已读回执
        {"type":"read-ack","conversation_id":…,"marked":n} 自己标记已读的确认
        {"type":"typing","conversation_id":…,"user_id":…}
        {"type":"pong"} / {"type":"error","reason":…}

    鉴权失败会以 ``4401`` 关闭（前端收到就清 token 并提示重新登录）。
    """
    user = await _authenticate_ws(token)
    if user is None:
        # accept 之前关闭 → 握手直接失败，客户端 onclose 能拿到 4401
        await websocket.close(code=WS_UNAUTHORIZED)
        return

    await websocket.accept()
    await manager.connect(user.id, websocket)

    #: 每条连接一个会话：WS 是长连接，事件顺序处理，这样最省连接数
    async with SessionLocal() as session:
        try:
            await websocket.send_json(
                {
                    "type": "ready",
                    "user_id": user.id,
                    "unread": await unread_message_count(session, user.id),
                }
            )
            while True:
                raw = await websocket.receive_text()
                await _handle_ws_event(session, websocket, user, raw)
        except WebSocketDisconnect:
            pass  # 正常断开（切后台 / 网络切换）
        except Exception as exc:  # noqa: BLE001 - 单条连接异常不能影响其它连接
            print(f"[kaznu] ⚠️ chat WS 异常: {type(exc).__name__}: {exc}")
        finally:
            await manager.disconnect(user.id, websocket)
