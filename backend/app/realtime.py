"""WebSocket 实时连接管理（私信实时收发 / 通知即时到达）。

单进程 in-process 实现：``dict[user_id, set[WebSocket]]``。
**一个用户可能有多台设备同时在线**，所以值是集合而不是单个连接。

⚠️ 横向扩容说明（与 ``live_activity_scheduler`` 同一套取舍）：
本项目部署是单 uvicorn worker，进程内字典完全够用。若以后扩到多 worker / 多机，
需要把 ``send_to_user`` / ``broadcast`` 换成 Redis Pub/Sub 中转
（否则 A 用户的连接在 worker-1、消息却由 worker-2 处理，就推不过去）。
接口签名已按这个方向设计：发送方只给 user_id，不关心连接在哪。
"""
from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import WebSocket


class ConnectionManager:
    """按用户维护 WebSocket 连接，并支持向单个用户或全体推送。"""

    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = {}
        #: 保护 _connections 的并发修改（同一次广播里多任务写入）
        self._lock = asyncio.Lock()
        self.delivered = 0
        self.dropped = 0

    # ------------------------------------------------------------- 生命周期

    async def connect(self, user_id: str, websocket: WebSocket) -> None:
        """接受连接并登记（调用方负责先 ``await websocket.accept()``）。"""
        async with self._lock:
            self._connections.setdefault(user_id, set()).add(websocket)

    async def disconnect(self, user_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            bucket = self._connections.get(user_id)
            if bucket is None:
                return
            bucket.discard(websocket)
            if not bucket:
                self._connections.pop(user_id, None)

    def online(self, user_id: str) -> bool:
        """该用户是否有任意设备在线（用于决定要不要发离线推送）。"""
        return bool(self._connections.get(user_id))

    def online_users(self) -> list[str]:
        return list(self._connections.keys())

    @property
    def connection_count(self) -> int:
        return sum(len(bucket) for bucket in self._connections.values())

    # ---------------------------------------------------------------- 发送

    async def send_to_user(self, user_id: str, payload: dict[str, Any]) -> int:
        """给某个用户的所有在线设备发一条事件；返回成功投递的连接数。

        发送失败的连接（客户端已断开但服务端还没收到 close）直接摘掉，避免内存泄漏。
        """
        async with self._lock:
            targets = list(self._connections.get(user_id, ()))
        if not targets:
            return 0

        text = json.dumps(payload, ensure_ascii=False, default=str)
        # default=str 是**安全网**：万一某个字段不是 JSON 原生类型（例如有人把 Pydantic
        # 对象直接塞进帧里），也只把这一个字段字符串化，而不会抛异常把这条连接整个关掉。
        # 正常路径上一个都不该命中（各 payload 都用 model_dump(mode="json") 产出）。
        delivered = 0
        for websocket in targets:
            try:
                await websocket.send_text(text)
                delivered += 1
            except Exception:  # 连接已断 / 缓冲满
                await self.disconnect(user_id, websocket)
                self.dropped += 1
        self.delivered += delivered
        return delivered

    async def broadcast(self, payload: dict[str, Any]) -> int:
        """给所有在线用户推送（全校广播的"在线部分"；离线用户走 APNs）。"""
        async with self._lock:
            user_ids = list(self._connections.keys())
        results = await asyncio.gather(
            *(self.send_to_user(uid, payload) for uid in user_ids), return_exceptions=True
        )
        return sum(r for r in results if isinstance(r, int))


#: 进程内单例（chat 路由与 notifications 路由共用）
manager = ConnectionManager()
