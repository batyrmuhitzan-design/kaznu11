# KazNU Helper — 原生系统功能清单（Native Features）

本文件汇总“原生体验 / 自动更新 / 小组件”相关代码与原生配置，便于 Mac 端跑通验证。

## 1. 已安装的 Capacitor 插件

```jsonc
// package.json → dependencies（已 npm install）
"@capacitor/haptics": "^8.0.2",              // Taptic Engine 触感
"@capacitor/geolocation": "^8.2.2",          // 启动时定位 / 时区
"@capacitor/local-notifications": "^8.3.1",  // 上课提醒本地通知
```

执行 `npx cap sync ios` 后，5 个插件都会写进：
- `ios/App/App/capacitor.config.json`（packageClassList：SplashScreenPlugin、StatusBarPlugin、HapticsPlugin、GeolocationPlugin、LocalNotificationsPlugin）
- `ios/App/CapApp-SPM/Package.swift`（SPM 依赖，全部有 Package.swift）

## 2. 状态栏 / 安全区（问题 1）
- `src/App.tsx`：已删除假状态栏（9:41/WiFi/电池）DOM。
- `src/index.css`：`.app-root { padding-top: calc(env(safe-area-inset-top) + 12px) }`（安全区之外再留 12px 呼吸间距）；顶部胶囊 toast（`.toast-pop`，如 “Univer · synced ✓”）同样让出 `env(safe-area-inset-top) + 12px`，绝不压住系统时钟/灵动岛/电池；底部由 `.tab-bar` 用 `env(safe-area-inset-bottom)` 让位。
- `capacitor.config.ts`：`StatusBar.overlaysWebView=true`、`style:'DARK'`；`ios.contentInset:'never'` 避免与 CSS env 双重偏移。
- `src/native/statusBar.ts`：深浅主题切换时运行时同步 `Style.Dark/Light`。
- 原生 iOS 文件 `ios/App/App/Info.plist`：已加 `NSLocationWhenInUseUsageDescription`。

## 3. WidgetKit 桌面小组件（问题 2）
- 完整步骤与 Swift 代码：见 **`WIDGET_GUIDE.md`** + `ios/widget-samples/`。
- 复用 AppGroup：`group.com.kaznu.helper.widget`；JS 通过自定义小插件写 UserDefaults + `WidgetCenter.reloadAllTimelines()`。

## 4. 自动更新（问题 3）
- 版本元数据：默认打包内 `public/version.json`；生产可改用 `VITE_UPDATE_API_URL`。
- 逻辑：`src/utils/update.ts`（`classifyUpdate` 区分 optional/forced + “本次启动暂不更新”）。
- UI：`src/components/UpdateDialog.tsx`（可选=可关闭、强制=不可关闭，阻断操作）。
- App 启动（登录后）自动检查；Dev Console 可手动触发两种弹窗。

## 5. Taptic 触感（问题 4）
- `src/utils/haptics.ts`：hapticTap / hapticImpact / hapticHeavy / hapticSuccess / hapticError。
- App 内全局事件委托 `attachHapticDelegate()`：
  - Tab / 开关 / 分段控件 / 通知行 / 图标按钮 → Light；
  - 普通按钮 / 卡片 / Quick Access → Medium；
  - 提交 / 下载 / 导出 → Heavy；完成动作额外发 Success。

## 6. 下载/导出闭环（问题 5）
- Materials：点“下载” → 进度条 → 保存 → Toast《xx》已保存至本地 + Success 震动；再点可移除。
- Grades：Export PDF → “Generating…” → Toast “成绩单 PDF 已导出”；Radar Chart 先提示即将上线。

## 7. 时间/地理/课表提醒（问题 6）
- `src/utils/calendar.ts`：周次(1-18)/星期几/本周日期自动推算（Fall 2026 开学 2026-09-01）。
- `src/native/device.ts`：启动时请求定位并缓存（校内 3km 判定预留）。
- `src/native/notifications.ts`：课前 N 分钟（默认 30）每周排本地通知；Schedule 拉到课表即同步。
- Schedule 默认聚焦“今天”并显示 NOW 时间线；主页标题显示真实/模拟周次。

## 8. Dev Simulation Console（问题 7）
- 唤起方式：**Ctrl/Cmd + Shift + D**，或长按 Dashboard 右上角头像 0.6s，或主屏 3D Touch「开发者控制台」。
- 能力：临近上课(5min) / 即将下课(2min)、周次 1–18 切换、模拟新通知(铃铛红点 + 系统横幅/Web Toast)、模拟可选/强制更新、一键清除。

## 9. 主屏 3D Touch / 快捷操作 + 系统通知（本次）
- 快捷项：`ios/App/App/Info.plist → UIApplicationShortcutItems`
  - 📅 今日课表（→ `schedule` 页）· 🆔 电子学生证（→ `profile` 页）· 🔔 开发者控制台（→ Dev Console）。
- 原生桥：`SceneDelegate.swift` / `AppDelegate.swift` 中 `KaznuQuickActions` 把快捷 type 注入 WKWebView 的 `kaznu:shortcut` CustomEvent，轮询 `window.__kaznuShortcutAck` 补发防丢。
- React 入口：`src/native/quickActions.ts` 监听并映射 → `src/App.tsx` 路由跳转（未登录先缓存、登录后补跳）。
- 系统通知：`src/native/notifications.ts` 用 `@capacitor/local-notifications` 发**真实系统 Top Banner**
  - “新闻更新”→ `postNewsUpdateBannerNow()`（Dev Console 模拟新通知触发）；
  - “课前即时提醒”→ `postClassReminderBannerNow()`（Dashboard 30/15/5/1 分钟与下课提醒触发，前台横幅/锁屏/通知中心均可见）。
  - `capacitor.config.ts` 已加 `LocalNotifications.presentationOptions: [badge,sound,banner,list]`，前台也弹系统横幅。
  - Web 预览自动退化：浏览器 Notification / In-App Toast。

## 10. iOS 实时活动（Live Activity / 灵动岛倒计时）
- `ios/App/App/Info.plist`：`NSSupportsLiveActivities = YES` + `kaznuhelper://` URL Scheme（灵动岛展开按钮深链）。
- Web 服务：`src/services/CourseReminderService.ts`
  - T-60：排“⏰ 1小时后有课：《课名》[教室]”系统本地通知；
  - T-30：`syncTimetableLiveActivity`（每分钟 + 回前台补查）经桥启动 Live Activity；
  - T-0：排“🔔 上课提醒”通知并自动 `end` 灵动岛；
  - 模块级 `registerReminderLessons` + App 入口 `attachGlobalLiveActivityWatcher` 保证跨页面看护。
- 原生桥：`ios/App/App/KaznuBridgeViewController.swift`（注入 `window.__KAZNU_LIVE_ACTIVITY_BRIDGE__`
  + `window.__KAZNU_BG_REMINDER_SYNC__`）+ `TimetableLiveActivityController.swift`（ActivityKit start/update/end）。
- 后台兜底：`ios/App/App/BackgroundReminderScheduler.swift`（BGAppRefreshTask `kz.kaznu.helper.refresh`，
  下一节课开始前 32 分钟唤醒；Info.plist 已声明 `BGTaskSchedulerPermittedIdentifiers` + `UIBackgroundModes=[fetch]`）。
- T-60 通知为 `interruptionLevel=timeSensitive`，带 Category 按钮“开启灵动岛 / Start Live Activity”；
  点击通知或按钮会以 60 分钟窗口立即启动灵动岛（`src/services/CourseReminderService.ts` 监听
  `localNotificationActionPerformed`）。
- 通知分类：上课/成绩“关键提醒”默认开启（设置页可关：⏰ 上课与成绩提醒）；
  新闻推送由设置页“News notifications”开关控制（默认开启，可关）。
- 声明与隐私：`LEGAL.md`（免责声明/隐私政策/使用条款/非官方声明），App 内 About → 政策折叠展示。
- Widget 源码：`ios/KazNUHelperWidget/`（锁屏深色卡片 + 圆环 + Dynamic Island compact/expanded/minimal）。
- 接入步骤（Xcode 建 Widget Extension Target 并把文件加进两个 Target）：见 **`ios/LIVE_ACTIVITY_GUIDE.md`**。
- ⚠️ 免费个人证书无法签名 App Extension；且 App 被完全杀死后 iOS 只保证本地通知准时触发，
  灵动岛需在 App 进程存活/回前台时启动（详见指南“局限说明”）。

## 11. 真实文件下载 / PDF 导出（本次）
- 新增插件：`@capacitor/filesystem`、`@capacitor/action-sheet`、`@capacitor/share`、`jspdf`。
- 核心工具：`src/native/fileExport.ts`
  - `createMaterialPdf()` / `createTranscriptPdf()`：用 jsPDF 动态生成**真实标准 PDF**（A4、校徽色带、自动翻页 + 页码）。
  - `writePdfFile()` / `savePdfToDocuments()` / `exportPdfForSharing()`：真实写入 iOS Documents / Cache。
  - `askAfterSave()`：下载完成后弹原生 Action Sheet（在“文件”中查看 / 发送分享 / 取消）。
  - `shareNativeFile()`：打开系统 iOS Share Sheet（存“文件”、AirDrop、微信/Telegram、打印）。
  - `downloadBase64OnWeb()`：纯 Web 预览退化为真实浏览器下载。
- Materials：点击下载 → 生成 PDF → **写入 Documents/KazNU Helper/Downloads**（配合 `Info.plist` 的
  `UIFileSharingEnabled` / `LSSupportsOpeningDocumentsInPlace`，在“文件 → 我的 iPhone → KazNU Helper”可见）
  → 行内真实进度条 + 百分比 → 完成成功 Taptic → Action Sheet 选择“查看/分享”；再点按钮可移除并删除真实文件。
- Grades：导出成绩单 → 用当前 GPA/荣誉/各学期成绩动态生成 PDF → 写入 Cache 临时目录 →
  **自动弹出系统 Share Sheet**，可存“文件”、发送或无线打印。
- Web 预览：两端都生成真实文件并由浏览器下载，不弹假 Toast 占位。

---

## ⚠️ CI / 原生配置提醒
当前 `.github/workflows/build-ios.yml` 每次 `rm -rf ios && npx cap add ios`，会**丢掉**：
- `ios/App/App/Info.plist` 里的 `NSLocationWhenInUseUsageDescription`（定位会失败）；
- Xcode 里添加的 KazNUWidget Target 等。

如果你要走 GitHub Actions 出正式 IPA，**请把 CI 改成保留仓库内 ios 工程、只 `npx cap sync ios`**：
见 `WIDGET_GUIDE.md` 第 3 节的 YAML（同样适用于上述所有原生定制）。
