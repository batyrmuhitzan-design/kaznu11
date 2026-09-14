"""Campus Hub —— 校园墙 / 社团活动 / 全局紧急通知。

隐私约定（与评价体系保持一致）
--------------------------------
* 匿名帖子 / 评论的响应里**不含**作者 id、学号、显示名；只有 ``is_anonymous=True``
  和粗粒度的 ``department_tag``（App 里既有的"公开身份"就是院系标签）；
* 点赞只落 ``liker_hash``（HMAC of Univer 账号），不可反查身份。

响应格式统一
------------
* 列表型接口统一返回 ``Page[T]`` 信封：``{items,total,limit,offset,has_more}``；
* 创建型接口返回 ``{message, post|comment}``；
* 单条查询（最新通知）返回对象或 ``null``。

违规内容由 ``is_hidden`` 软下架：公开列表只返回未下架的帖子，
管理员在 /admin 里一键隐藏 / 恢复即可。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from ..database import get_session
from ..deps import get_current_user, get_optional_user, limiter
from ..models import (
    POST_CATEGORIES,
    ClubEvent,
    GlobalNotification,
    Post,
    PostComment,
    PostLike,
    User,
)
from ..schemas import (
    ClubEventOut,
    CommentCreated,
    CommentIn,
    CommentOut,
    GlobalNotificationOut,
    LikeOut,
    Page,
    PostAuthorOut,
    PostCreated,
    PostIn,
    PostOut,
)
from ..security import anonymous_hash

router = APIRouter(tags=["campus"])

_POST_MSG = "Posted to the campus wall."
_COMMENT_MSG = "Comment added."
_LIKE_ADDED = "Liked."
_LIKE_REMOVED = "Like removed."


def _author_out(user: User | None, is_anonymous: bool) -> PostAuthorOut:
    """作者信息脱敏。

    匿名帖 / 匿名评论：``name`` 与 ``department_tag`` **都不返回**。

    这一点与评价体系**刻意不同**：评价的公开身份就是院系标签（评分需要粗粒度上下文
    才有参考价值），而校园墙的帖子配上院系标签会显著缩小匿名范围
    （"这节课 + 这个院"往往就能定位到人），所以这里连院系标签一并隐藏。
    """
    if is_anonymous:
        return PostAuthorOut(is_anonymous=True, name=None, department_tag=None)
    return PostAuthorOut(
        is_anonymous=False,
        name=user.global_display_name if user else None,
        department_tag=user.department_tag if user else None,
    )


def _to_post_out(post: Post, *, comment_count: int = 0, liked: bool = False) -> PostOut:
    return PostOut(
        id=post.id,
        category=post.category,
        content=post.content,
        media_urls=list(post.media_urls or []),
        is_anonymous=post.is_anonymous,
        author=_author_out(post.author, post.is_anonymous),
        likes_count=post.likes_count or 0,
        comment_count=comment_count,
        liked=liked,
        created_at=post.created_at,
    )


def _to_comment_out(comment: PostComment) -> CommentOut:
    return CommentOut(
        id=comment.id,
        post_id=comment.post_id,
        content=comment.content,
        is_anonymous=comment.is_anonymous,
        author=_author_out(comment.author, comment.is_anonymous),
        created_at=comment.created_at,
    )


async def _comment_counts(session: AsyncSession, post_ids: list[str]) -> dict[str, int]:
    """一次分组查询拿到多篇帖子的评论数（避免 N+1）。"""
    if not post_ids:
        return {}
    rows = await session.execute(
        select(PostComment.post_id, func.count(PostComment.id))
        .where(PostComment.post_id.in_(post_ids))
        .group_by(PostComment.post_id)
    )
    return {post_id: count for post_id, count in rows.all()}


async def _liked_ids(session: AsyncSession, post_ids: list[str], viewer: User | None) -> set[str]:
    """当前请求者赞过哪些帖子（未登录 → 空集合）。"""
    if not post_ids or viewer is None:
        return set()
    rows = await session.scalars(
        select(PostLike.post_id).where(
            PostLike.post_id.in_(post_ids),
            PostLike.liker_hash == anonymous_hash(viewer.univer_username),
        )
    )
    return set(rows.all())


@router.get("/posts", response_model=Page[PostOut])
async def list_posts(
    category: str | None = Query(default=None, description="按分类过滤；省略或 all = 全部"),
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    viewer: User | None = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
) -> Page[PostOut]:
    """校园墙信息流（公开，无需登录；被下架的帖子不出现）。"""
    clause = [Post.is_hidden.is_(False)]
    if category and category.strip().lower() != "all":
        normalized = category.strip().lower()
        if normalized not in POST_CATEGORIES:
            raise HTTPException(
                status_code=400, detail=f"category 必须是 {list(POST_CATEGORIES)} 之一"
            )
        clause.append(Post.category == normalized)

    total = await session.scalar(select(func.count(Post.id)).where(*clause)) or 0
    rows = (
        await session.scalars(
            select(Post)
            .options(joinedload(Post.author))
            .where(*clause)
            .order_by(Post.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()

    ids = [p.id for p in rows]
    counts = await _comment_counts(session, ids)
    liked = await _liked_ids(session, ids, viewer)

    items = [
        _to_post_out(p, comment_count=counts.get(p.id, 0), liked=p.id in liked) for p in rows
    ]
    return Page(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        has_more=offset + len(items) < total,
    )


@router.post("/posts", response_model=PostCreated, status_code=201)
@limiter.limit("6/minute")
async def create_post(
    request: Request,
    payload: PostIn,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PostCreated:
    """发帖（需登录）。支持匿名与图片/视频外链。"""
    post = Post(
        user_id=current.id,
        is_anonymous=payload.is_anonymous,
        category=payload.category,
        content=payload.content,
        media_urls=payload.media_urls or None,
    )
    session.add(post)
    await session.commit()
    await session.refresh(post)

    post = await session.scalar(
        select(Post).options(joinedload(Post.author)).where(Post.id == post.id)
    )
    return PostCreated(message=_POST_MSG, post=_to_post_out(post))


@router.post("/posts/{post_id}/like", response_model=LikeOut)
@limiter.limit("30/minute")
async def toggle_post_like(
    request: Request,
    post_id: str,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> LikeOut:
    """点赞 / 取消赞（同一账号再点一次即取消）。"""
    post = await session.scalar(select(Post).where(Post.id == post_id, Post.is_hidden.is_(False)))
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")

    liker = anonymous_hash(current.univer_username)
    existing = await session.scalar(
        select(PostLike).where(PostLike.post_id == post.id, PostLike.liker_hash == liker)
    )
    if existing is not None:
        await session.delete(existing)
        post.likes_count = max(0, (post.likes_count or 0) - 1)
        liked, message = False, _LIKE_REMOVED
    else:
        session.add(PostLike(post_id=post.id, liker_hash=liker))
        post.likes_count = (post.likes_count or 0) + 1
        liked, message = True, _LIKE_ADDED

    await session.commit()
    return LikeOut(id=post.id, likes_count=post.likes_count, liked=liked, message=message)


@router.get("/posts/{post_id}/comments", response_model=Page[CommentOut])
async def list_post_comments(
    post_id: str,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> Page[CommentOut]:
    """某篇帖子的评论（公开，按时间正序 = 楼层顺序）。"""
    post = await session.scalar(select(Post).where(Post.id == post_id, Post.is_hidden.is_(False)))
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")

    total = (
        await session.scalar(
            select(func.count(PostComment.id)).where(PostComment.post_id == post_id)
        )
        or 0
    )
    rows = (
        await session.scalars(
            select(PostComment)
            .options(joinedload(PostComment.author))
            .where(PostComment.post_id == post_id)
            .order_by(PostComment.created_at.asc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    items = [_to_comment_out(c) for c in rows]
    return Page(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        has_more=offset + len(items) < total,
    )


@router.post("/posts/{post_id}/comments", response_model=CommentCreated, status_code=201)
@limiter.limit("12/minute")
async def create_post_comment(
    request: Request,
    post_id: str,
    payload: CommentIn,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CommentCreated:
    """评论 / 回复（需登录，可匿名）。"""
    post = await session.scalar(select(Post).where(Post.id == post_id, Post.is_hidden.is_(False)))
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")

    comment = PostComment(
        post_id=post.id,
        user_id=current.id,
        is_anonymous=payload.is_anonymous,
        content=payload.content,
    )
    session.add(comment)
    await session.commit()
    await session.refresh(comment)

    comment = await session.scalar(
        select(PostComment)
        .options(joinedload(PostComment.author))
        .where(PostComment.id == comment.id)
    )
    return CommentCreated(message=_COMMENT_MSG, comment=_to_comment_out(comment))


@router.get("/club-events", response_model=Page[ClubEventOut])
async def list_club_events(
    club_name: str | None = Query(default=None, description="按社团名过滤"),
    include_past: bool = Query(default=False, description="true = 连已结束的活动一起返回"),
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> Page[ClubEventOut]:
    """社团 / 讲座活动列表（公开）。

    只返回 ``is_approved=True`` 的活动 —— 社团提交的内容必须先在 /admin 审核通过。
    """
    from datetime import datetime, timedelta, timezone

    clause = [ClubEvent.is_approved.is_(True)]
    if club_name:
        clause.append(ClubEvent.club_name == club_name)
    if not include_past:
        # 留 6 小时缓冲：正在进行中的活动不立刻消失
        clause.append(ClubEvent.event_time >= datetime.now(timezone.utc) - timedelta(hours=6))

    total = await session.scalar(select(func.count(ClubEvent.id)).where(*clause)) or 0
    rows = (
        await session.scalars(
            select(ClubEvent)
            .where(*clause)
            .order_by(ClubEvent.event_time.asc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return Page(
        items=[ClubEventOut.model_validate(e) for e in rows],
        total=total,
        limit=limit,
        offset=offset,
        has_more=offset + len(rows) < total,
    )


@router.get("/notifications/latest", response_model=GlobalNotificationOut | None)
async def latest_notification(
    session: AsyncSession = Depends(get_session),
) -> GlobalNotificationOut | None:
    """当前生效的全球紧急通知（没有则返回 null，前端据此隐藏顶部 Banner）。"""
    row = await session.scalar(
        select(GlobalNotification)
        .where(GlobalNotification.is_active.is_(True))
        .order_by(GlobalNotification.created_at.desc())
        .limit(1)
    )
    return GlobalNotificationOut.model_validate(row) if row is not None else None
