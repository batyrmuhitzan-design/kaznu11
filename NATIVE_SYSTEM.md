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
- `src/index.css`：`.app-root { padding-top: env(safe-area-inset-top) }`；底部由 `.tab-bar` 用 `env(safe-area-inset-bottom)` 让位。
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
- 唤起方式：**Ctrl/Cmd + Shift + D**，或长按 Dashboard 右上角头像 0.6s。
- 能力：临近上课(5min) / 即将下课(2min)、周次 1–18 切换、模拟新通知(铃铛红点+Toast)、模拟可选/强制更新、一键清除。

---

## ⚠️ CI / 原生配置提醒
当前 `.github/workflows/build-ios.yml` 每次 `rm -rf ios && npx cap add ios`，会**丢掉**：
- `ios/App/App/Info.plist` 里的 `NSLocationWhenInUseUsageDescription`（定位会失败）；
- Xcode 里添加的 KazNUWidget Target 等。

如果你要走 GitHub Actions 出正式 IPA，**请把 CI 改成保留仓库内 ios 工程、只 `npx cap sync ios`**：
见 `WIDGET_GUIDE.md` 第 3 节的 YAML（同样适用于上述所有原生定制）。
