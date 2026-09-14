#!/usr/bin/env node
/**
 * UI 细节优化守卫：把这次的四项改动"钉死"，避免以后被改回去。
 *
 *   node scripts/verify-ui-polish.cjs
 *
 * 覆盖：
 *   1) 触感震动只在"确认点击"（pointerup + 无位移）触发，且滑动/取消立即作废
 *      —— 不能再出现 pointerdown 直接震的写法（这是"滑动误震"的根因）
 *   2) 软键盘探测（visualViewport → html.kb-open / --kb-inset）已挂载
 *   3) 底部 TabBar / FAB 键盘弹出时收起，输入区上抬（CSS 规则齐备）
 *   4) 发帖入口是右下角 FAB，顶部不再有笨重的大按钮
 */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const failures = [];
const notes = [];
const ok = (m) => notes.push(`  [ok] ${m}`);
const bad = (m) => failures.push(`  [!!] ${m}`);

const haptics = read("src/utils/haptics.ts");
const tapGesture = read("src/utils/tapGesture.ts");
const keyboard = read("src/utils/keyboard.ts");
const css = read("src/index.css");
const app = read("src/App.tsx");
const campus = read("src/views/Campus.tsx");

// ---------- 1) 触感：确认点击后才震 ----------
if (/addEventListener\(\s*["']pointerup["']/.test(haptics)) ok("haptics: 监听 pointerup（抬起才判定点击）");
else bad("haptics: 缺少 pointerup 监听 —— 又会在手指按下瞬间震动");

for (const [name, re] of [
  ["pointercancel", /addEventListener\(\s*["']pointercancel["']/],
  ["scroll", /addEventListener\(\s*["']scroll["']/],
]) {
  if (re.test(haptics)) ok(`haptics: ${name} 时作废候选（滑动期间不震）`);
  else bad(`haptics: 缺少 ${name} 作废逻辑 —— 滑动/取消仍会误震`);
}

if (/Math\.hypot/.test(tapGesture) && /isConfirmedTap/.test(haptics)) {
  ok("haptics: 用 isConfirmedTap（位移 ≤ 阈值）判定，滑动不算点击");
} else bad("haptics: 缺少位移阈值校验 —— 滑动会被当成点击");

if (/press\.hit !== release\.hit/.test(tapGesture)) {
  ok("haptics: 校验「按下/抬起同一元素」（滑动到别处松手不震）");
} else bad("haptics: 未校验「按下/抬起同一元素」");

// 旧写法：pointerdown 里直接 fireHaptic / haptic*()
if (/onPointerDown[\s\S]{0,400}?fireHaptic\(/.test(haptics)) {
  bad("haptics: pointerdown 里直接震动（= onPressIn 误触发，需求明确禁止）");
} else ok("haptics: pointerdown 只记录候选，不直接震动");

if (/\.seg-compact/.test(haptics)) ok("haptics: 紧凑分段控件走 Light 强度");
else bad("haptics: 未把 .seg-compact 归入 Light 强度");

// ---------- 2) 键盘探测 ----------
if (/visualViewport/.test(keyboard)) ok("keyboard: 基于 visualViewport 测量键盘高度");
else bad("keyboard: 未使用 visualViewport");

if (/kb-open/.test(keyboard) && /--kb-inset/.test(keyboard)) {
  ok("keyboard: 输出 html.kb-open 与 --kb-inset 供 CSS 消费");
} else bad("keyboard: 未输出 kb-open / --kb-inset");

if (/focusin/.test(keyboard) && /focusout/.test(keyboard)) ok("keyboard: 监听 focusin/focusout（键盘动画期间复测）");
else bad("keyboard: 缺少 focus 监听");

if (/attachKeyboardWatcher/.test(app)) ok("App: 已挂载键盘看护");
else bad("App: 未挂载 attachKeyboardWatcher");

// ---------- 3) CSS ----------
for (const [label, re] of [
  [".fab 圆形悬浮按钮", /\.fab\s*\{/],
  [".seg-compact 紧凑分段控件", /\.seg-compact\s*\{/],
  [".pill-chip 紧凑胶囊", /\.pill-chip\s*\{/],
  ["html.kb-open 收起 .tab-bar", /html\.kb-open\s+\.tab-bar/],
  ["html.kb-open 收起 .fab", /html\.kb-open\s+\.fab/],
  [".kb-pad 输入区抬升", /\.kb-pad\s*\{/],
  [".kb-bar 吸底输入条上抬", /\.kb-bar\s*\{/],
]) {
  if (re.test(css)) ok(`css: ${label}`);
  else bad(`css: 缺少 ${label}`);
}

// FAB 必须 absolute（fixed 会跳出 430px 的 App 列）
const fabBlock = css.match(/\.fab\s*\{[\s\S]*?\}/)?.[0] ?? "";
if (/position:\s*absolute/.test(fabBlock)) ok("css: FAB 用 absolute 定位（跟随 App 列而非窗口）");
else bad("css: FAB 未使用 absolute —— 桌面端会飘到屏幕最右侧");

// ---------- 4) Campus 结构 ----------
if (/className="fab"/.test(campus)) ok("Campus: 右下角 FAB 已就位");
else bad("Campus: 找不到 FAB");

if (/app-surface relative h-full/.test(campus)) ok("Campus: 根节点已设 relative（FAB 定位基准）");
else bad("Campus: 根节点缺少 relative，FAB 会定位到祖先节点");

if (!/✏️ \{t\("writePost"\)\}/.test(campus)) ok("Campus: 顶部大块发帖按钮已移除");
else bad("Campus: 顶部大块发帖按钮仍在");

if (/role="tablist"/.test(campus) && /aria-selected=\{active\}/.test(campus)) {
  ok("Campus: 顶部分段控件语义化（tablist/tab + aria-selected）");
} else bad("Campus: 分段控件缺少 tablist/aria-selected");

if (/data-haptic="light"/.test(campus)) ok("Campus: 分类胶囊显式 Light 强度");
else bad("Campus: 分类胶囊未指定 Light 强度");

// ---------- 5) 行为测试：直接加载真实判定函数，喂各种触摸场景 ----------
/**
 * 把 `src/utils/tapGesture.ts` 拉进来跑（Node ≥22.6 / 24 原生支持直跑 TS）。
 * 这是本次修复的核心，光断言字符串不够 —— 必须验证"滑动不震、轻点才震"。
 */
async function checkTapBehaviour() {
  let mod;
  try {
    mod = await import("../src/utils/tapGesture.ts");
  } catch (err) {
    bad(`无法加载 tapGesture.ts 做行为测试（需要 Node ≥22.6 的 TS 支持）：${err.message}`);
    return;
  }
  const { isConfirmedTap } = mod;
  const button = { name: "button" };
  const otherButton = { name: "other" };
  const mk = (hit, x, y, at) => ({ hit, x, y, at });

  const cases = [
    ["轻点（按下→抬起同一按钮，60ms）", mk(button, 100, 100, 0), mk(button, 100, 100, 60), true],
    ["手指微抖 3px（真实触摸无法完全静止）", mk(button, 100, 100, 0), mk(button, 102, 103, 90), true],
    ["位移 8px（仍在容差内）", mk(button, 100, 100, 0), mk(button, 108, 100, 120), true],
    ["滑动 40px 后松手（列表滚动）", mk(button, 100, 100, 0), mk(button, 140, 100, 200), false],
    ["只纵向下滑 30px", mk(button, 100, 100, 0), mk(button, 100, 130, 200), false],
    ["按下 A 抬起 B（滑动到别的元素）", mk(button, 100, 100, 0), mk(otherButton, 100, 100, 90), false],
    ["长按 1.2s", mk(button, 100, 100, 0), mk(button, 100, 100, 1200), false],
    ["按下记录已被 scroll/cancel 作废", null, mk(button, 100, 100, 60), false],
  ];

  let pass = 0;
  for (const [label, press, release, expected] of cases) {
    const got = isConfirmedTap(press, release);
    if (got === expected) {
      pass += 1;
      ok(`行为: ${label} → ${got ? "震动" : "不震"}`);
    } else {
      bad(`行为: ${label} → 期望${expected ? "震动" : "不震"}，实际${got ? "震动" : "不震"}`);
    }
  }
  notes.push(`  —— 行为测试 ${pass}/${cases.length} 通过`);
}

async function main() {
  await checkTapBehaviour();

  console.log("\n===== UI 细节优化守卫（FAB / 胶囊 / 键盘避让 / 触感时机）=====");
  console.log(notes.join("\n"));
  if (failures.length) {
    console.log("\n----- 问题 -----");
    console.log(failures.join("\n"));
    process.exit(1);
  }
  console.log("\n全部检查通过");
}

void main();
