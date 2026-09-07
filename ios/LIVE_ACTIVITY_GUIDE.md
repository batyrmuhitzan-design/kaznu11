# KazNU Helper — Live Activity / 灵动岛 接入指南

本仓库已备好 **Web 侧服务** 与 **iOS 侧源码**，剩余“把 Target 挂进 Xcode 工程”需要在 Mac 上做一次
（与 `WIDGET_GUIDE.md` 中 Widget Extension 的接入方式一致）。Live Activity 依赖付费签名，免费侧载会失败。

## 已就绪的文件

| 文件 | 用途 | 需要加入的 Target |
|---|---|---|
| `src/services/CourseReminderService.ts` | T-60/T-0 系统通知 + T-30 启动/刷新/结束 Live Activity | —（Web 编译） |
| `ios/App/App/KaznuBridgeViewController.swift` | 注入 `window.__KAZNU_LIVE_ACTIVITY_BRIDGE__` + `__KAZNU_BG_REMINDER_SYNC__`，接收 Web→原生消息 | **App** |
| `ios/App/App/TimetableLiveActivityController.swift` | ActivityKit start/update/end | **App** |
| `ios/App/App/BackgroundReminderScheduler.swift` | BGAppRefreshTask：课程开始前 32 分钟唤醒 App 并拉起 Live Activity | **App** |
| `ios/App/App/TimetableActivityAttributes.swift` | Live Activity 数据结构（App 侧副本） | **App + KazNUHelperWidget** |
| `ios/App/KazNUHelperWidget/TimetableActivityAttributes.swift` | Live Activity 数据结构（Widget 侧副本，内容必须与 App 侧一致） | **KazNUHelperWidget** |
| `ios/App/KazNUHelperWidget/TimetableLiveActivityWidget.swift` | ActivityConfiguration + 灵动岛三态 UI | **KazNUHelperWidget** |
| `ios/App/KazNUHelperWidget/TimetableLiveActivityViews.swift` | 锁屏深色卡片 + 倒计时圆环 | **KazNUHelperWidget** |
| `ios/App/KazNUHelperWidget/Info.plist` | 扩展声明（`NSSupportsLiveActivities=YES`） | **KazNUHelperWidget** |
| `ios/App/App/Info.plist` | 主 App `NSSupportsLiveActivities=YES` + `kaznuhelper://` scheme | 已内联 |

## Mac / Xcode 步骤（一次性）

1. `npm install && npm run build && npx cap sync ios && open ios/App/App.xcodeproj`
2. **File → New → Target… → Widget Extension**
   - Product Name：`KazNUHelperWidget`
   - Embed in Application：`App`
   - ✅ 勾选 **Include Live Activity**（会生成 `ActivityConfiguration` 模板）
   - 取消勾选 Configuration App Intent
3. 删除模板生成的 `KazNUHelperWidget.swift` / `KazNUHelperWidgetBundle.swift` / `Info.plist` 等文件。
4. 把下列文件拖入 **KazNUHelperWidget Target**（不勾 Copy items，直接引用仓库文件）：
   - `ios/App/KazNUHelperWidget/TimetableActivityAttributes.swift`
   - `ios/App/KazNUHelperWidget/TimetableLiveActivityWidget.swift`
   - `ios/App/KazNUHelperWidget/TimetableLiveActivityViews.swift`
   - 并将 `ios/App/KazNUHelperWidget/Info.plist` 设为该 Target 的 Info（Target → General → Info plist）。
5. 把下列文件拖入 **App Target**（成员归属 App）：
   - `ios/App/App/KaznuBridgeViewController.swift`
   - `ios/App/App/TimetableLiveActivityController.swift`
   - `ios/App/App/TimetableActivityAttributes.swift`
   - 确认 `SceneDelegate.swift` 用的是 `KaznuBridgeViewController()`（本仓库已改）。
6. 签名与最低版本：
   - App 与 Extension 选同一个付费 Team；iOS Deployment Target 建议 **≥ 16.2**
     （主 App 可用 16.1，但 Live Activity 控制器使用 16.2 API，会在旧系统上自动跳过）。
   - 免费个人 Team 无法签名 App Extension → Live Activity 无法安装。
   - `ios/App/App/Info.plist` 已声明 `BGTaskSchedulerPermittedIdentifiers =
     kz.kaznu.helper.refresh` + `UIBackgroundModes = [fetch]`（BGAppRefreshTask 必需）。

> 也可用 Xcode 自带步骤：给新文件点右侧 File Inspector → Target Membership 勾选 App 或 KazNUHelperWidget。

## 行为契约（TS → Native payload）

Web 通过 `window.__KAZNU_LIVE_ACTIVITY_BRIDGE__` 发送 JSON：
- `control: "start"` → 启动灵动岛（course 信息 + 30 分钟倒计时）。
- `control: "update"` → 刷新剩余秒数 / 状态文案（前台每 60s 由 Service 推送）。
- `control: "end"` → `activity.end(dismissalPolicy: .immediate)` 收起灵动岛。
- 无 `control` 的旧心跳消息会被原生忽略（避免与首页倒计时心跳互相覆盖）。

课表通过 `window.__KAZNU_BG_REMINDER_SYNC__({ lessons })` 同步给原生
（`BackgroundReminderScheduler.syncSchedule`），原生会缓存课表并维护 BGAppRefreshTask 队列。

| 时间 | 谁触发 | 表现 |
|---|---|---|
| T-60 | 系统本地通知（App 已死也触发；iOS16+ 为 timeSensitive） | “⏰ 1小时后有课：《Linear Algebra》 [204]”；下拉有按钮“开启灵动岛 / Start Live Activity” |
| T-60（点按钮/点通知） | 用户交互 → App 回前台 | 立即以 60 分钟窗口启动 Live Activity |
| T-32 | BGAppRefreshTask 后台唤醒（尽力而为） | 若 App 之前被划掉，在这里静默拉起灵动岛（窗口内自动校验） |
| T-30 | Service watcher（前台/回到前台，每分钟） | 启动 Live Activity：锁屏深色卡片 / 灵动岛 30:00 圆环倒计时（绿→橙→红） |
| T-0 | 系统本地通知 + watcher 检测到归零 | “🔔 上课提醒：《Linear Algebra》 [204]” + 自动 end Live Activity |

> 局限说明：App 被用户完全划掉后，iOS **只保证系统本地通知准时触发**；
> BGAppRefreshTask 由系统调度（受“后台 App 刷新”开关 / 低电量 / Focus 影响），**不能保证到分钟级**；
> 因此仍保留：前台每分钟 + 回到前台自动“补启动”（只要在窗口内即可补上）。若要做到
> “杀死后按秒级自动弹灵动岛”，唯一方案是付费开发者账号 + 远程推送 push-to-start（需服务器）。

