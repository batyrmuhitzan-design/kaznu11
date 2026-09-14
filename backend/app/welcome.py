"""首次登录的欢迎私信 —— 让私信功能"开箱可见"。

为什么放在后端而不是前端造几条假数据
------------------------------------
私信的核心是"**对方真的存在、消息真的过了一遍服务端**"：落库、未读数、WebSocket 帧、
离线推送缺一不可。前端造假消息只能看个气泡样式，发出去就露馅（对方根本不存在）。
所以这里用 seed 里已有的演示学生 `demo.dana@student.kaznu.kz` 当"校园助手"，
在新用户**首次登录**时真发一条私信 —— 消息真实入库，未读数红点、会话列表、
气泡渲染、图片气泡全部走真实链路。

关掉它：`DEMO_WELCOME_DM=0`（生产环境应该关掉；这里默认开着，因为整套 App 是演示构建）。

幂等：同一对用户之间只要有任意消息就不再发，避免重复登录刷屏。
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .models import Conversation, Message, User
from .push_payload import snippet

#: "校园助手"账号（seed 里的演示学生，已带头像语义的显示名 dana_k）
ASSISTANT_USERNAME = "demo.dana@student.kaznu.kz"

#: 欢迎消息：两条文字 + 一条图片 —— 正好覆盖两种气泡的渲染
WELCOME_MESSAGES: list[dict] = [
    {
        "body": (
            "Hey! 👋 This is the Campus Assistant. Welcome to KazNU Helper.\n"
            "You can reply right here — messages are delivered in real time."
        ),
        "media": [],
    },
    {
        "body": "This is how a photo message looks 👇 (tap it to open full screen)",
        "media": ["https://picsum.photos/seed/kaznu-chat-welcome/900/600"],
    },
    {
        "body": (
            "Two tips: any campus post with a real name has a ✉️ Message button, "
            "and university announcements land in the 🔔 bell (and in this chat list).\n"
            "（这是服务器端模拟账号发来的真实私信，用于演示收发 / 未读红点 / 图片气泡）"
        ),
        "media": [],
    },
]


async def _assistant(session: AsyncSession) -> User | None:
    return await session.scalar(select(User).where(User.univer_username == ASSISTANT_USERNAME))


async def send_welcome_dm(session: AsyncSession, user: User) -> bool:
    """给新用户发欢迎私信。

    @returns 是否真的发了（未开启 / 找不到助手 / 已有历史 / 出错 → False）

    ⚠️ 任何异常都在这里吞掉：登录是主流程，欢迎私信只是锦上添花，
    绝不能因为"助手账号被删了"就让用户登不进来。
    """
    if not settings.demo_welcome_dm:
        return False
    try:
        assistant = await _assistant(session)
        if assistant is None or assistant.id == user.id:
            return False

        user_a_id, user_b_id = Conversation.ordered(assistant.id, user.id)
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

        # 幂等：已有消息说明不是第一次，直接跳过
        existing = await session.scalar(
            select(Message).where(Message.conversation_id == conversation.id).limit(1)
        )
        if existing is not None:
            return False

        now = datetime.now(timezone.utc)
        last_at = now
        for index, item in enumerate(WELCOME_MESSAGES):
            sent_at = now + timedelta(seconds=index)
            session.add(
                Message(
                    conversation_id=conversation.id,
                    sender_id=assistant.id,
                    body=item["body"],
                    media_urls=item["media"] or None,
                    created_at=sent_at,
                )
            )
            last_at = sent_at

        conversation.last_message_at = last_at
        conversation.last_sender_id = assistant.id
        conversation.last_message_preview = snippet(WELCOME_MESSAGES[-1]["body"], 120)
        await session.commit()
        return True
    except Exception as exc:  # noqa: BLE001
        await session.rollback()
        print(f"[kaznu] ⚠️ 欢迎私信发送失败（已忽略，不影响登录）: {type(exc).__name__}: {exc}")
        return False