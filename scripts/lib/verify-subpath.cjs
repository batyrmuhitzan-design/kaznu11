/**
 * 验证"子路径部署"（https://1losion.me/app/）下构建产物能否正确加载。
 *
 * 为什么需要：站点挂在 /app/ 下，但构建曾用根绝对路径 /assets/... → 实测 404。
 * 这里在本地起一个把 dist 挂在 /app/ 的静态服务，抓 HTML 再按 HTML 里的引用去取资源，
 * 全绿即代表线上同样的挂载方式不会再 404。
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const dist = path.resolve(__dirname, "..", "..", "dist");
const MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".pdf": "application/pdf",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (!urlPath.startsWith("/app/")) {
    res.writeHead(404).end("not under /app/");
    return;
  }
  let rel = urlPath.slice("/app/".length);
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  const file = path.join(dist, rel);
  if (!file.startsWith(dist) || !fs.existsSync(file)) {
    res.writeHead(404).end("404");
    return;
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" });
  res.end(fs.readFileSync(file));
});

const get = (port, p) =>
  new Promise((resolve) => {
    http
      .get({ host: "127.0.0.1", port, path: p }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      })
      .on("error", () => resolve({ status: 0, body: "" }));
  });

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const results = [];

  const html = await get(port, "/app/");
  results.push(["/app/ (index.html)", html.status, 200]);

  // 按 HTML 里真实写着的引用去取资源（这才是浏览器会做的事）
  const refs = [...html.body.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  const assetRefs = refs.filter((r) => /\.(js|css)$/.test(r));
  for (const ref of assetRefs) {
    // 相对路径 → 以 /app/ 为基址解析
    const resolved = new URL(ref, `http://127.0.0.1:${port}/app/`).pathname;
    const res = await get(port, resolved);
    results.push([`${ref} → ${resolved}`, res.status, 200]);
  }

  // PDF 也必须能取到（登录页"打开条款 PDF"用同一个解析规则）
  const pdf = await get(port, "/app/KazNU_Helper_Legal_Notice_3Lang.pdf");
  results.push(["/app/KazNU_Helper_Legal_Notice_3Lang.pdf", pdf.status, 200]);

  server.close();

  let failed = 0;
  console.log("\n=== 子路径部署（/app/）资源解析自检 ===");
  for (const [label, actual, expected] of results) {
    const pass = actual === expected;
    if (!pass) failed += 1;
    console.log(`  ${pass ? "[ok]" : "[!!]"} ${label} → ${actual}（期望 ${expected}）`);
  }
  console.log(failed ? `\n失败 ${failed} 项` : "\n子路径部署自检通过");
  process.exit(failed ? 1 : 0);
})();
