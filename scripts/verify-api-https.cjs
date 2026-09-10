/* KazNU Helper — 后端地址 / HTTPS 策略自检
 *
 * 约束（破坏任意一条即失败）：
 *  1) App 内唯一后端域名来自 src/utils/config.ts，且默认值为 https://1losion.me；
 *  2) 源码 / 配置 / iOS 原生文件里不出现明文 http:// 后端地址（注释与文档除外）；
 *  3) http → https 的强制升级与请求守卫函数存在，并被真实网络层调用；
 *  4) iOS Info.plist 明确只允许 HTTPS（ATS: NSAllowsArbitraryLoads = false）；
 *  5) .env / .env.example 的 VITE_API_URL 为 https；
 *  6) 若存在 dist/ 构建产物：不得含 http://127.0.0.1:8000，且必须含 https://1losion.me。
 *
 * 用法：node scripts/verify-api-https.cjs
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const problems = []
const notes = []
const ok = (m) => notes.push('  [ok] ' + m)
const bad = (m) => problems.push('  [!!] ' + m)

const EXPECTED_HOST = 'https://1losion.me'
/** 注释、XML DOCTYPE 等非代码行不参与明文地址检查 */
const isComment = (line) => /^\s*(\/\/|\/\*|\*|#|<!--|<!DOCTYPE|<\?xml)/.test(line)

/**
 * 递归收集文件（跳过 node_modules / dist / 构建产物 / 服务端目录等）。
 * 说明：backend/ 与 docker-compose.yml 是**服务器内部**（容器 loopback 健康检查走 http，
 * 域名入口由 Caddy 终结 TLS），不属于 App 发起的请求，故不在本自检范围内。
 */
function collect(dir, results = []) {
  if (!fs.existsSync(dir)) return results
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    const rel = path.relative(ROOT, full).replace(/\\/g, '/')
    if (entry.isDirectory()) {
      if (/^(node_modules|dist|\.git|venv|\.venv|__pycache__|\.figma|build|backend|deploy)$/.test(entry.name)) continue
      if (/^ios\/App\/App\/public/.test(rel)) continue // WebView 打包产物
      collect(full, results)
      continue
    }
    if (/^(docker-compose\.yml)$/.test(entry.name)) continue // 服务器内部编排
    if (/\.(ts|tsx|js|jsx|json|html|swift|plist|yml|yaml)$/.test(entry.name) || entry.name.startsWith('.env')) {
      results.push(full)
    }
  }
  return results
}

// ---------- 1. 唯一配置源 ----------
const CONFIG = path.join(ROOT, 'src/utils/config.ts')
if (!fs.existsSync(CONFIG)) {
  bad('缺少 src/utils/config.ts（唯一的后端地址来源）')
} else {
  const src = fs.readFileSync(CONFIG, 'utf8')
  const hostMatch = /export const API_HOST\s*=\s*"([^"]+)"/.exec(src)
  if (!hostMatch) bad('src/utils/config.ts 缺少 API_HOST 常量')
  else if (hostMatch[1] !== EXPECTED_HOST) bad(`API_HOST 不是 ${EXPECTED_HOST}，实际为 ${hostMatch[1]}`)
  else ok(`API_HOST = ${EXPECTED_HOST}`)

  if (/export function normalizeBaseUrl/.test(src)) ok('存在 normalizeBaseUrl()（强制 http → https）')
  else bad('缺少 normalizeBaseUrl()：无法保证明文地址被升级')
  if (/export function blockInsecureRequest/.test(src)) ok('存在 blockInsecureRequest()（网络层守卫）')
  else bad('缺少 blockInsecureRequest() 请求守卫')
  if (src.includes('const upgraded = normalized.replace(') && src.includes('"https://"')) {
    ok('明文地址会被自动替换为 https://')
  } else {
    bad('未找到 http → https 的替换逻辑')
  }
  if (/VITE_ALLOW_INSECURE_HTTP/.test(src) && /env\.DEV === true/.test(src)) {
    ok('明文例外仅在 dev 构建 + 显式开关下生效')
  } else {
    bad('未找到 dev-only 的明文例外开关')
  }
}

// ---------- 2. 网络层必须真正调用守卫 ----------
for (const rel of ['src/services/ProfReviewsService.ts', 'src/utils/update.ts']) {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) {
    bad(`缺少网络层文件 ${rel}`)
    continue
  }
  const src = fs.readFileSync(abs, 'utf8')
  if (src.includes('blockInsecureRequest')) ok(`${rel} 调用 blockInsecureRequest() 守卫`)
  else bad(`${rel} 未调用 blockInsecureRequest()，明文请求可能被发出`)
}

// ---------- 3. 源码 / 配置里不得残留明文后端地址 ----------
const files = collect(ROOT)
const violators = []
for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/')
  const text = fs.readFileSync(file, 'utf8')
  text.split('\n').forEach((line, index) => {
    if (isComment(line)) return
    // 只关心指向后端/本机的明文 http（忽略 XML 命名空间等）
    const hits = line.match(/http:\/\/(?!www\.w3\.org|schemas\.|ns\.adobe\.com|apple\.com|plist)[\w.-]+/g)
    if (hits) violators.push(`${rel}:${index + 1}: ${hits.join(', ')} | ${line.trim().slice(0, 100)}`)
  })
}
if (violators.length === 0) ok(`扫描 ${files.length} 个源码/配置文件：无明文 http:// 后端地址`)
else {
  bad(`发现 ${violators.length} 处明文 http:// 地址：`)
  violators.slice(0, 12).forEach((v) => problems.push('     ' + v))
}

// ---------- 4. iOS ATS ----------
const PLIST = path.join(ROOT, 'ios/App/App/Info.plist')
if (!fs.existsSync(PLIST)) {
  bad('缺少 ios/App/App/Info.plist')
} else {
  const plist = fs.readFileSync(PLIST, 'utf8')
  if (/<key>NSAppTransportSecurity<\/key>[\s\S]*?<key>NSAllowsArbitraryLoads<\/key>\s*<false\/>/.test(plist)) {
    ok('Info.plist：ATS 已声明 NSAllowsArbitraryLoads = false（只允许 HTTPS）')
  } else {
    bad('Info.plist 未明确禁止明文加载（NSAllowsArbitraryLoads = false）')
  }
  if (/<key>NSAllowsLocalNetworking<\/key>\s*<false\/>/.test(plist)) ok('Info.plist：本地明文网络也被禁用')
  else notes.push('  [--] Info.plist 未显式设置 NSAllowsLocalNetworking')
}

// ---------- 5. .env ----------
for (const rel of ['.env', '.env.example']) {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) continue
  const env = fs.readFileSync(abs, 'utf8')
  const match = /^VITE_API_URL=(.*)$/m.exec(env)
  if (!match) bad(`${rel} 缺少 VITE_API_URL`)
  else if (match[1].trim().startsWith('https://')) ok(`${rel}: VITE_API_URL = ${match[1].trim()}`)
  else bad(`${rel}: VITE_API_URL 不是 https（${match[1].trim()}）`)
}

// ---------- 6. 构建产物 ----------
const distAssets = path.join(ROOT, 'dist/assets')
if (fs.existsSync(distAssets)) {
  const bundles = fs.readdirSync(distAssets).filter((f) => f.endsWith('.js'))
  let cleartext = 0
  let hasHost = 0
  for (const bundle of bundles) {
    const text = fs.readFileSync(path.join(distAssets, bundle), 'utf8')
    if (text.includes('http://127.0.0.1:8000')) cleartext++
    if (text.includes(EXPECTED_HOST)) hasHost++
  }
  if (bundles.length === 0) notes.push('  [--] dist/assets 为空，跳过构建产物检查')
  else if (cleartext > 0) bad(`构建产物含明文回退地址 http://127.0.0.1:8000（${cleartext} 个 bundle）`)
  else if (hasHost > 0) ok(`构建产物 ok：无 http://127.0.0.1:8000，且包含 ${EXPECTED_HOST}`)
  else bad(`构建产物里找不到 ${EXPECTED_HOST}，请确认已重新构建`)
} else {
  notes.push('  [--] 未发现 dist/ 构建产物，跳过（先 npm run build 可完整校验）')
}

console.log('\n===== 后端地址 / HTTPS 自检 =====')
console.log(notes.join('\n'))
if (problems.length) {
  console.log('\n----- 问题 -----')
  console.log(problems.join('\n'))
  process.exit(1)
}
console.log('\n全部检查通过')
