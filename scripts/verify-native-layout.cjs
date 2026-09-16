#!/usr/bin/env node
/**
 * 真机（Capacitor iOS WebView）适配守卫。
 *
 *   node scripts/verify-native-layout.cjs      （npm run verify:native）
 *
 * 覆盖用户反馈过的 5 类真机问题，每一条都对应一次真实事故：
 *   1) 「我的申请」真机上整块消失  —— 空态/失败态必须渲染，不许静默隐藏
 *   2) 真机连不上服务器            —— 超时太短 + 失败被静默吞掉；地址必须是 https 生产域名
 *   3) 调试残余（写死测试数据的横幅 / 调试面板样式）
 *   4) 真机宽度被 430px "手机列"夹住 + 刘海安全区
 *   5) 哈/俄长文本挤压截断 + 浅色模式按钮对比度过低
 *
 * 这个项目是 **React + Vite + Capacitor（WebView 包壳）**，不是 React Native：
 * 所以"SafeAreaView / flex:1 / numberOfLines"在这套栈里的等价物是
 *   SafeAreaView → CSS env(safe-area-inset-*) + 原生 contentInset
 *   flex: 1      → CSS flex:1 + min-w-0（WebKit 的 flex 子项默认 min-width:auto 会撑破布局）
 *   numberOfLines→ truncate / line-clamp + min-w-0
 * 断言按这套等价物写，改回"写死宽度"就会在这里报错。
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

const app = read("src/App.tsx");
const campus = read("src/views/Campus.tsx");
const notifCenter = read("src/views/NotificationCenter.tsx");
const clubService = read("src/services/ClubService.ts");
const config = read("src/utils/config.ts");
const css = read("src/index.css");
const i18n = read("src/contexts/LanguageContext.tsx");
const capacitorConf = read("capacitor.config.ts");


// ---------------------------------------------------------------- 1) 我的申请
if (!/myClubs\.length > 0 &&/.test(campus)) {
  ok("Campus: 「我的申请」不再用 length>0 门控（真机上曾因此整块消失）");
} else bad("Campus: 「我的申请」仍被 myClubs.length > 0 门控 —— 没数据时真机上什么都看不到");

for (const [key, label] of [
  ["clubAppsEmpty", "空态"],
  ["clubAppsFailed", "失败态"],
  ["clubReload", "重试入口"],
]) {
  if (new RegExp(`t\\("${key}"\\)`).test(campus)) ok(`Campus: 「我的申请」有${label}（${key}）`);
  else bad(`Campus: 「我的申请」缺少${label}（${key}）`);
}

if (
  /myClubs: ClubApplication\[\] \| null/.test(campus) &&
  /useState<ClubApplication\[\] \| null>\(null\)/.test(campus)
) {
  ok('Campus: myClubs 用 null 表示"没成功拿到"（区别于"确实没有申请"）');
} else bad('Campus: myClubs 没有区分 空 / 加载失败 —— 失败会伪装成"没有申请"');

if (/onRetry=\{\(\) => void refreshClubs\(\)\}/.test(campus)) ok("Campus: 失败态提供重新加载");
else bad("Campus: 失败态没有重试入口");

if (/max-w-\[45%\]/.test(campus)) ok("Campus: 状态标签用比例上限（长语言不会被写死宽度截断）");
else bad("Campus: 状态标签可能写死宽度 —— 哈/俄语会截断");

// ---------------------------------------------------------------- 2) 真机网络
if (/API_HOST = "https:\/\/1losion\.me"/.test(config) && !/axios/.test(config)) {
  ok("网络: 后端地址统一为 https://1losion.me（不是 localhost / 127.0.0.1）");
} else bad("网络: 后端地址不是生产 HTTPS 域名");

const timeoutMatch = /const CLUB_TIMEOUT_MS = (\d+)/.exec(clubService);
if (timeoutMatch) {
  const ms = Number(timeoutMatch[1]);
  if (ms >= 10000) ok(`网络: 社团接口超时 ${ms}ms（移动网络冷启动够用；之前 4s 会误判为断网）`);
  else bad(`网络: 超时只有 ${ms}ms —— 蜂窝网络下会频繁误报"连接不上服务器"`);
} else bad("网络: 没有集中的超时常量");

if (/async function fetchJsonWithRetry/.test(clubService)) ok("网络: 失败会重试一次（幂等 GET）");
else bad("网络: 没有重试 —— 一次抖动就整块数据不显示");

if (/console\.warn\(/.test(clubService)) ok("网络: 失败原因会打印到控制台（不再静默吞掉）");
else bad("网络: 失败仍被静默吞掉，真机上无法排查");

// ---------------------------------------------------------------- 3) 调试残余
if (!/\.dev-(sheet|backdrop)\s*\{/.test(css) && !/dev-sheet|dev-backdrop/.test(app + campus + notifCenter)) {
  ok("清理: 调试面板样式（.dev-sheet / .dev-backdrop）已彻底移除");
} else bad("清理: 还留着调试面板样式 —— 真机上会出现写死的测试横幅");

if (!/1111/.test(app + campus + notifCenter + i18n)) ok("清理: 视图层没有写死的测试数据（1111 之类）");
else bad("清理: 视图层出现写死的测试数据");

if (exists("scripts/verify-ios-bundle.cjs")) ok('真机: 有 iOS 打包资源新鲜度守卫（旧包会让"改了没生效"）');
else bad("真机: 缺少 iOS 打包资源新鲜度守卫");

// ---------------------------------------------------------------- 4) 宽度 / 安全区
if (/Capacitor\.isNativePlatform\(\)/.test(app) && /IS_NATIVE_PLATFORM \? "none" : "min\(430px, 100%\)"/.test(app)) {
  ok("布局: 真机宽度 100% 铺满（430px 手机列只留给桌面预览）");
} else bad("布局: 真机仍被 430px 手机列夹住 —— iPad/横屏两侧留黑");

const safeTop = /\.app-root[\s\S]{0,400}padding-top: calc\(env\(safe-area-inset-top, 0px\) \+ 12px\)/.test(css);
if (safeTop) ok("安全区: .app-root 用 env(safe-area-inset-top) 让出刘海/灵动岛");
else bad("安全区: 顶部没有用 env(safe-area-inset-top) 避让");

if (/env\(safe-area-inset-bottom/.test(css)) ok("安全区: 底部用 env(safe-area-inset-bottom) 避让 Home Indicator");
else bad("安全区: 底部没有避让 Home Indicator");

if (/contentInset: 'never'/.test(capacitorConf) && /overlaysWebView: true/.test(capacitorConf)) {
  ok("安全区: 原生侧 contentInset=never + 状态栏 overlay（与 CSS env() 配套，不双重偏移）");
} else bad("安全区: 原生侧配置与 CSS env() 不配套，会出现双重内边距");

// ---------------------------------------------------------------- 5) i18n 与对比度
if (/notif-read-all/.test(notifCenter) && !/theme-secondary text-xs font-semibold disabled:opacity-40/.test(notifCenter)) {
  ok("对比度: 「全部已读」按钮改用主题强调色（不再靠 opacity:40 的浅灰）");
} else bad("对比度: 「全部已读」按钮颜色过浅（浅色模式下几乎看不见）");

if (/\.notif-read-all:disabled \{ color: var\(--tx-5\); opacity: 1; \}/.test(css)) {
  ok("对比度: 禁用态用 --tx-5 实色（不是把透明度叠到看不见）");
} else bad("对比度: 禁用态样式缺失");

if (/flex flex-wrap items-center justify-between gap-x-3 gap-y-1/.test(notifCenter)) {
  ok("i18n: 通知中心顶栏允许换行（哈语「全部已读」长按钮不再被挤压）");
} else bad("i18n: 通知中心顶栏不许换行，长语言会被压扁");

if (/min-w-0[\s\S]{0,400}truncate">\{t\("notifCenter"\)\}/.test(notifCenter)) {
  ok("i18n: 通知中心标题用 min-w-0 + truncate（长语言不撑破布局）");
} else bad("i18n: 通知中心标题缺少 min-w-0/truncate");

for (const key of ["clubAppsEmpty", "clubAppsFailed", "clubReload"]) {
  const hits = (i18n.match(new RegExp(`^\\s*${key}:`, "gm")) || []).length;
  if (hits === 3) ok(`i18n: ${key} EN/KZ/RU 三语齐全`);
  else bad(`i18n: ${key} 只出现 ${hits} 次（应为 3：EN/KZ/RU）`);
}

if (/"clubAppsEmpty" \| "clubAppsFailed"/.test(i18n)) {
  ok("i18n: 新词条已加入 ClubTranslationKey 联合类型（类型安全）");
} else bad("i18n: 新词条没进联合类型");

// ---------------------------------------------------------------- 6) 行为测试
/**
 * 直接加载真实 ClubService，用假 fetch 验证"第一次抖动会重试、两次都失败返回 null"。
 * 只看源码字符串无法证明重试真的发生 —— 这里要的是**行为**证据。
 */
async function checkBehaviour() {
  globalThis.window = globalThis; // ClubService 里用的是 window.setTimeout
  let calls = 0;
  let lastUrl = "";

  globalThis.fetch = async (url) => {
    calls += 1;
    lastUrl = String(url);
    if (calls === 1) throw new TypeError("Failed to fetch"); // 模拟真机第一次请求失败
    return {
      ok: true,
      status: 200,
      json: async () => ({ items: [{ id: "c1", club_name: "Astro Photography Lab" }] }),
    };
  };

  try {
    const clubs = await import("../src/services/ClubService.ts");
    const first = await clubs.loadClubs(5);
    if (Array.isArray(first) && first.length === 1 && calls === 2) {
      ok(`行为: 第一次 fetch 抛错后自动重试并成功（calls=${calls}）`);
    } else {
      bad(`行为: 重试没生效（calls=${calls}, result=${JSON.stringify(first)?.slice(0, 80)}）`);
    }
    if (lastUrl.startsWith("https://1losion.me/api/v1/clubs")) {
      ok(`行为: 请求打到生产域名（${lastUrl.slice(0, 56)}…）`);
    } else {
      bad(`行为: 请求地址不对：${lastUrl}`);
    }

    calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      throw new TypeError("Failed to fetch");
    };
    const second = await clubs.loadClubs(5);
    if (second === null && calls === 2) {
      ok('行为: 两次都失败 → 返回 null（界面据此显示"加载失败 · 重试"，而不是空白）');
    } else {
      bad(`行为: 全失败时返回 ${JSON.stringify(second)} / calls=${calls}（应为 null / 2）`);
    }
  } catch (err) {
    bad(`行为: 无法加载 ClubService 做行为测试（需要 Node ≥22.6 直跑 TS）：${err.message}`);
  }
}

async function main() {
  await checkBehaviour();
  console.log("\n===== 真机适配守卫（布局 / 网络 / 调试残留 / i18n）=====");
  console.log(notes.join("\n"));
  if (failures.length) {
    console.log("\n----- 问题 -----");
    console.log(failures.join("\n"));
    process.exit(1);
  }
  console.log("\n全部检查通过");
}

void main();
