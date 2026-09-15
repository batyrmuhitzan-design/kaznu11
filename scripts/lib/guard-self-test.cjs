/**
 * 守卫的"负向自检"：把**修复前**的真实代码片段喂给守卫的选择器，
 * 确认它会报错。否则"全绿"可能只是因为断言写错了（永远匹配不到）。
 */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const login = fs.readFileSync(path.join(root, "src/views/LoginScreen.tsx"), "utf8");

const buggyBlock = `
 {/* 法律条款强制同意 */}
 <button type="button" role="checkbox" aria-checked={agreed} onClick={() => setAgreed(!agreed)} className="haptic-action mt-5 w-full flex items-start gap-2.5 text-left">
   <span className="flex-1 text-xs font-medium leading-relaxed">
     I agree to the Terms of Service and Privacy Policy{" "}
     <button type="button" onClick={() => setShowLegal(true)} className="inline text-[13px] font-bold underline">
       Terms &amp; Privacy Policy
     </button>
   </span>
 </button>
 {!agreed && (<p>Please agree to the terms to continue</p>)}
`;

const fixedBlock = login.split("{/* 法律条款强制同意")[1].split("Please agree to the terms")[0];

const checks = [
  ["内层 button 嵌套（修复前）", /<button[^>]*role="checkbox"/.test(buggyBlock), true],
  ["stopPropagation 缺失（修复前）", /event\.stopPropagation\(\)/.test(buggyBlock), false],
  ["z-10 缺失（修复前）", /relative z-10/.test(buggyBlock), false],
  ["内层 button 嵌套（修复后）", /<button[^>]*role="checkbox"/.test(fixedBlock), false],
  ["stopPropagation 存在（修复后）", /event\.stopPropagation\(\)/.test(fixedBlock), true],
  ["z-10 存在（修复后）", /relative z-10/.test(fixedBlock), true],
  ["键盘支持存在（修复后）", /tabIndex=\{0\}/.test(fixedBlock) && /onKeyDown/.test(fixedBlock), true],
];

let failed = 0;
console.log("\n=== 守卫负向自检（选择器确实能分辨好/坏代码）===");
for (const [label, actual, expected] of checks) {
  const pass = actual === expected;
  if (!pass) failed += 1;
  console.log(`  ${pass ? "[ok]" : "[!!]"} ${label} → ${actual}（期望 ${expected}）`);
}

// 顺带自检：".light [style*=235]" 的选择器必须能区分"注释里提到"与"真的写了规则"
const css = fs.readFileSync(path.join(root, "src/index.css"), "utf8");
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, "");
const cssBug = '.light [style*="235"] { color: rgba(60,60,67,0.62) !important; }';
const a = /\.light \[style\*="235"\]\s*\{/.test(cssCode);
const b = /\.light \[style\*="235"\]\s*\{/.test(cssBug.replace(/\/\*[\s\S]*?\*\//g, ""));
console.log(`  ${a === false ? "[ok]" : "[!!]"} 真实 css 不含该 hack → ${a}（期望 false）`);
console.log(`  ${b === true ? "[ok]" : "[!!]"} 注入的坏 css 能被识别 → ${b}（期望 true）`);
if (a !== false || b !== true) failed += 1;

console.log(failed ? `\n负向自检失败 ${failed} 项` : "\n负向自检通过");
process.exit(failed ? 1 : 0);
