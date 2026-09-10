/* KazNU Helper — 从 Xcode 工程中剥离 Widget 扩展（KazNUWidgets）
 *
 * 用途：免费 Apple ID（无付费开发者账号）用 Sideloadly / AltStore 侧载时，
 * 带 App Extension 的 IPA 会安装失败（Provisioning doesn't support extensions）。
 * 该脚本把 KazNUWidgets target 及其 Embed App Extensions 阶段、依赖、文件引用
 * 从 project.pbxproj 中移除，同时移除 App Groups 权限（免费账号不可用，
 * 且该权限只服务于已删除的桌面小组件），从而得到可侧载的“无扩展”包。
 *
 * 注意：Live Activity / 灵动岛需要 Widget 扩展渲染，因此只能在带扩展的完整包里测试。
 *
 * 用法：
 *   node scripts/strip-ios-widget-target.cjs [project.pbxproj 路径]
 * 发现不了目标时会安全退出（exit 0），确保不会误伤工程。
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const PROJ = process.argv[2] || path.join(ROOT, 'ios/App/App.xcodeproj/project.pbxproj')
const TARGET_NAME = process.env.KAZNU_WIDGET_TARGET || 'KazNUWidgets'
const ENTITLEMENTS = path.join(path.dirname(PROJ), '..', 'App', 'App.entitlements')

let text = fs.readFileSync(PROJ, 'utf8')
const original = text

// ---------- 1. 解析所有对象块（括号配平，兼容单行 / 多行对象） ----------
function parseObjects(source) {
  const objects = []
  const startRe = /^\t\t([0-9A-F]{24})(?:\s*\/\*\s*([^*]*?)\s*\*\/)?\s*=\s*\{/gm
  let m
  while ((m = startRe.exec(source)) !== null) {
    const id = m[1]
    const braceStart = source.indexOf('{', m.index + id.length)
    let depth = 0
    let braceEnd = -1
    for (let i = braceStart; i < source.length; i++) {
      const ch = source[i]
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          braceEnd = i
          break
        }
      }
    }
    if (braceEnd === -1) break
    let end = braceEnd + 1
    if (source[end] === ';') end++
    if (source[end] === '\n') end++
    objects.push({
      id,
      comment: m[2] || '',
      body: source.slice(braceStart + 1, braceEnd),
      start: m.index,
      end,
    })
    startRe.lastIndex = end
  }
  return objects
}

const blocks = parseObjects(text)
const byId = new Map(blocks.map((b) => [b.id, b]))
const isaOf = (b) => {
  const m = /isa = ([A-Za-z]+);/.exec(b.body || '')
  return m ? m[1] : ''
}
const listRefs = (body, key) => {
  const m = new RegExp(`${key} = \\(([\\s\\S]*?)\\);`).exec(body || '')
  if (!m) return []
  return [...m[1].matchAll(/([0-9A-F]{24})/g)].map((x) => x[1])
}
const singleRef = (body, key) => {
  const m = new RegExp(`${key} = ([0-9A-F]{24})`).exec(body || '')
  return m ? m[1] : null
}

// ---------- 2. 定位 Widget target 及其全部关联对象 ----------
const target = blocks.find((b) => isaOf(b) === 'PBXNativeTarget' && b.body.includes(`name = ${TARGET_NAME};`))
if (!target) {
  console.log(`[strip] 未找到 target "${TARGET_NAME}"，工程已不含 Widget 扩展，跳过。`)
  process.exit(0)
}

const remove = new Set([target.id])
const addBlock = (id) => { if (id) remove.add(id) }
const addBlockAndItsList = (id, key) => {
  const b = byId.get(id)
  if (!b) return
  addBlock(id)
  for (const child of listRefs(b.body, key)) addBlock(child)
}

// 构建配置（Debug / Release）
addBlockAndItsList(singleRef(target.body, 'buildConfigurationList'), 'buildConfigurations')
// 构建阶段（Sources / Frameworks）及其包含的 build file
const phaseIds = listRefs(target.body, 'buildPhases')
for (const phaseId of phaseIds) {
  const phase = byId.get(phaseId)
  addBlock(phaseId)
  if (phase) for (const f of listRefs(phase.body, 'files')) addBlock(f)
}
// 产物引用（KazNUWidgets.appex）
const productId = singleRef(target.body, 'productReference')
addBlock(productId)
// 依赖（App → Widget）+ container item proxy
// 注意：pbxproj 里常带内联注释（`target = <ID> /* KazNUWidgets */;`），因此用前缀匹配。
const depIds = new Set([
  ...blocks.filter((b) => isaOf(b) === 'PBXTargetDependency' && b.body.includes(`target = ${target.id}`)).map((b) => b.id),
])
for (const depId of depIds) {
  const dep = byId.get(depId)
  addBlock(depId)
  if (dep) addBlock(singleRef(dep.body, 'targetProxy'))
}
for (const b of blocks) {
  if (isaOf(b) === 'PBXContainerItemProxy' && b.body.includes(`remoteGlobalIDString = ${target.id}`)) addBlock(b.id)
}
// 引用 .appex 产物的 build file（Embed App Extensions）+ 该 Copy Files 阶段
for (const b of blocks) {
  if (isaOf(b) === 'PBXBuildFile' && b.body.includes(`fileRef = ${productId}`)) addBlock(b.id)
}
for (const b of blocks) {
  if (isaOf(b) !== 'PBXCopyFilesBuildPhase') continue
  if (listRefs(b.body, 'files').some((f) => remove.has(f))) addBlock(b.id)
}
// Widget 源码组及其文件引用（含 Info.plist / entitlements）
for (const b of blocks) {
  if (isaOf(b) !== 'PBXGroup' || !/path = KazNUWidgets;/.test(b.body)) continue
  addBlock(b.id)
  for (const child of listRefs(b.body, 'children')) {
    addBlock(child)
    // 引用被删文件引用的 build file 也要一起删
    for (const bf of blocks) {
      if (isaOf(bf) === 'PBXBuildFile' && bf.body.includes(`fileRef = ${child}`)) addBlock(bf.id)
    }
  }
}

// ---------- 3. 删除对象块（从后往前，保证索引有效） ----------
const ranges = [...remove]
  .map((id) => byId.get(id))
  .filter(Boolean)
  .map((b) => [b.start, b.end])
  .sort((a, b) => b[0] - a[0])
for (const [start, end] of ranges) text = text.slice(0, start) + text.slice(end)

// ---------- 4. 删除所有对它们的引用（列表项 + TargetAttributes 字典项） ----------
const countOf = (id) => (text.match(new RegExp(id, 'g')) || []).length
for (const id of remove) {
  // children = ( ... ) / files = ( ... ) / buildPhases = ( ... ) / targets = ( ... ) 等列表项
  text = text.replace(new RegExp(`^[ \\t]*${id}(?:\\s*/\\*[^*]*\\*/)?,[ \\t]*\\n`, 'gm'), '')
  // PBXProject.TargetAttributes 中的字典项：`<ID> = { ... };`
  text = text.replace(new RegExp(`^[ \\t]*${id}\\s*=\\s*\\{[\\s\\S]*?\\n[ \\t]*\\};[ \\t]*\\n`, 'gm'), '')
  if (countOf(id) > 0) {
    console.error(`[strip] 清理失败：${id} 仍有 ${countOf(id)} 处引用，已中止以免破坏工程：`)
    text
      .split('\n')
      .map((line, index) => [index + 1, line])
      .filter(([, line]) => line.includes(id))
      .slice(0, 5)
      .forEach(([lineNo, line]) => console.error(`  行 ${lineNo}: ${line.trim()}`))
    process.exit(1)
  }
}

// ---------- 5. 清理被清空的 section ----------
text = text.replace(/\/\* Begin ([A-Za-z]+) section \*\/\n+\/\* End \1 section \*\/\n+/g, '')

// ---------- 6. 移除 App Groups 权限 ----------
// 免费 Apple ID 不支持该能力；它只服务于已删除的桌面小组件。
// App 端代码有兜底：KaznuLessonStore 拿不到 App Group 时会回退到标准 UserDefaults。
let entitlementsChanged = false
if (fs.existsSync(ENTITLEMENTS)) {
  const src = fs.readFileSync(ENTITLEMENTS, 'utf8')
  const next = src.replace(/\s*<key>com\.apple\.security\.application-groups<\/key>\s*<array>[\s\S]*?<\/array>/, '')
  if (next !== src) {
    fs.writeFileSync(ENTITLEMENTS, next)
    entitlementsChanged = true
  }
}

// ---------- 7. 自检后写回 ----------
const problems = []
if (!text.includes('PRODUCT_BUNDLE_IDENTIFIER = com.kaznu.helper;')) problems.push('App target 的 bundle id 丢失')
if (/name = KazNUWidgets;/.test(text)) problems.push('KazNUWidgets target 仍然存在')
if (/path = KazNUWidgets;/.test(text)) problems.push('KazNUWidgets 文件组仍然存在')
let brace = 0
let paren = 0
for (const ch of text) {
  if (ch === '{') brace++
  else if (ch === '}') brace--
  else if (ch === '(') paren++
  else if (ch === ')') paren--
}
if (brace !== 0 || paren !== 0) problems.push(`定界符不配平 braces=${brace} parens=${paren}`)
if (problems.length) {
  console.error('[strip] 自检未通过，未写入工程：')
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}

fs.writeFileSync(PROJ, text)
console.log('[strip] 已从 Xcode 工程移除 Widget 扩展：')
console.log(`  project.pbxproj : 移除 ${ranges.length} 个对象、${original.length - text.length} 字节`)
console.log(`  App.entitlements: ${entitlementsChanged ? '已移除 App Groups（免费账号不可用）' : '未改动'}`)
console.log('  提示：该包不含 Widget 扩展，锁屏 / 灵动岛不会出现，仅用于 App 功能测试。')
