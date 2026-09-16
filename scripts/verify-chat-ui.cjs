#!/usr/bin/env node
/**
 * 社交模块守卫（私信 / 通知中心 / 图片上传 / 官方公告 / 推送路由）。
 *
 *   node scripts/verify-chat-ui.cjs
 *
 * 为什么需要它：这一整套功能横跨 6 个新文件 + 6 个既有文件的改动，
 * 任何一处被"顺手改回去"（把通知中心换回假数据、删掉私信入口、
 * 去掉 canvas 压缩直接上传原图）都不会让构建失败，只会在真机上悄悄退化成错误行为。
 * 所以这里把**接线**与**关键算法**都钉住：字符串断言 + 真实函数行为测试。
 */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const exists = (p) => fs.existsSync(path.join(root, p));

const failures = [];
const notes = [];
const ok = (m) => notes.push(`  [ok] ${m}`);
const bad = (m) => failures.push(`  [!!] ${m}`);

const chatService = read("src/services/ChatService.ts");
const notifService = read("src/services/NotificationService.ts");
const uploadService = read("src/services/UploadService.ts");
const pushService = read("src/services/PushRegistrationService.ts");
const chatView = read("src/views/Chat.tsx");
const notifView = read("src/views/NotificationCenter.tsx");
const app = read("src/App.tsx");
const dashboard = read("src/views/Dashboard.tsx");
const campus = read("src/views/Campus.tsx");
const profile = read("src/views/Profile.tsx");
const i18n = read("src/contexts/LanguageContext.tsx");
const css = read("src/index.css");

// ------------------------------------------------------------------ 1) 私信服务层
if (/new WebSocket\(/.test(chatService)) ok("ChatService: 走 WebSocket 建连");
else bad("ChatService: 没有 WebSocket 建连");

if (/scheduleReconnect/.test(chatService) && /MAX_BACKOFF_MS/.test(chatService)) {
  ok("ChatService: 断线指数退避重连（不是死循环狂连）");
} else bad("ChatService: 缺少重连退避");

if (/HEARTBEAT_MS/.test(chatService)) ok("ChatService: 心跳保活（移动网络 NAT 会掐静默连接）");
else bad("ChatService: 缺少心跳");

if (/WS_UNAUTHORIZED = 4401/.test(chatService)) ok("ChatService: 4401 单独处理（token 失效不无限重连）");
else bad("ChatService: 未处理 4401");

if (/enqueueOutbox/.test(chatService) && /flushChatOutbox/.test(chatService)) {
  ok("ChatService: 离线发件箱（联网后自动补发）");
} else bad("ChatService: 缺少离线发件箱");

if (/clientIdOverride/.test(chatService) && /client_id: clientId/.test(chatService)) {
  ok("ChatService: 发送带客户端幂等 id（WS + REST 共用，重发不会出两个气泡）");
} else bad("ChatService: 发送缺少幂等 client_id");

if (/sendSocketEvent\(/.test(chatService) && /apiFetchAuthed\(/.test(chatService)) {
  ok("ChatService: WS 优先、REST 兜底（两条通路并存）");
} else bad("ChatService: 未实现 WS→REST 降级");

if (/mergeMessage/.test(chatService)) ok("ChatService: 乐观气泡按 client_id 对齐（mergeMessage）");
else bad("ChatService: 缺少气泡对齐逻辑");

// ------------------------------------------------------------------ 2) 通知中心
if (/loadNotificationCenter/.test(notifService) && /markAllNotificationsRead/.test(notifService)) {
  ok("NotificationService: 真实接口（列表 + 全部已读）");
} else bad("NotificationService: 缺少真实接口调用");

if (/handleRealtimeNotificationEvent/.test(notifService)) {
  ok("NotificationService: 消费 WS 的 notification / broadcast 帧");
} else bad("NotificationService: 未处理实时帧");

if (!exists("src/views/Notifications.tsx")) ok("旧假数据通知页已删除（Notifications.tsx）");
else bad("src/views/Notifications.tsx 仍在 —— 又会出现写死 3 条的假通知");

if (/loadNotificationCenter/.test(notifView) && /subscribeRealtimeRevision/.test(notifView)) {
  ok("NotificationCenter: 数据驱动 + 实时刷新");
} else bad("NotificationCenter: 未接真实数据");

if (!/readNotificationIds/.test(dashboard)) ok("Dashboard: 不再用 localStorage 假红点");
else bad("Dashboard: 仍在用 readNotificationIds 假未读");

// ------------------------------------------------------------------ 3) 图片上传
if (/createImageBitmap/.test(uploadService)) ok("UploadService: 图片解码（createImageBitmap + <img> 回落）");
else bad("UploadService: 没有解码步骤");

if (/MAX_EDGE = 1600/.test(uploadService) && /JPEG_QUALITY/.test(uploadService)) {
  ok("UploadService: canvas 压缩（长边 1600 / JPEG 0.82）");
} else bad("UploadService: 缺少 canvas 压缩 —— 原图 3-8MB 上传会卡死/超 413");

if (/FormData\(\)/.test(uploadService) && !/multipart\/form-data/.test(uploadService)) {
  ok("UploadService: FormData 且没有手写 Content-Type（手写会丢 boundary）");
} else bad("UploadService: multipart 处理有误（可能手写了 Content-Type）");

if (/Authorization: `Bearer \$\{token\}`/.test(uploadService)) ok("UploadService: 带 Bearer 鉴权");
else bad("UploadService: 上传未带鉴权头");

// ------------------------------------------------------------------ 4) 推送设备注册
if (/\/notifications\/devices/.test(pushService)) ok("PushRegistration: 上报 /notifications/devices（普通通知 topic）");
else bad("PushRegistration: 未接普通通知设备接口");

if (/method: "DELETE"/.test(pushService)) ok("PushRegistration: 退出登录会注销设备");
else bad("PushRegistration: 缺少注销（换账号后仍会收到上个账号的通知）");

if (/kaznu:liveActivity:deviceId/.test(pushService)) ok("PushRegistration: device_id 与 Live Activity 复用同一 key");
else bad("PushRegistration: device_id 与 Live Activity 不一致，服务端排查会对不上");

// ------------------------------------------------------------------ 5) 首页入口与路由
if (/onOpenChat/.test(dashboard) && /useChatUnread/.test(dashboard)) {
  ok("Dashboard: 头部有私信入口 + 实时未读红点");
} else bad("Dashboard: 私信入口/红点缺失（用户会看不到聊天按钮）");

if (/badge-dot/.test(dashboard) && /\.badge-dot/.test(css)) ok("Dashboard: 红点样式 .badge-dot 已定义");
else bad("Dashboard: 红点样式缺失");

if (/attachChatRealtime/.test(app) && /attachPushRegistration/.test(app)) {
  ok("App: 登录后挂载私信实时通道与推送注册");
} else bad("App: 未挂载实时通道/推送注册");

if (/ChatDetail/.test(app) && /NotificationCenter/.test(app)) ok("App: 私信详情与通知中心已接路由");
else bad("App: 私信/通知视图未接入");

if (/routePush/.test(app) && /consumePushRoute/.test(app)) ok("App: 推送点击 → 页内路由（含冷启动消费）");
else bad("App: 未处理推送点击路由");

if (/app-banner/.test(app) && /\.app-banner/.test(css)) ok("App: 全局应用内 Banner（全校广播）");
else bad("App: 应用内 Banner 缺失");

// ------------------------------------------------------------------ 6) Campus
if (/accept="image\/\*"/.test(campus) && /uploadImages\(/.test(campus)) {
  ok("Campus: 发帖走本地相册选图（不再手贴图片链接）");
} else bad("Campus: 发帖仍是手贴链接 / 没有相册选图");

if (!/setMediaText/.test(campus)) ok("Campus: 旧的 mediaText 链接输入框已移除");
else bad("Campus: mediaText 输入框仍在");

if (/official-badge/.test(campus) && /\.official-badge/.test(css)) ok("Campus: 官方公告徽章（News 融合）");
else bad("Campus: 缺少官方徽章");

if (/startConversation/.test(campus)) ok("Campus: 「私信作者」入口");
else bad("Campus: 缺少私信作者入口");

if (/focusPostId/.test(campus) && /focusPostId/.test(app)) ok("Campus: 支持从通知直接打开某帖");
else bad("Campus: 未支持帖子深链");

// ------------------------------------------------------------------ 7) 退出登录
if (/unregisterNotificationDevice/.test(profile) && /closeChatSocket/.test(profile)) {
  ok("Profile: 退出登录会注销设备并断开实时连接");
} else bad("Profile: 退出登录未清理推送设备/连接");

// ------------------------------------------------------------------ 8) i18n 三语齐全
const KEYS = [
  "messages", "chatPlaceholder", "chatSearch", "chatEmpty", "chatTyping", "chatSayHi", "chatSending",
  "chatDelivered", "chatRead", "chatQueued", "chatUnreadShort", "addPhotos", "removePhoto", "uploading",
  "uploadFailed", "official", "officialBadge", "dmAuthor", "dmFailed", "notifCenter", "notifEmpty",
  "notifLike", "notifComment", "notifMessage", "notifOfficial", "broadcastLabel",
];
const missing = KEYS.filter((key) => (i18n.match(new RegExp(`\\b${key}:`, "g")) ?? []).length < 3);
if (missing.length === 0) ok(`i18n: ${KEYS.length} 个新词条 EN/KZ/RU 三语齐全`);
else bad(`i18n: 缺少翻译（每个词条需 3 份）：${missing.join(", ")}`);

// ------------------------------------------------------------------ 9) 后端契约
const schemas = read("backend/app/schemas.py");
const campusRouter = read("backend/app/routers/campus.py");
if (/class PostAuthorOut[\s\S]{0,500}?id: str \| None = None/.test(schemas)) {
  ok("后端: PostAuthorOut.id（实名帖才返回，供私信作者入口）");
} else bad("后端: PostAuthorOut 缺少 id 字段");

if (/id=user\.id if user else None/.test(campusRouter)) ok("后端: 实名帖填作者 id、匿名帖置 None");
else bad("后端: 作者 id 未按匿名规则填充");

// ------------------------------------------------------------------ 9b) News 并入 Hub / 顶部栏固定 / 系统横幅兜底
const news = read("src/views/News.tsx");
const schedule = read("src/views/Schedule.tsx");
const services = read("src/views/Services.tsx");

if (!/\{ id: "news"/.test(app)) ok("App: 底部 News Tab 已移除（News 并入 Hub）");
else bad("App: 底部仍有 News Tab —— 用户会看到重复入口");

if (!/activeTab === "news"/.test(app) && !/selectedNews/.test(app)) ok("App: 旧的 news/news-detail 路由已删除");
else bad("App: 仍残留独立 news 路由");

if (/NewsList/.test(campus) && /openNews/.test(campus)) ok("Campus: 「新闻」分段内嵌 NewsList + 详情子屏");
else bad("Campus: 未内嵌新闻");

if (/"wall", "events", "news"/.test(campus)) ok("Campus: 分段控件为 校园墙 / 活动 / 新闻");
else bad("Campus: 分段控件缺少新闻");

if (/export function NewsList/.test(news) && !/export default function News\(/.test(news)) {
  ok("News: 列表已抽成 NewsList（自身无顶部栏，避免双层标题）");
} else bad("News: NewsList 抽取不正确");

if (/onOpenChat/.test(campus) && /useChatUnread/.test(campus)) ok("Campus: Hub 顶部有私信入口 + 实时红点");
else bad("Campus: Hub 顶部缺少私信入口");

if (/screen-pin/.test(schedule) && /screen-pin/.test(services)) {
  ok("Schedule / Services: 顶部栏已固定（screen-pin：sticky + 实底 + 分隔线）");
} else bad("Schedule / Services: 顶部栏未固定（滚动会被带走）");

if (/postSystemBannerNow/.test(notifService)) {
  ok("通知: Banner 同时弹真实 iOS 系统横幅（本地通知，不需要 APNs 凭据）");
} else bad("通知: 只弹应用内浮层，没有系统横幅");

if (/startNotificationWatcher/.test(notifService) && /startNotificationWatcher/.test(app)) {
  ok("通知: 前台轮询看护已挂载（兜底管理端直接插库、没有 WS 帧的情况）");
} else bad("通知: 缺少前台轮询兜底（管理端插库后 App 不会自己发现）");

// ------------------------------------------- 9c) 广播弹窗 + 提示音 / 私信撤回 / 离线发件箱
const campusService = read("src/services/CampusService.ts");
const alarm = read("src/utils/alarm.ts");
const pushPy = read("backend/app/push.py");
const chatRouterPy = read("backend/app/routers/chat.py");
const adminUiPy = read("backend/app/admin_ui.py");
const modelsPy = read("backend/app/models.py");
const packageJson = read("package.json");
const soundPatchPath = "scripts/patch-capacitor-system-sound.cjs";

// —— ① 全校广播弹窗 ——
if (
  /subscribeBroadcastAlert/.test(notifService) &&
  /useBroadcastAlert/.test(notifService) &&
  /dismissBroadcastAlert/.test(notifService)
) {
  ok("广播: 弹窗状态可订阅（WS 帧 / 轮询两条通路共用一个弹窗）");
} else bad("广播: 缺少弹窗订阅接口");

if (/delivery_id \? String\(raw\.delivery_id\)/.test(notifService) && /function deliveryKey/.test(notifService)) {
  ok("广播: 去重优先用服务端 delivery_id（重复推送能再次弹窗，只按行 id 会被吃掉）");
} else bad("广播: deliveryKey 未优先使用 delivery_id —— 「Push now」会被去重，用户看不到第二次");

if (/alert-overlay/.test(app) && /alert-card/.test(app) && /alert-overlay/.test(css) && /\.alert-card\b/.test(css)) {
  ok("广播: 根节点渲染 iOS 风格 Alert（App.tsx 结构 + index.css 样式都在）");
} else bad("广播: Alert 结构或样式缺失");

if (/playAlertTone\(\)/.test(notifService) && /if \(!scheduled\) playAlertTone\(\)/.test(notifService)) {
  ok("广播: 系统横幅排程失败才补 Web Audio 提示音（成功时交给 iOS 响 Tri-tone）");
} else bad("广播: 缺少提示音兜底 —— 权限被拒时横幅会静默出现");

if (/export function playAlertTone/.test(alarm) && !/\.(mp3|m4a|wav|aiff|caf)\b/.test(alarm)) {
  ok("广播: 提示音是 Web Audio 合成（未打包苹果音频文件，无版权风险）");
} else bad("广播: playAlertTone 缺失或引入了音频文件");

if (exists(soundPatchPath) && /patch-capacitor-system-sound\.cjs/.test(packageJson)) {
  ok("广播: postinstall 打补丁把 sound=system-default 映射到 UNNotificationSound.default（真 Tri-tone）");
} else bad(`广播: 缺少 ${soundPatchPath} 或 package.json 未挂 postinstall`);

if (/_delivery_id\(row\.id, now\)/.test(pushPy) && /token_hex/.test(pushPy) && /1_000_000/.test(pushPy)) {
  ok("后端: 每次投递生成唯一 delivery_id（微秒 + 随机后缀，同秒连推两次也不会撞）");
} else bad("后端: delivery_id 仍可能在同一秒内重复 → 「重复推送」不响铃");

if (/async def push_existing_notification/.test(pushPy) && /pushed_at = now/.test(pushPy)) {
  ok("后端: 管理端「Push now」走 push_existing_notification 并写 pushed_at");
} else bad("后端: 缺少 push_existing_notification / pushed_at 写入");

if (/pushed_at: Mapped/.test(modelsPy) && /deleted_by: Mapped/.test(modelsPy)) {
  ok("后端: GlobalNotification.pushed_at 与 Message.deleted_by 已建模");
} else bad("后端: 新列未建模");

// —— ② 私信撤回 ——
if (/deleteChatMessage/.test(chatService) && /applyMessageDeleted/.test(chatService)) {
  ok("撤回: ChatService 支持撤回（REST + 本地帧应用）");
} else bad("撤回: ChatService 缺少撤回能力");

if (/"message-deleted"/.test(chatService)) ok("撤回: WS 帧类型 message-deleted 已定义");
else bad("撤回: 未处理 message-deleted 帧（对端不会实时变灰）");

if (/onTouchStart/.test(chatView) && /confirmRecall/.test(chatView) && /chat-bubble-recalled/.test(chatView)) {
  ok("撤回: 长按弹出撤回确认（contact 550ms + 滑动/抬手取消）");
} else bad("撤回: 长按手势或撤回占位样式缺失");

if (/\.chat-bubble-recalled/.test(css)) ok("撤回: 灰字斜体占位样式已定义");
else bad("撤回: .chat-bubble-recalled 样式缺失");

if (/@router\.delete\(\s*"\/chat\/messages\/\{message_id\}"/.test(chatRouterPy)) {
  ok("撤回: 后端 DELETE /chat/messages/{id} 已登记");
} else bad("撤回: 后端没有撤回接口");

if (/body="" if deleted else/.test(chatRouterPy) && /media_urls=\[\] if deleted else/.test(chatRouterPy)) {
  ok("撤回: 序列化时清空 body/media（否则历史请求仍能读到已撤回内容）");
} else bad("撤回: 已撤回内容仍可能被返回");

if (/deleted_by = "staff" if message\.sender_id != current\.id else "user"/.test(chatRouterPy)) {
  ok("撤回: 区分本人撤回（user）与管理员下架（staff）");
} else bad("撤回: 未记录撤回来源");

if (/class MessageAdmin\(ModelView, model=Message\)/.test(adminUiPy) && /add_model_view\(MessageAdmin\)/.test(adminUiPy)) {
  ok("管理端: 私信内容审核（MessageAdmin）已挂载");
} else bad("管理端: 私信审核视图缺失/未挂载");

// 管理端私信列表**必须有数据时也不崩**：格式化函数要读 message.sender / conversation.user_a，
// 行对象在模板渲染时已脱离 Session → 直接访问会 DetachedInstanceError → 整页 500
// （线上实测踩到；本地空表不会触发格式化函数，所以空库测试一直是绿的）。
if (/selectinload\(Message\.conversation\)/.test(adminUiPy) && /def list_query\(self, request/.test(adminUiPy)) {
  ok("管理端: 私信列表/详情预加载 sender + conversation.user_a/b（否则有数据就 500）");
} else bad("管理端: 缺少关联预加载 —— 私信审核页有数据时会 500");

if (/sa_inspect\(model\)\.unloaded/.test(adminUiPy) && /sa_inspect\(conversation\)/.test(adminUiPy) && /state\.unloaded/.test(adminUiPy)) {
  ok("管理端: 格式化函数有未加载兜底（宁可少显示名字也不能整页 500）");
} else bad("管理端: 格式化函数没有兜底，脱离 Session 时会 500");

// ⚠️ 这一版 sqladmin 的 list_query 是方法：写成类属性会 TypeError: 'Select' object is not callable
if (!/^\s*list_query = select\(/m.test(adminUiPy)) {
  ok("管理端: list_query 用的是方法重载（不是类属性，否则 TypeError）");
} else bad("管理端: list_query 被写成了类属性 —— sqladmin 会抛 'Select' object is not callable");

// —— ③ Campus 离线发件箱 ——
const enqueueCalls = (campusService.match(/enqueueOutbox\(\{/g) || []).length;
if (enqueueCalls >= 3) {
  ok(`发件箱: 发帖 / 评论 / 点赞失败都会入队（实查 ${enqueueCalls} 处 enqueueOutbox 调用）`);
} else bad(`发件箱: 只有 ${enqueueCalls} 处入队 —— 有写操作仍然"只存本地"从不重试`);

if (/await flushCampusOutbox\(\);/.test(campusService) && /export async function flushCampusOutbox/.test(campusService)) {
  ok("发件箱: 进 Campus 拉数据前先补发（用户回来看不到自己的帖子会有强烈挫败感）");
} else bad("发件箱: 缺少 flushCampusOutbox 调用");

if (/subscribeOutbox/.test(campusService) && /subscribeOutbox|outboxCount/.test(campus)) {
  ok("发件箱: Campus 页面显示待同步条数");
} else bad("发件箱: 界面没有待同步提示");

if (/retrySync|pendingSync/.test(campus)) ok("发件箱: 提供手动重试入口");
else bad("发件箱: 没有手动重试入口");

if (/flushCampusOutbox/.test(app) && /applicationServerOnline|addEventListener\("online"/.test(app)) {
  ok("发件箱: App 层看护（回前台 / online / 周期）");
} else bad("发件箱: App 层没有触发补发的时机");

// ------------------------------------------------------------------ 10) 行为测试
/**
 * 直接加载真实模块跑（Node ≥22.6 可直跑 TS）。
 *
 * 私信最容易出错的不是 UI，而是**乐观气泡对齐**：消息先在本地渲染成 pending，
 * 服务端回执再回来 —— 对齐错了就是"每条消息显示两遍"或"发完消失"。
 */
async function checkBehaviour() {
  let chat;
  let route;
  try {
    // Node 直跑 TS 时**不会**自动补 `.ts` 扩展名，而项目里所有相对导入都是无扩展名写法
    // （Vite/tsc 能解析）。这里注册一个最小解析钩子：解析失败且是相对路径时补 `.ts`，
    // 这样测试跑的就是**真实源码**，而不是在测试里复制一份算法。
    const { register } = require("node:module");
    register(
      "data:text/javascript," +
        encodeURIComponent(`
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (specifier.startsWith(".") && !/\\.(ts|tsx|mts|js|mjs|cjs|json)$/.test(specifier)) {
      return nextResolve(specifier + ".ts", context);
    }
    throw error;
  }
}
`),
    );
    chat = await import("../src/services/ChatService.ts");
    route = await import("../src/services/PushRouteService.ts");
  } catch (err) {
    bad(`无法加载 TS 模块做行为测试（需要 Node ≥22.6 直跑 TS）：${err.message}`);
    return;
  }

  const base = {
    conversation_id: "conv-1",
    sender_id: "me",
    media_urls: [],
    read_at: null,
    is_deleted: false,
    created_at: "2026-09-14T10:00:00Z",
    is_mine: true,
  };
  const pending = { ...base, id: "local-c1", body: "hello", client_id: "c1", pending: true };
  const server = { ...base, id: "srv-1", body: "hello", client_id: "c1" };

  const merged = chat.mergeMessage([pending], server);
  if (merged.length === 1 && merged[0].id === "srv-1" && !merged[0].pending) {
    ok("行为: 乐观气泡被服务端回执原地替换（按 client_id 对齐）");
  } else {
    bad(`行为: 乐观气泡对齐失败 → ${JSON.stringify(merged)}`);
  }

  const duped = chat.mergeMessage([{ ...base, id: "srv-1", body: "hello", client_id: null }], {
    ...base,
    id: "srv-1",
    body: "hello",
    client_id: null,
  });
  if (duped.length === 1) ok("行为: 同 id 重复帧不会渲染成两条");
  else bad("行为: 重复帧产生了第二个气泡");

  if (typeof chat.chatOutboxSize() === "number") {
    ok(`行为: 离线发件箱可读（当前 ${chat.chatOutboxSize()} 条待补发）`);
  } else bad("行为: 发件箱读取失败");

  const cases = [
    ["chat + 会话 id", "chat", "conv-9", "chat", "conv-9"],
    ["chat 无 id（只开列表）", "chat", null, "chat", null],
    ["post → 校园墙 + 帖子 id", "post", "p-1", "campus", "p-1"],
    ["news → Hub 的新闻分段", "news", "n-1", "campus", null],
    ["campus → 校园墙", "campus", null, "campus", null],
  ];
  for (const [label, routeName, routeId, tab, id] of cases) {
    const got = route.applyPushRoute(routeName, routeId);
    if (got && got.tab === tab && got.id === id) ok(`行为: 推送路由 ${label} → ${tab}${id ? `/${id}` : ""}`);
    else bad(`行为: 推送路由 ${label} 期望 ${tab}/${id}，实际 ${JSON.stringify(got)}`);
  }
  if (route.applyPushRoute("none", null) === null) ok("行为: route=none 不跳转（不误开页面）");
  else bad("行为: route=none 竟然产生了跳转");
}

async function main() {
  await checkBehaviour();

  console.log("\n===== 社交模块守卫（私信 / 通知中心 / 上传 / 官方公告 / 推送路由）=====");
  console.log(notes.join("\n"));
  if (failures.length) {
    console.log("\n----- 问题 -----");
    console.log(failures.join("\n"));
    process.exit(1);
  }
  console.log("\n全部检查通过");
}

void main();
