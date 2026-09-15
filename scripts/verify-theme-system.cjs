#!/usr/bin/env node
/**
 * 主题 / 颜色系统 + 产品重构守卫（课程资料卡片 / 社团申请 / Campus 排版 / 免责声明）。
 *
 *   node scripts/verify-theme-system.cjs
 *
 * 为什么需要它：
 *  1) 颜色退化是**看不见的** —— 只要有人再往 JSX 里内联一句
 *     `rgba(235,235,245,0.5)`，浅色模式下就是白底白字，但构建照样成功；
 *  2) 社团申请是 multipart/form-data —— 只要有人"顺手"补一个
 *     `Content-Type: application/json`，后端就再也解析不出字段（全 None）；
 *  3) LegalModal 的渲染期 setState 一旦被改回去会直接白屏。
 * 所以这里把**接线、token 完整性、以及可跑的行为**一起钉住。
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

const css = read("src/index.css");
const app = read("src/App.tsx");
const dashboard = read("src/views/Dashboard.tsx");
const campus = read("src/views/Campus.tsx");
const schedule = read("src/views/Schedule.tsx");
const materials = read("src/views/Materials.tsx");
const legalModal = exists("src/components/LegalModal.tsx") ? read("src/components/LegalModal.tsx") : "";
const notifService = read("src/services/NotificationService.ts");
const clubService = read("src/services/ClubService.ts");
const clubView = read("src/views/CreateClub.tsx");
const i18n = read("src/contexts/LanguageContext.tsx");
const backendModels = read("backend/app/models.py");
const backendAdmin = read("backend/app/admin_ui.py");
const backendMain = read("backend/app/main.py");
const backendPush = read("backend/app/push.py");
const backendClubs = read("backend/app/routers/clubs.py");
const backendMaterials = read("backend/app/routers/materials.py");

const allSources = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(rel);
    else if (/\.tsx?$/.test(entry.name)) allSources.push(rel);
  }
})("src");

/** 去掉注释再断言：注释里出现"#409CFF"这类字样是说明，不是硬编码。 */
const stripComments = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\/.*$/gm, "");
const codeOnly = allSources.map((rel) => stripComments(read(rel))).join("\n");

// ------------------------------------------------------------------ 1) 颜色 token 体系
for (const token of ["--tx-1", "--tx-4", "--tx-9", "--card-bg", "--hairline", "--sheet-bg",
  "--sheet-text", "--scrim", "--accent-soft-text", "--warm-soft-text", "--warm-grad"]) {
  const occurrences = css.split(token).length - 1;
  if (occurrences >= 3) ok(`css: token ${token} 已定义并在深浅两套/工具类中引用（${occurrences} 处）`);
  else bad(`css: token ${token} 覆盖不足（${occurrences} 处）`);
}

if (!/\.light\s*\{[^}]*--tx-1:/.test(css)) bad("css: .light 未覆盖 --tx-1（浅色下会沿用深色白字）");
else ok("css: .light 覆盖了整套 --tx-* 灰阶");

const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, "");

if (/\.light \[style\*="235"\]\s*\{/.test(cssCode)) {
  bad('css: 旧的 `.light [style*="235"]` hack 又回来了（把所有灰阶压成同一个值 → 对比度全丢）');
} else {
  ok('css: 已移除 `.light [style*="235"]` 这条脆弱 hack');
}

if (/\.btn-warm\s*\{[^}]*var\(--warm-grad\)/s.test(css)) ok("css: .btn-warm 走 token（深色不再刺眼黄）");
else bad("css: 缺少 .btn-warm token 定义");

if (/\.modal-scrim\s*\{[^}]*var\(--scrim\)/s.test(css)) ok("css: .modal-scrim 走 token");
else bad("css: 缺少 .modal-scrim token");

if (/\.sheet-surface\s*\{[^}]*var\(--sheet-bg\)/s.test(css)) ok("css: .sheet-surface 走 token");
else bad("css: 缺少 .sheet-surface token");

if (/\.chip-scroller/.test(css) && /mask-image/.test(css)) ok("css: .chip-scroller（横向滚动 + 两端渐隐）");
else bad("css: 缺少 .chip-scroller");

// ------------------------------------------------------------------ 2) 内联灰阶清零
const inlineGrays = [];
for (const rel of allSources) {
  const text = read(rel);
  const matches = text.match(/rgba\(\s*235\s*,\s*235\s*,\s*245\s*,\s*[0-9.]+\)/g) ?? [];
  // Schedule 有 4 处 `isDark ? "rgba(235…)" : "#…"` 的显式三元式（本身深浅分开），
  // Dashboard / Services 各有 1 处 SVG fill 的同款写法 —— 都属于**已正确处理**的例外。
  const allowed = /Schedule\.tsx$/.test(rel) ? 4 : /Dashboard\.tsx$|Services\.tsx$/.test(rel) ? 1 : 0;
  if (matches.length > allowed) inlineGrays.push(`${rel}: ${matches.length} 处（允许 ${allowed}）`);
}
if (inlineGrays.length === 0) ok("前端: 内联 rgba(235,235,245,·) 灰阶已清零（全部走 var(--tx-N)）");
else bad(`前端: 仍有硬编码灰阶 → ${inlineGrays.join("; ")}`);

// ------------------------------------------------------------------ 3) 产品修正：首页资料卡
if (!/nextDeadline/.test(dashboard)) ok("Dashboard: 已移除 nextDeadline（那张卡不是作业 Deadline）");
else bad("Dashboard: 仍在使用 nextDeadline");

if (/latestMaterials/.test(dashboard) && /loadMaterialSummary/.test(dashboard)) {
  ok("Dashboard: 资料卡接的是 /materials/summary 真实接口");
} else bad("Dashboard: 资料卡未接真实接口");

if (/demoSummary/.test(dashboard) && /noNewMaterials/.test(dashboard)) {
  ok("Dashboard: 离线回退 + 空状态齐备（不再编造 4h left）");
} else bad("Dashboard: 缺少离线回退或空状态");

if (/materialAge/.test(dashboard)) ok('Dashboard: 显示"多久前上传"而不是假 due 时间');
else bad("Dashboard: 缺少上传时间");

if (/onNavigate\("materials"\)/.test(dashboard)) ok("Dashboard: 点击资料卡进入 Materials 页");
else bad("Dashboard: 资料卡没有跳转");

// ------------------------------------------------------------------ 4) Materials 页深色硬编码
if (/hairline-rows/.test(materials) && !/divide-white\/5/.test(materials)) {
  ok("Materials: 行分隔线改走 token（divide-white/5 在浅色下不可见）");
} else bad("Materials: 仍有 divide-white/5 硬编码");

if (/var\(--accent-soft-text\)/.test(materials) && !/#409CFF/.test(materials)) {
  ok("Materials: 强调色 chip / 下载按钮走 token");
} else bad("Materials: 强调色仍硬编码");

// ------------------------------------------------------------------ 5) 评分按钮（图二 / 图三的黄块）
if (/btn-warm/.test(schedule)) ok("Schedule: View Professor Rating 改走 .btn-warm token");
else bad("Schedule: 评分按钮未改用 token");

// 全仓库（去注释后）不应再有 iOS 亮蓝 / 刺眼金作为**代码里的颜色**
const legacyBlue = /#409CFF/i.test(codeOnly);
const legacyGold = /#FFD60A/i.test(codeOnly);
if (!legacyBlue && !legacyGold) {
  ok("前端: #409CFF / #FFD60A 已全部换成 --accent-soft-text / --star（浅色下可读）");
} else {
  bad(`前端: 仍有硬编码 → ${legacyBlue ? "#409CFF " : ""}${legacyGold ? "#FFD60A" : ""}`);
}

if (/color-mix\(in srgb,/.test(codeOnly)) ok("前端: 需要透明度的场景改用 color-mix（var() 不能做十六进制后缀拼接）");
else bad("前端: 缺少 color-mix 处理（var() 拼接会产出非法 CSS）");

// ------------------------------------------------------------------ 6) Campus 顶部排版
if (/chip-scroller/.test(campus) && /seg-compact mt-3\.5 mx-4/.test(campus)) {
  ok("Campus: 二级 Tab 内缩 + 三级 Chips 横向滚动（排版分层）");
} else bad("Campus: 顶部排版未分层");

if (/screen-pin pt-2 pb-2\.5/.test(campus)) ok("Campus: Header 纵向留白加大（不再挤成一团）");
else bad("Campus: Header 仍过于紧凑");

if (!/"news"/.test(app)) ok("App: News 已并入 Hub（不再有独立 News Tab 项）");
else bad("App: 仍有独立 News Tab");

// ------------------------------------------------------------------ 7) 社团功能接线
if (/clubs\/apply/.test(clubService) && /FormData/.test(clubService)) ok("ClubService: multipart 提交 /clubs/apply");
else bad("ClubService: 缺少 multipart 提交");

if (/不要手动设置 Content-Type/.test(clubService) && /故意只带 Authorization/.test(clubService)) {
  ok("ClubService: 明确不手写 Content-Type（否则后端解析不出字段）");
} else bad("ClubService: 缺少 Content-Type 契约说明");

if (/CreateClub/.test(campus) && /createClubOpen/.test(campus)) ok("Campus: 已挂载 CreateClubScreen 子屏");
else bad("Campus: 未挂载 CreateClubScreen");

if (/ClubsSection/.test(campus) && /myClubApplications/.test(campus)) ok("Campus: 社团区块 + 我的申请状态");
else bad("Campus: 缺少社团区块");

if (/type="file"/.test(clubView) && /accept="image\/\*"/.test(clubView) && /compressImage/.test(clubView)) {
  ok("CreateClub: 相册选 Logo + 压缩 + 本地预览");
} else bad("CreateClub: 缺少相册选图 / 压缩 / 预览");

if (/CLUB_CATEGORIES/.test(clubView) && /CLUB_CATEGORY_KEY/.test(clubView)) ok("CreateClub: 分类 Chip 与后端枚举同源");
else bad("CreateClub: 分类未使用共享枚举");

// ------------------------------------------------------------------ 8) 后端：模型 / 接口 / 管理端 / 推送
const backendChecks = [
  ["CourseMaterial 模型", /class CourseMaterial\(Base\)/, backendModels],
  ["ClubApplication 模型", /class ClubApplication\(Base\)/, backendModels],
  ["MATERIAL_FORMATS 枚举", /MATERIAL_FORMATS\s*=\s*\(/, backendModels],
  ["CLUB_CATEGORIES 枚举", /CLUB_CATEGORIES\s*=\s*\(/, backendModels],
  ["materials 路由挂载", /materials\.router/, backendMain],
  ["clubs 路由挂载", /clubs\.router/, backendMain],
  ["CourseMaterialAdmin", /class CourseMaterialAdmin/, backendAdmin],
  ["ClubApplicationAdmin", /class ClubApplicationAdmin/, backendAdmin],
  ["广播 Push now 动作", /name="push-notification"/, backendAdmin],
  ["活动审核通过即推送", /announce_club_event/, backendAdmin],
  ["announce_content 扇出", /async def announce_content/, backendPush],
  ["官方公告全量推送", /async def announce_official_post/, backendPush],
  ["/materials/summary 聚合", /def materials_summary/, backendMaterials],
  ["clubs/apply multipart", /avatar: UploadFile \| None = File/, backendClubs],
  ["clubs 公开列表闸门", /ClubApplication\.status == "approved"/, backendClubs],
];
for (const [label, pattern, src] of backendChecks) {
  if (pattern.test(src)) ok(`后端: ${label}`);
  else bad(`后端: 缺少 ${label}`);
}

if (/status="pending"/.test(backendClubs)) ok("后端: 社团申请默认 pending（不是 approved，防止冒充官方社团）");
else bad("后端: 社团申请默认状态可疑");

if (/contact_phone.*不返回|不带手机号/.test(backendClubs) && !/_to_club_out[\s\S]{0,600}contact_phone/.test(backendClubs)) {
  ok("后端: 公开社团视图不含手机号");
} else bad("后端: 公开社团视图可能泄露手机号");

// ------------------------------------------------------------------ 9) 通知：新内容也要在应用外通知
if (/pollContentUpdates/.test(notifService)) ok("通知: 新官方公告 / 新活动的兜底轮询已挂载");
else bad("通知: 缺少新内容轮询");

if (/origin === "content"/.test(notifService) && /kaznu\.content/.test(notifService)) {
  ok("通知: content 事件走真实 iOS 系统横幅（thread=kaznu.content）");
} else bad("通知: content 事件未接系统横幅");

if (/silent/.test(notifService) && /rememberBanner\(id\)/.test(notifService)) {
  ok("通知: 首次运行静默登记（避免历史内容刷屏）");
} else bad("通知: 缺少首次静默逻辑");

if (/type === "official"/.test(notifService)) ok("通知: 官方公告帧也被消费（不再被当成私信帧丢弃）");
else bad("通知: 未处理 official 帧");

// ------------------------------------------------------------------ 10) 免责声明弹窗
if (/createPortal/.test(legalModal)) ok("LegalModal: Portal 到 body（不再被祖先 transform/overflow 困住）");
else bad("LegalModal: 未使用 Portal");

if (!/initialLanguage !== lang\) setLang\(initialLanguage\);/.test(legalModal.replace(/useEffect[\s\S]*?\}, \[initialLanguage\]\);/, ""))) {
  ok("LegalModal: 已去掉渲染期 setState（白屏根因）");
} else bad("LegalModal: 渲染期 setState 又回来了");

if (/useEffect\(\(\) => \{\s*if \(typeof initialLanguage/.test(legalModal)) ok("LegalModal: 语言同步改到 effect");
else bad("LegalModal: 语言同步不在 effect 里");

if (/sheet-surface/.test(legalModal) && /modal-scrim/.test(legalModal)) ok("LegalModal: 弹层走 token");
else bad("LegalModal: 弹层未走 token");

if (/92dvh/.test(legalModal)) ok("LegalModal: 用 dvh（iOS 键盘/地址栏不会顶出屏幕）");
else bad("LegalModal: 仍用固定 vh");

if (/overflow = "hidden"/.test(legalModal)) ok("LegalModal: 打开期间锁住背景滚动");
else bad("LegalModal: 未锁背景滚动");

// ------------------------------------------------------------------ 11) i18n 覆盖
const clubKeys = [
  "latestMaterials", "noNewMaterials", "noNewMaterialsHint", "clubs", "myClubApplications",
  "createClub", "createClubHint", "clubAvatar", "clubName", "clubCategory", "clubDescription",
  "clubContact", "clubSubmit", "clubStatusPending", "clubStatusApproved", "clubStatusRejected",
  "clubSubmittedTitle", "clubSubmittedHint", "clubCatAcademic", "clubCatTech", "clubApplyFailed",
];
const missingKeys = [];
for (const key of clubKeys) {
  const hits = i18n.split(new RegExp(`\\b${key}:`)).length - 1;
  if (hits < 3) missingKeys.push(`${key}(${hits}/3)`);
}
if (missingKeys.length === 0) ok(`i18n: ${clubKeys.length} 个新词条 EN/KZ/RU 三语齐全`);
else bad(`i18n: 缺语言覆盖 → ${missingKeys.join(", ")}`);

// ------------------------------------------------------------------ 11b) 登录页条款链接（button 嵌套 bug）
const login = read("src/views/LoginScreen.tsx");
// 标记必须足够独特："法律条款强制同意" 在文件里出现两次（state 注释 + JSX 注释），
// 用短词会取到 state 注释之后的整段代码，导致断言永远失败。
const termsBlock = login.split("{/* 法律条款强制同意")[1]?.split("Please agree to the terms")[0] ?? "";

if (!termsBlock) {
  bad("LoginScreen: 找不到条款同意区块（选择器失效，请更新守卫）");
} else {
  // 外层若仍是 <button role="checkbox"> → 内部再放 <button> 就是非法嵌套，
  // WebKit 会把内层点击冒泡吞给外层（"点条款没反应"的根因）
  if (/<button[^>]*role="checkbox"/.test(termsBlock)) {
    bad("LoginScreen: 条款外层仍是 <button role=checkbox> —— 会和内层链接形成非法 button 嵌套");
  } else if (/role="checkbox"/.test(termsBlock)) {
    ok("LoginScreen: 条款外层改为 div[role=checkbox]（不再与内层链接嵌套 button）");
  } else {
    bad("LoginScreen: 条款外层缺少 role=checkbox");
  }

  if (/event\.stopPropagation\(\)/.test(termsBlock) && /setShowLegal\(true\)/.test(termsBlock)) {
    ok("LoginScreen: 条款链接 stopPropagation + 打开 LegalModal（不会顺带勾选同意）");
  } else {
    bad("LoginScreen: 条款链接缺少 stopPropagation / 未绑定打开弹窗");
  }

  if (/relative z-10/.test(termsBlock)) ok("LoginScreen: 条款链接有独立 z-10（不被下方提示文字压住）");
  else bad("LoginScreen: 条款链接没有独立 z-index");

  if (/tabIndex=\{0\}/.test(termsBlock) && /onKeyDown/.test(termsBlock)) {
    ok("LoginScreen: 改用 div 后仍保留键盘可达性（tabIndex + Space/Enter）");
  } else bad("LoginScreen: div[role=checkbox] 缺少键盘支持（可访问性回退）");
}

// ------------------------------------------------------------------ 11c) 首页横向溢出 + 卡片对齐
const dashboardScroller = /flex-1 min-h-0 overflow-y-auto overflow-x-hidden/;
if (dashboardScroller.test(dashboard)) ok("Dashboard: 纵向滚动容器显式 overflow-x-hidden（堵住横向拖动）");
else bad("Dashboard: 滚动容器缺 overflow-x-hidden（overflow-y:auto 会让 X 轴也变 auto）");

if (/grid grid-cols-2 gap-3 items-stretch w-full min-w-0/.test(dashboard)) {
  ok("Dashboard: GPA / 资料卡父容器用 grid-cols-2 + items-stretch（严格 1:1 且等高）");
} else bad("Dashboard: GPA / 资料卡父容器不是 grid-cols-2 items-stretch");

const flexCardsCount = (dashboard.match(/interactive-card (flex-1|w-full h-full min-w-0)/g) ?? []).length;
if (/interactive-card w-full h-full min-w-0 flex flex-col/.test(dashboard)) {
  ok("Dashboard: 两张卡片都带 w-full h-full min-w-0（可在窄屏收缩，不再撑破行）");
} else bad(`Dashboard: 卡片缺少 w-full/h-full/min-w-0（命中 ${flexCardsCount} 处）`);

if (/min-w-0/.test(dashboard) && !/width:\s*3\d\d/.test(dashboard) && !/w-\[3\d\dpx\]/.test(dashboard)) {
  ok("Dashboard: 无固定像素宽度（没有 380px 这类硬编码）");
} else bad("Dashboard: 仍存在固定像素宽度或缺少 min-w-0");

if (/max-width: min\(100%, 100vw\)[\s\S]{0,120}overflow-x: hidden/.test(css)) {
  ok("css: .app-root / .app-surface 限宽 + 锁 X 轴（含 100vw 上限）");
} else bad("css: 根容器缺少 max-width/overflow-x 防线");

if (/"min\(430px, 100%\)"/.test(app)) ok("App: 根节点 maxWidth = min(430px, 100%)（窄屏不超过视口）");
else bad("App: 根节点仍是固定 maxWidth 430");

// ------------------------------------------------------------------ 11d) 全仓库：button 嵌套（WebKit 会吞掉内层点击）
const nestedButtonHits = [];
for (const rel of allSources) {
  const raw = read(rel);
  // 去注释：注释里可能出现 `<button>` 字样（说明"禁止嵌套"），会被朴素标签栈误判
  const text = raw
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const re = /<\/?button\b/g;
  const stack = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[0].startsWith("</")) {
      stack.pop();
      continue;
    }
    if (stack.length > 0) nestedButtonHits.push(`${rel}:${text.slice(0, m.index).split("\n").length}`);
    stack.push(1);
  }
}
if (nestedButtonHits.length === 0) {
  ok(`前端: ${allSources.length} 个文件均无 button 嵌套（内层点击不会被吞）`);
} else {
  bad(`前端: 存在 button 嵌套 → ${nestedButtonHits.join(", ")}`);
}

// ------------------------------------------------------------------ 11e) 条款 PDF 打不开 + 必须先看过才能勾选
const legalPdf = read("src/native/legalPdf.ts");
const viteConfig = read("vite.config.ts");

if (/new URL\(PDF_FILE_NAME,\s*document\.baseURI\)/.test(legalPdf)) {
  ok("legalPdf: PDF 地址按 document.baseURI 解析（子路径 /app/ 与 capacitor:// 都成立）");
} else {
  bad("legalPdf: PDF 地址写死了 origin + 绝对路径 → 子路径部署下 404");
}

if (/files:\s*\[saved\.uri\]/.test(legalPdf) && !/url:\s*entry\.uri/.test(legalPdf)) {
  ok("legalPdf: 原生端用 Share files:[fileUri]（用 url: file:// 会被 iOS 静默忽略）");
} else {
  bad("legalPdf: Share 用法不对（本地文件必须走 files:[…]）");
}

if (/return true;/.test(legalPdf) && /Promise<boolean>/.test(legalPdf)) {
  ok("legalPdf: 返回是否唤起成功（调用方据此判定\"算不算看过\"）");
} else bad("legalPdf: openLegalPdf 未返回成功状态");

if (/base:\s*process\.env\.FIGMA_PUBLIC_URL\s*\?\s*`\$\{process\.env\.FIGMA_PUBLIC_URL\}\/`\s*:\s*'\.\/'/.test(viteConfig)) {
  ok("vite: base = './' 相对路径（子路径部署 /app/ 下资源不再 404）");
} else bad("vite: base 仍是 '/'，子路径部署会 404");

if (/export function hasViewedLegalDoc/.test(legalModal) && /export async function openLegalDocAndMark/.test(legalModal)) {
  ok("LegalModal: 提供 hasViewedLegalDoc / openLegalDocAndMark（打开即打标）");
} else bad("LegalModal: 缺少\"已看过条款\"的状态与统一入口");

if (/onLegalViewed\?\.\(\)/.test(legalModal) && /onLegalViewed=\{/.test(login)) {
  ok("LegalModal ↔ LoginScreen: 弹窗里打开 PDF 会回调解锁勾选框");
} else bad("LegalModal → LoginScreen: 缺少 onLegalViewed 回调接线");

if (/const toggleAgreed = \(\) => \{[\s\S]{0,400}?!legalViewed[\s\S]{0,200}?return;/.test(login)) {
  ok("LoginScreen: 未看过条款 → toggleAgreed 直接拒绝勾选（不是静默失败）");
} else bad("LoginScreen: 勾选没有被\"必须先看过条款\"拦住");

if (/openTermsPdf/.test(login) && /📄/.test(login)) {
  ok("LoginScreen: 勾选框旁有显式「Open PDF」入口");
} else bad("LoginScreen: 缺少入口 PDF 按钮");

// ------------------------------------------------------------------ 12) 行为测试（真跑代码）
(async () => {
  globalThis.window = globalThis;
  globalThis.document = { visibilityState: "visible" };
  globalThis.localStorage = {
    _data: new Map(),
    getItem(k) {
      return this._data.has(k) ? this._data.get(k) : null;
    },
    setItem(k, v) {
      this._data.set(k, String(v));
    },
    removeItem(k) {
      this._data.delete(k);
    },
  };

  const material = await import(new URL("./src/services/MaterialService.ts", `file://${root}/`).href);
  const club = await import(new URL("./src/services/ClubService.ts", `file://${root}/`).href);

  // 行为 1：materialAge 的边界
  const now = Date.now();
  const ageCases = [
    [new Date(now - 30_000).toISOString(), "now"],
    [new Date(now - 12 * 60_000).toISOString(), "12m"],
    [new Date(now - 3 * 3_600_000).toISOString(), "3h"],
    [new Date(now - 2 * 86_400_000).toISOString(), "2d"],
  ];
  const got = ageCases.map(([iso]) => material.materialAge(iso));
  if (ageCases.every(([, want], i) => got[i] === want)) ok(`行为: materialAge 相对时间正确（${got.join(" / ")}）`);
  else bad(`行为: materialAge 结果错误 → ${got.join(" / ")}`);

  // 行为 2：离线演示摘要形状与后端一致（保证 UI 只有一个渲染分支）
  const demo = material.demoSummary();
  if (demo.latest && typeof demo.total === "number" && typeof demo.course_count === "number") {
    ok(`行为: demoSummary 形状与后端一致（${demo.total} 条 / ${demo.course_count} 门课）`);
  } else bad("行为: demoSummary 形状异常");

  // 行为 3：分类枚举与 i18n key / emoji 一一对应（漏一个就渲染 undefined）
  const covered = club.CLUB_CATEGORIES.every((id) => club.CLUB_CATEGORY_KEY[id] && club.CLUB_CATEGORY_EMOJI[id]);
  if (covered) ok(`行为: ${club.CLUB_CATEGORIES.length} 个社团分类都有 i18n key 与 emoji`);
  else bad("行为: 有社团分类缺 key/emoji → 会渲染 undefined");

  // 行为 4 + 5：multipart 契约（这是 multipart 接口最容易踩的坑）
  let calls = [];
  let token = null;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/auth/login")) {
      return { ok: true, status: 200, json: async () => ({ access_token: "test-token" }) };
    }
    return {
      ok: true,
      status: 201,
      json: async () => ({ club: { id: "c1", club_name: "Robotics Club", status: "pending" } }),
    };
  };

  const applied = await club.applyForClub({
    clubName: "Robotics Club",
    category: "tech",
    description: "Build robots",
    contactTelegram: "@robotics",
    avatar: new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }),
  });
  token = applied;
  const applyCall = calls.find((c) => c.url.includes("/clubs/apply"));

  if (applied.ok && applyCall) {
    ok("行为: 提交社团申请 → ok（返回 pending 申请）");
    const headerNames = Object.keys(applyCall.init.headers ?? {}).map((h) => h.toLowerCase());
    if (!headerNames.includes("content-type")) {
      ok("行为: 提交**没有**手写 Content-Type（交给浏览器带 multipart boundary）");
    } else bad("行为: 提交手写了 Content-Type —— 后端会解析不出任何字段");
    if (headerNames.includes("authorization")) ok("行为: 提交携带 Authorization");
    else bad("行为: 提交缺少 Authorization");

    const body = applyCall.init.body;
    if (typeof FormData !== "undefined" && body instanceof FormData) {
      const hasName = body.get("club_name") === "Robotics Club";
      const hasCat = body.get("category") === "tech";
      const hasAvatar = body.get("avatar") !== null;
      if (hasName && hasCat && hasAvatar) ok("行为: FormData 含 club_name / category / avatar 文件");
      else bad(`行为: FormData 缺字段 name=${hasName} cat=${hasCat} avatar=${hasAvatar}`);
    } else bad("行为: 提交 body 不是 FormData");
  } else {
    bad(`行为: 提交失败 → ${JSON.stringify(applied)}`);
  }

  // 行为 6：409 单独识别（当成网络错误会让用户反复重试）
  globalThis.fetch = async (url) => {
    if (String(url).includes("/auth/login")) {
      return { ok: true, status: 200, json: async () => ({ access_token: "test-token" }) };
    }
    return { ok: false, status: 409, text: async () => "duplicate", json: async () => ({}) };
  };
  const dup = await club.applyForClub({ clubName: "Robotics Club", category: "tech" });
  if (dup.ok === false && dup.reason === "duplicate") ok("行为: 409 → reason=duplicate（可提示「已提交过同名社团」）");
  else bad(`行为: 409 未识别 → ${JSON.stringify(dup)}`);

  // 行为 7：网络异常不抛给 UI
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  const offline = await club.applyForClub({ clubName: "Robotics Club", category: "tech" });
  if (offline.ok === false && offline.reason === "network") ok("行为: 网络异常 → reason=network（不抛异常给 UI）");
  else bad(`行为: 网络异常分支异常 → ${JSON.stringify(offline)}`);

  void token;

  // ------------------------------------------------------------------ 输出
  console.log("\n===== 主题 / 颜色系统 + 产品重构守卫 =====");
  console.log(notes.join("\n"));
  if (failures.length) {
    console.log("\n----- 问题 -----");
    console.log(failures.join("\n"));
    process.exit(1);
  }
  console.log("\n全部检查通过");
})().catch((error) => {
  console.error("守卫自身异常：", error);
  process.exit(1);
});



