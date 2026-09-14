/**
 * Campus Hub —— 类型定义 + 离线演示数据。
 *
 * 类型与后端 `backend/app/schemas.py` 的 Campus Hub 部分**一一对应**：
 *   CampusPost        ← PostOut
 *   CampusComment     ← CommentOut
 *   ClubEventItem     ← ClubEventOut
 *   CampusNotificationItem ← GlobalNotificationOut
 *   Page<T>           ← Page[T]（统一分页信封）
 *
 * 这里的 DEMO_* 是**离线回退数据**：与后端 seed 的内容保持一致，
 * 服务器不可达时 App 仍能完整演示校园墙 / 活动 / 紧急通知。
 */
export type PostCategory =
  | "course_review"
  | "lost_found"
  | "housing"
  | "hackathon"
  | "club"
  | "general";

/** 作者信息：匿名帖的 name 恒为 null（后端不返回匿名作者身份）。
 *  ``id`` 同样是**仅实名帖**才有 —— 前端拿它做"私信作者"入口（peer_id）；匿名帖给了
 *  id 就等于把匿名废掉，所以后端对匿名帖一律返回 null。 */
export interface CampusAuthor {
  is_anonymous: boolean;
  name: string | null;
  department_tag: string | null;
  id?: string | null;
}

export interface CampusPost {
  id: string;
  category: PostCategory;
  content: string;
  media_urls: string[];
  is_anonymous: boolean;
  author: CampusAuthor;
  likes_count: number;
  comment_count: number;
  liked: boolean;
  /** News 融合：官方公告帖（Feed 置顶 + 官方徽章），只有 staff 能创建 */
  is_official?: boolean;
  /** 徽章 key（kaznu.official）；前端按 key 取本地化文案 */
  official_badge?: string | null;
  created_at: string;
  /** true = 本地离线创建（未同步到服务器），UI 会标注"未同步" */
  local_only?: boolean;
}

export interface CampusComment {
  id: string;
  post_id: string;
  content: string;
  is_anonymous: boolean;
  author: CampusAuthor;
  created_at: string;
  local_only?: boolean;
}

export interface ClubEventItem {
  id: string;
  club_name: string;
  title: string;
  description: string | null;
  poster_url: string | null;
  event_time: string;
  location: string | null;
  register_link: string | null;
  created_at: string;
}

export type NotificationLevel = "info" | "warning" | "danger";

export interface CampusNotificationItem {
  id: string;
  title: string;
  message: string;
  level: NotificationLevel;
  created_at: string;
}

/** 统一分页信封（与后端 Page[T] 一致）。 */
export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

/** 分类筛选条：顺序与后端 POST_CATEGORIES 一致；文案走 i18n。 */
export const CAMPUS_CATEGORIES: { id: PostCategory; emoji: string }[] = [
  { id: "course_review", emoji: "📘" },
  { id: "lost_found", emoji: "🔍" },
  { id: "housing", emoji: "🏠" },
  { id: "hackathon", emoji: "🚀" },
  { id: "club", emoji: "🎪" },
  { id: "general", emoji: "💬" },
];

/** N 小时前的 ISO 时间（演示数据用相对时间，避免写死日期过期）。 */
function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

/** N 天后的某个整点（活动时间）。 */
function daysAhead(days: number, hour: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

export const DEMO_POSTS: CampusPost[] = [
  {
    id: "demo-post-1",
    category: "course_review",
    content:
      "CS201 Data Structures (Seitkali) — 前两周一定要跟上 lab，期中之后难度陡增。板书会把每个结构画出来，期末还会给一份题型清单。想拿 A 就老老实实做 lab 3 之后的每一次练习。",
    media_urls: [],
    is_anonymous: true,
    author: { is_anonymous: true, name: null, department_tag: "Computer Science Student" },
    likes_count: 42,
    comment_count: 3,
    liked: false,
    created_at: hoursAgo(3),
  },
  {
    id: "demo-post-2",
    category: "lost_found",
    content:
      "在 4 号楼 305 教室丢了一个深蓝色保温杯（杯身有白色贴纸），大概是周三下午 3 点那节课。如果有同学看到麻烦评论一下，谢谢 🙏",
    media_urls: ["https://picsum.photos/seed/kaznu-bottle/800/520"],
    is_anonymous: true,
    author: { is_anonymous: true, name: null, department_tag: "Physics Student" },
    likes_count: 8,
    comment_count: 1,
    liked: false,
    created_at: hoursAgo(6),
  },
  {
    id: "demo-post-3",
    category: "hackathon",
    content:
      "准备组队参加 10 月的 KazNU Hackathon（赛道：智慧校园）。目前 2 人（后端 + iOS），还缺 1 个会 Figma/前端的同学。有作品集更好，没有也行，关键是能一起熬夜 😄",
    media_urls: [],
    is_anonymous: false,
    author: { is_anonymous: false, name: "dana_k", department_tag: "Computer Science Student" },
    likes_count: 27,
    comment_count: 2,
    liked: false,
    created_at: hoursAgo(9),
  },
  {
    id: "demo-post-4",
    category: "housing",
    content:
      "Кто-нибудь сдаёт комнату рядом с кампусом на зимний семестр? Ищу недалеко от Тимирязева, желательно с мебелью. Готов заселиться с 1 декабря.",
    media_urls: [],
    is_anonymous: false,
    author: { is_anonymous: false, name: "madina_s", department_tag: "Physics Student" },
    likes_count: 15,
    comment_count: 1,
    liked: false,
    created_at: hoursAgo(26),
  },
  {
    id: "demo-post-5",
    category: "club",
    content:
      "机器人社团招新啦 🤖 每周三 18:00 在 FIT 楼实验室，零基础也能来玩。做 RoboCup 备赛 + 寒假有个校级比赛，报名截止本周五。",
    media_urls: [
      "https://picsum.photos/seed/kaznu-robot/800/520",
      "https://picsum.photos/seed/kaznu-robot-2/800/520",
    ],
    is_anonymous: false,
    author: { is_anonymous: false, name: "yerlan_t", department_tag: "Applied Math Student" },
    likes_count: 33,
    comment_count: 2,
    liked: false,
    created_at: hoursAgo(30),
  },
  {
    id: "demo-post-6",
    category: "general",
    content: "图书馆 4 楼自习室今天人特别少，安静得能听见空调声。要赶 paper 的同学可以来占位 📚",
    media_urls: [],
    is_anonymous: true,
    author: { is_anonymous: true, name: null, department_tag: "Computer Science Student" },
    likes_count: 19,
    comment_count: 0,
    liked: false,
    created_at: hoursAgo(52),
  },
];

export const DEMO_COMMENTS: CampusComment[] = [
  {
    id: "demo-c-1",
    post_id: "demo-post-1",
    content: "完全同意，lab 3 之后一定要自己手写一遍",
    is_anonymous: true,
    author: { is_anonymous: true, name: null, department_tag: "Computer Science Student" },
    created_at: hoursAgo(2),
  },
  {
    id: "demo-c-2",
    post_id: "demo-post-1",
    content: "题型清单会发在 Telegram 班群里吗？",
    is_anonymous: true,
    author: { is_anonymous: true, name: null, department_tag: "Applied Math Student" },
    created_at: hoursAgo(1),
  },
  {
    id: "demo-c-3",
    post_id: "demo-post-3",
    content: "前端在这！做过两个 React 项目，私信聊",
    is_anonymous: true,
    author: { is_anonymous: true, name: null, department_tag: "Software Engineering Student" },
    created_at: hoursAgo(7),
  },
];

export const DEMO_EVENTS: ClubEventItem[] = [
  {
    id: "demo-event-1",
    club_name: "KazNU Robotics Club",
    title: "RoboCup 校内选拔赛说明会",
    description: "介绍今年 RoboCup 赛道规则、组队方式与备赛日程。零基础同学可先来旁听，现场有机器人演示。",
    poster_url: "https://picsum.photos/seed/kaznu-event-robocup/900/560",
    event_time: daysAhead(2, 18),
    location: "FIT Building · Lab 401",
    register_link: "https://kaznu.kz",
    created_at: hoursAgo(40),
  },
  {
    id: "demo-event-2",
    club_name: "Al-Farabi Debate Society",
    title: "英语辩论公开课：如何构建论证",
    description: "由校辩论队教练主讲，适合准备参加国际赛事或想提升口语与逻辑的同学。现场分组练习。",
    poster_url: "https://picsum.photos/seed/kaznu-event-debate/900/560",
    event_time: daysAhead(5, 16),
    location: "Main Building · Auditorium 2",
    register_link: "https://forms.gle/kaznu-debate-rsvp",
    created_at: hoursAgo(52),
  },
  {
    id: "demo-event-3",
    club_name: "KazNU Tech Society",
    title: "KazNU Hackathon 2026 报名启动",
    description: "48 小时线下黑客松，赛道包含智慧校园、教育科技与开放数据。提供餐食与导师，奖金池 1,000,000 ₸。",
    poster_url: "https://picsum.photos/seed/kaznu-event-hackathon/900/560",
    event_time: daysAhead(9, 10),
    location: "Innovation Hub · Floor 3",
    register_link: "https://1losion.me",
    created_at: hoursAgo(64),
  },
];

export const DEMO_NOTIFICATION: CampusNotificationItem = {
  id: "demo-notif-1",
  title: "Exam week starts Monday",
  message: "Midterm exam week runs Sep 21–26. Library opening hours are extended to 24/7 from Sunday.",
  level: "danger",
  created_at: hoursAgo(3),
};
