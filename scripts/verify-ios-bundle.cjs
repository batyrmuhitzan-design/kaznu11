#!/usr/bin/env node
/**
 * 守卫：iOS 工程里那份"打包进 App 的网页资源"是否是最新构建。
 *
 *   node scripts/verify-ios-bundle.cjs
 *
 * 为什么需要它（真机排查踩过的坑）：
 *   iOS 的 WebView 加载的是 `ios/App/App/public/`（由 `npx cap sync ios` 从 `dist/` 拷进去），
 *   不是 `dist/` 本身。任何人只要在改完前端后**直接用 Xcode 打包**、没跑 cap sync，
 *   装到手机上的就是上一次的旧包 —— 表现是"网页上有这个模块，手机上根本没有"，
 *   而且怎么调前端代码都不生效（因为手机里跑的是旧 JS）。
 *
 * 判定方式：比对两边 index.html 里引用的入口脚本文件名（vite 的 hash 名）。
 *   目录不存在 → 跳过（CI 里是 cap sync 现生成的，不报错）。
 *   目录存在但 hash 不一致 → **报错**，提示重新同步。
 */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const distIndex = path.join(root, "dist", "index.html");
const publicDir = path.join(root, "ios", "App", "App", "public");
const publicIndex = path.join(publicDir, "index.html");

const entryOf = (html) => {
  const script = /<script[^>]+src="([^"]+)"/.exec(html);
  const style = /<link[^>]+href="([^"]+\.css)"/.exec(html);
  return {
    js: script ? path.basename(script[1]) : null,
    css: style ? path.basename(style[1]) : null,
  };
};

if (!fs.existsSync(distIndex)) {
  console.log("  [--] 没有 dist/index.html，跳过（先 npm run build）");
  process.exit(0);
}
if (!fs.existsSync(publicIndex)) {
  console.log("  [--] 没有 ios/App/App/public/index.html，跳过（CI 里由 npx cap sync ios 生成）");
  process.exit(0);
}

const dist = entryOf(fs.readFileSync(distIndex, "utf8"));
const shipped = entryOf(fs.readFileSync(publicIndex, "utf8"));

if (dist.js && shipped.js === dist.js && shipped.css === dist.css) {
  console.log(`  [ok] iOS 打包资源与 dist 一致（${dist.js} / ${dist.css}）`);
  process.exit(0);
}

console.error("  [!!] iOS 工程里的网页资源是**旧构建** —— 手机上跑的不是你刚改的代码");
console.error(`       dist         : ${dist.js} / ${dist.css}`);
console.error(`       ios App 里实际: ${shipped.js} / ${shipped.css}`);
console.error("       修复：npm run build && npx cap sync ios（或 npm run ios:sync）");
process.exit(1);
