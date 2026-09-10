/* KazNU Helper — iOS Live Activity 交付自检脚本
 * 校验 project.pbxproj 结构完整性：定界符配平、ID 引用可解析、引用的 Swift 文件存在、
 * Sources 构建阶段内容正确、旧文件名已清除。
 * 用法：node scripts/verify-ios-live-activity.cjs
 */
const fs = require('fs')
const path = require('path')

const args = process.argv.slice(2)
function argValue(name, fallback) {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  if (hit === `--${name}`) return true
  return hit.slice(name.length + 3)
}

const ROOT = path.join(__dirname, '..')
const PROJ = String(argValue('project', path.join(ROOT, 'ios/App/App.xcodeproj/project.pbxproj')))
// 是否期望工程里带 Widget 扩展（--expect-widget=no 用于校验“无扩展侧载包”）
const expectWidget = String(argValue('expect-widget', 'yes')) !== 'no'
const APP_ROOT = path.dirname(path.dirname(PROJ)) // .../ios/App
const APP_DIR = path.join(APP_ROOT, 'App')
const WIDGET_DIR = path.join(APP_ROOT, 'KazNUWidgets')

const problems = []
const notes = []
function ok(msg) { notes.push('  [ok] ' + msg) }
function bad(msg) { problems.push('  [!!] ' + msg) }

console.log(`校验工程: ${PROJ}`)
console.log(`期望包含 Widget 扩展: ${expectWidget ? 'yes' : 'no'}`)

// ---------------------------------------------------------------- pbxproj
const text = fs.readFileSync(PROJ, 'utf8')

let brace = 0
let paren = 0
for (const ch of text) {
  if (ch === '{') brace++
  else if (ch === '}') brace--
  else if (ch === '(') paren++
  else if (ch === ')') paren--
}
if (brace === 0 && paren === 0) ok('pbxproj 大括号/圆括号配平')
else bad(`pbxproj 定界符不配平: braces=${brace} parens=${paren}`)

const objectsBody = text.slice(text.indexOf('objects = {'), text.lastIndexOf('};'))
const defined = new Set([...objectsBody.matchAll(/^\t\t([0-9A-F]{24})\s*(?:\/\*[\s\S]*?\*\/\s*)?= \{/gm)].map((m) => m[1]))
const referenced = new Set([...text.matchAll(/([0-9A-F]{24})/g)].map((m) => m[1]))
const dangling = [...referenced].filter((id) => !defined.has(id))
if (dangling.length === 0) ok(`pbxproj ${referenced.size} 个 ID 引用全部可解析（objects 定义 ${defined.size} 个）`)
else bad(`pbxproj 存在悬空引用: ${dangling.join(', ')}`)

const fileRefs = {}
for (const m of objectsBody.matchAll(/^\t\t([0-9A-F]{24})\s*\/\*\s*([^*]+?)\s*\*\/\s*=\s*\{isa = PBXFileReference;([\s\S]*?)\};/gm)) {
  const p = /path = (?:"([^"]+)"|([^;]+));/.exec(m[3])
  fileRefs[m[1]] = { comment: m[2], rel: p ? (p[1] || p[2]).trim() : null }
}

const groups = {}
for (const m of objectsBody.matchAll(/^\t\t([0-9A-F]{24})\s*(?:\/\*\s*([^*]+?)\s*\*\/\s*)?=\s*\{\s*isa = PBXGroup;([\s\S]*?)\n\t\t\};/gm)) {
  const body = m[3]
  const p = /path = (?:"([^"]+)"|([^;]+));/.exec(body)
  groups[m[1]] = {
    children: [...body.matchAll(/^\t\t\t\t([0-9A-F]{24})/gm)].map((c) => c[1]),
    path: p ? (p[1] || p[2]).trim() : null,
    name: m[2] || null,
  }
}
const parent = {}
for (const [gid, g] of Object.entries(groups)) for (const c of g.children) parent[c] = gid

function dirOf(groupId) {
  const parts = []
  let cur = groupId
  const guard = new Set()
  while (cur && !guard.has(cur)) {
    guard.add(cur)
    const g = groups[cur]
    if (!g) break
    if (g.path) parts.unshift(g.path)
    cur = parent[cur]
  }
  return path.join(APP_ROOT, ...parts)
}

let swiftChecked = 0
for (const [id, ref] of Object.entries(fileRefs)) {
  if (!ref.rel || !ref.rel.endsWith('.swift')) continue
  const owner = parent[id]
  if (!owner || !groups[owner]) continue
  swiftChecked++
  const abs = path.join(dirOf(owner), ref.rel)
  if (!fs.existsSync(abs)) bad(`pbxproj 引用的 Swift 文件不存在: ${abs}`)
}
ok(`解析到 ${Object.keys(fileRefs).length} 个 PBXFileReference、${Object.keys(groups).length} 个 PBXGroup`)
if (swiftChecked > 0) ok(`pbxproj 内 ${swiftChecked} 个 Swift fileRef 均指向真实存在的文件`)
else bad('未能从 pbxproj 解析出 Swift fileRef，请检查脚本解析逻辑')

const sources = [...objectsBody.matchAll(/isa = PBXSourcesBuildPhase;[\s\S]*?files = \(([\s\S]*?)\);/g)]
  .map((m) => [...m[1].matchAll(/\/\*\s*([^*]+?)\s*\*\/,/g)].map((x) => x[1]))
const appSources = sources[0] || []
const widgetSources = sources[1] || []
const expectApp = ['AppDelegate.swift', 'SceneDelegate.swift', 'KaznuBridgeViewController.swift', 'KaznuCourseAttributes.swift', 'KaznuActivityManager.swift', 'BackgroundReminderScheduler.swift', 'KaznuLiveActivityPlugin.swift']
const expectWidgetFiles = ['KaznuCourseAttributes.swift', 'KazNUOverviewWidget.swift', 'KaznuCourseLiveActivity.swift']
for (const f of expectApp) if (!appSources.some((s) => s === `${f} in Sources`)) bad(`App target Sources 缺少 ${f}`)
if (expectWidget) {
  for (const f of expectWidgetFiles) if (!widgetSources.some((s) => s === `${f} in Sources`)) bad(`KazNUWidgets target Sources 缺少 ${f}`)
  if (appSources.length === expectApp.length && widgetSources.length === expectWidgetFiles.length) {
    ok(`Sources 构建阶段正确：App=${appSources.length} 个、KazNUWidgets=${widgetSources.length} 个`)
  } else {
    bad(`Sources 文件数异常：App=${appSources.length}(期望 ${expectApp.length})、KazNUWidgets=${widgetSources.length}(期望 ${expectWidgetFiles.length})`)
    bad('  App: ' + JSON.stringify(appSources))
    bad('  Widgets: ' + JSON.stringify(widgetSources))
  }
} else {
  if (sources.length === 1 && appSources.length === expectApp.length) {
    ok(`无扩展工程：只剩 App 一个 Sources 阶段（${appSources.length} 个文件）`)
  } else {
    bad(`无扩展工程仍有多余构建阶段：共 ${sources.length} 个 Sources 阶段，App=${appSources.length} 个文件`)
  }
  const leftover = (text.match(/KazNUWidgets/g) || []).length
  if (leftover === 0) ok('工程中已无 KazNUWidgets 任何引用')
  else bad(`工程中仍残留 KazNUWidgets 引用 ${leftover} 处`)
}

const gone = ['TimetableActivityAttributes', 'TimetableLiveActivityController', 'TimetableLiveActivityViews', 'TimetableLiveActivityWidget', 'TimetableLiveActivity']
const still = gone.filter((n) => text.includes(n))
if (still.length === 0) ok('pbxproj 已无旧 Live Activity 名称')
else bad('pbxproj 仍残留旧名称: ' + still.join(', '))

// ---------------------------------------------------------------- Swift 源码
function checkSwift(dir, files) {
  for (const f of files) {
    const abs = path.join(dir, f)
    if (!fs.existsSync(abs)) { bad(`缺少文件 ${abs}`); continue }
    const src = fs.readFileSync(abs, 'utf8')
    let b = 0
    let p = 0
    let s = 0
    let line = 1
    let broken = null
    for (const ch of src) {
      if (ch === '\n') line++
      else if (ch === '{') b++
      else if (ch === '}') b--
      else if (ch === '(') p++
      else if (ch === ')') p--
      else if (ch === '[') s++
      else if (ch === ']') s--
      if ((b < 0 || p < 0 || s < 0) && !broken) broken = line
    }
    if (b !== 0 || p !== 0 || s !== 0) bad(`${f} 定界符不配平: {}=${b} ()=${p} []=${s}`)
    else ok(`${f} 定界符配平`)
    if (broken) bad(`${f} 第 ${broken} 行出现多余闭合符号`)
    const smart = src.match(/[\u2018\u2019\u201C\u201D\u2013\u2014]/)
    if (smart) {
      // 中文注释里的 “” 是本仓库既有风格（不在字符串字面量中，不影响编译），只检查代码行
      const codeLines = src
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
      const hit = codeLines.find((l) => /[\u2018\u2019\u201C\u201D]/.test(l))
      if (hit) bad(`${f} 代码行含智能引号（会导致编译失败）: ${hit.trim().slice(0, 60)}`)
    }
    if (src.includes('\t')) bad(`${f} 含制表符`)
    if (!src.endsWith('\n')) bad(`${f} 结尾无换行`)
  }
}

checkSwift(APP_DIR, ['AppDelegate.swift', 'SceneDelegate.swift', 'KaznuBridgeViewController.swift', 'KaznuLiveActivityPlugin.swift', 'BackgroundReminderScheduler.swift', 'KaznuActivityManager.swift', 'KaznuCourseAttributes.swift'])
if (expectWidget) {
  checkSwift(WIDGET_DIR, ['KaznuCourseLiveActivity.swift', 'KaznuCourseAttributes.swift', 'KazNUOverviewWidget.swift'])
}

const a = fs.readFileSync(path.join(APP_DIR, 'KaznuCourseAttributes.swift'), 'utf8')
const w = fs.readFileSync(path.join(WIDGET_DIR, 'KaznuCourseAttributes.swift'), 'utf8')
if (a === w) ok('KaznuCourseAttributes.swift 两 Target 副本逐字节一致')
else bad('KaznuCourseAttributes.swift 两份副本不一致（ActivityKit 要求完全一致）')

const legacySymbols = ['TimetableLiveActivityAttributes', 'TimetableLiveActivityController', 'TimetableActivityStyle', 'CountdownRingView']
let legacyHits = 0
for (const [dir, files] of [[APP_DIR, fs.readdirSync(APP_DIR)], [WIDGET_DIR, fs.readdirSync(WIDGET_DIR)]]) {
  for (const f of files) {
    if (!f.endsWith('.swift')) continue
    const src = fs.readFileSync(path.join(dir, f), 'utf8')
    for (const legacy of legacySymbols) {
      if (src.includes(legacy)) { bad(`${f} 仍引用已删除的 ${legacy}`); legacyHits++ }
    }
  }
}
if (legacyHits === 0) ok('Swift 源码无旧类型残留引用')

for (const [label, p] of [['App', path.join(APP_DIR, 'Info.plist')], ['KazNUWidgets', path.join(WIDGET_DIR, 'Info.plist')]]) {
  const plist = fs.readFileSync(p, 'utf8')
  if (/<key>NSSupportsLiveActivities<\/key>\s*<true\/>/.test(plist)) ok(`${label} Info.plist 已声明 NSSupportsLiveActivities = YES`)
  else bad(`${label} Info.plist 缺少 NSSupportsLiveActivities = YES`)
}

// 关键 API 与颜色阈值落地检查
const manager = fs.readFileSync(path.join(APP_DIR, 'KaznuActivityManager.swift'), 'utf8')
const checks = [
  ['Activity.request', /Activity< KaznuCourseAttributes>\.request|Activity<KaznuCourseAttributes>\.request/],
  ['activity.update', /activity\.update\(ActivityContent/],
  ['dismissalPolicy', /dismissalPolicy: \.immediate/],
  ['课前 30 分钟窗口', /preClassLeadSeconds: TimeInterval = 30 \* 60/],
  ['下节课 15 分钟切换', /nextClassSwitchSeconds: TimeInterval = 15 \* 60/],
  ['单例 shared', /public static let shared = KaznuActivityManager\(\)/],
]
for (const [label, re] of checks) {
  if (re.test(manager)) ok(`KaznuActivityManager: ${label}`)
  else bad(`KaznuActivityManager 缺少 ${label}`)
}

const attributes = a
const attrChecks = [
  ['静态属性 courseName', /public let courseName: String/],
  ['静态属性 roomNumber', /public let roomNumber: String/],
  ['静态属性 teacherName', /public let teacherName: String/],
  ['动态 remainingSeconds', /public var remainingSeconds: Double/],
  ['动态 totalSeconds', /public var totalSeconds: Double/],
  ['动态 phase', /public var phase: KaznuCoursePhase/],
  ['动态 progress', /public var progress: Double/],
  ['阶段 preClass/inClass', /case preClass|\n    case inClass/],
  ['阈值 0.6', /safeThreshold: Double = 0\.6/],
  ['阈值 0.2', /criticalThreshold: Double = 0\.2/],
]
for (const [label, re] of attrChecks) {
  if (re.test(attributes)) ok(`KaznuCourseAttributes: ${label}`)
  else bad(`KaznuCourseAttributes 缺少 ${label}`)
}

if (expectWidget) {
  const widget = fs.readFileSync(path.join(WIDGET_DIR, 'KaznuCourseLiveActivity.swift'), 'utf8')
  const widgetChecks = [
    ['ActivityConfiguration', /ActivityConfiguration\(for: KaznuCourseAttributes\.self\)/],
    ['dynamicIsland', /\} dynamicIsland: \{ context in/],
    ['compactLeading', /compactLeading: \{/],
    ['compactTrailing', /compactTrailing: \{/],
    ['minimal', /minimal: \{/],
    ['圆环 trim 进度', /\.trim\(from: 0, to: max\(0\.001, state\.progress\)\)/],
    ['档位配色', /KaznuActivityPalette\.color\(for: state\)/],
  ]
  for (const [label, re] of widgetChecks) {
    if (re.test(widget)) ok(`KaznuCourseLiveActivity: ${label}`)
    else bad(`KaznuCourseLiveActivity 缺少 ${label}`)
  }

  const bundle = fs.readFileSync(path.join(WIDGET_DIR, 'KazNUOverviewWidget.swift'), 'utf8')
  if (/KaznuCourseLiveActivity\(\)/.test(bundle) && /@main/.test(bundle)) ok('WidgetBundle 已注册 KaznuCourseLiveActivity')
  else bad('WidgetBundle 未注册 KaznuCourseLiveActivity')
} else {
  notes.push('  [--] 已跳过 Widget / 灵动岛 UI 检查（--expect-widget=no）')
}

console.log('\n===== 自检结果 =====')
console.log(notes.join('\n'))
if (problems.length) {
  console.log('\n----- 问题 -----')
  console.log(problems.join('\n'))
  process.exit(1)
}
console.log('\n全部检查通过')
