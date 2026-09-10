# KazNU Helper — Live Activity（实时活动）/ 灵动岛 接入指南

本仓库已备好 **Web 侧服务** 与 **iOS 侧源码**（含 Xcode 工程引用），剩余“在 Mac 上真机验证”
与付费签名相关事项见文末。Live Activity 依赖付费签名，免费侧载会失败。

## 1. 已就绪的文件

| 文件 | 用途 | 需要加入的 Target |
|---|---|---|
| `src/services/CourseReminderService.ts` | T-60/T-0 系统通知 + T-30 启动/刷新/结束 Live Activity（Web 编译） | —（Web） |
| `ios/App/App/KaznuCourseAttributes.swift` | **数据模型**：静态属性 `courseName/roomNumber/teacherName`，动态状态 `remainingSeconds/totalSeconds/phase/progress` | **App** |
| `ios/App/KazNUWidgets/KaznuCourseAttributes.swift` | 同一份模型的副本（必须与上面逐字节一致） | **KazNUWidgets** |
| `ios/App/App/KaznuActivityManager.swift` | **单例**：`start` / `update` / `end` + 生命周期自动化 `sync(now:)` + 课表缓存 | **App** |
| `ios/App/App/KaznuLiveActivityPlugin.swift` | Capacitor 插件通道（JS `KaznuLiveActivity.start/update/end`） | **App** |
| `ios/App/App/KaznuBridgeViewController.swift` | 注入 `__KAZNU_LIVE_ACTIVITY_BRIDGE__` / `__KAZNU_BG_REMINDER_SYNC__` | **App** |
| `ios/App/App/BackgroundReminderScheduler.swift` | BGAppRefreshTask：课前 32 分钟唤醒并调用 `KaznuActivityManager.sync` | **App** |
| `ios/App/KazNUWidgets/KaznuCourseLiveActivity.swift` | **UI**：锁屏大卡片 + 圆环倒计时 + Dynamic Island 三态 | **KazNUWidgets** |
| `ios/App/KazNUWidgets/KazNUOverviewWidget.swift` | 桌面小组件 + `@main` WidgetBundle（已注册 Live Activity） | **KazNUWidgets** |
| `ios/App/App/Info.plist` | `NSSupportsLiveActivities = YES` + `kaznuhelper://` scheme | 已内联 |
| `ios/App/KazNUWidgets/Info.plist` | 扩展声明（同样需要 `NSSupportsLiveActivities = YES`） | 已内联 |

> 仓库自检脚本：`node scripts/verify-ios-live-activity.cjs`
> 校验 pbxproj 结构、Target Membership、两个副本一致性、关键 API 与颜色阈值是否落地。

## 2. 数据模型（`KaznuCourseAttributes`）

```swift
@available(iOS 16.1, *)
public struct KaznuCourseAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        public var remainingSeconds: Double   // 当前阶段剩余秒数
        public var totalSeconds: Double       // 当前阶段总秒数（课前 1800）
        public var phase: KaznuCoursePhase    // .preClass / .inClass
        public var progress: Double           // 剩余 / 总（0.0 ~ 1.0）
        public var stageStart: Date           // 阶段起止（供系统计时器自走时）
        public var stageEnd: Date
        public var courseShort: String        // 灵动岛紧凑区缩写
        public var statusLabel: String        // "Starts in 25 min"
        public var navigationLabel: String?
        public var navigationURL: String?     // 展开视图跳转按钮
    }
    public let courseId: String
    public let courseName: String             // 静态属性
    public let roomNumber: String             // 静态属性
    public let teacherName: String            // 静态属性
}
```

⚠️ **静态属性不能中途变更**：因此“课中切到下节课”时 `KaznuActivityManager` 会先 `end` 旧 Activity，
再以新的课程属性 `request` 一条新的 Activity（同一个 `courseId + phase` 则只做 `update`，灵动岛不会闪烁）。

## 3. 界面（`KaznuCourseLiveActivity.swift`）

- **锁屏 / 通知横幅大卡片**：左侧课程名 / 教室 / 教师 / 状态文案 / 线性进度条，右侧 62pt 圆环倒计时。
- **圆环倒计时（Circular Progress Gauge 风格）**：`Circle().trim(from: 0, to: progress)` 从 12 点顺时针绘制，
  随剩余比例**逐渐缩短**；颜色按档位切换 —— 剩余 > 60% 绿、20% ~ 60% 橙、< 20% 红；
  环内居中显示剩余时间：`29m`（> 10 分钟）→ `09:59`（≤ 10 分钟，改由系统计时器逐秒自走）。
- **灵动岛紧凑态**：`compactLeading` 书本图标（颜色随档位）；`compactTrailing` 迷你圆环 + 剩余分钟数字。
- **灵动岛展开态**：左侧课程名与缩写、右侧 44pt 圆环、底部状态文案 + 自走时间 + 线性进度 + 跳转按钮。
- **minimal**：极简书本图标。

## 4. 生命周期（`KaznuActivityManager.sync(now:)`）

| 场景 | 行为 |
|---|---|
| 距上课 ≤ 30 分钟 | 启动 `preClass` 倒计时，总时长 **1800 秒** |
| 正在上课 | 倒计时到下课（`inClass`，总时长 = 课程时长） |
| 课中且距下节课 < 15 分钟 | 自动切换为**下节课**的 `preClass` 倒计时 |
| 无课 / 距下节课很远 | 自动 `end` 收起 Activity |

调用时机：App 启动、回到前台（`didBecomeActive` 通知 + SceneDelegate）、BGAppRefreshTask 唤醒、
Web 端同步课表后。刷新策略：**只**在换色点（60% / 20%）、整分钟、阶段结束等“真正需要变”的时刻更新内容，
其余时间由系统计时器渲染，节省 ActivityKit 更新预算。

## 5. 目标与签名的前提

- 两个 Target 必须用**同一个付费 Team** 签名，`iOS Deployment Target` 建议 ≥ 16.2
  （主 App 目前是 15.0，低于 16.2 的设备会自动跳过 Live Activity，只剩通知；Widget 扩展是 16.2）。
- 免费个人 Team **无法签名 App Extension** → Live Activity 无法安装。
- `App` 与 `KazNUWidgets` 都要开启 **App Groups**：`group.com.kaznu.helper`
  （`.entitlements` 已在仓库里，课表缓存与桌面小组件共用）。
- `ios/App/App/Info.plist` 已声明 `BGTaskSchedulerPermittedIdentifiers = kz.kaznu.helper.refresh`
  + `UIBackgroundModes = [fetch]`（BGAppRefreshTask 必需）。

## 6. Mac / Xcode 步骤（工程结构已就绪，通常无需再拖文件）

1. `npm install && npm run build && npx cap sync ios && open ios/App/App.xcodeproj`
2. 确认 `KazNUWidgets` Target 与 `App` Target 的 **Target Membership** 与下表一致
   （仓库的 `project.pbxproj` 已经配好，只有在 Xcode 里重建 Target 时才需要重新勾选）：
   - App：`KaznuCourseAttributes.swift`、`KaznuActivityManager.swift`、`KaznuBridgeViewController.swift`、
     `KaznuLiveActivityPlugin.swift`、`BackgroundReminderScheduler.swift`
   - KazNUWidgets：`KaznuCourseAttributes.swift`、`KaznuCourseLiveActivity.swift`、`KazNUOverviewWidget.swift`
3. 选签名 Team → `⌘R` 跑真机；锁屏 / 灵动岛需要真机（模拟器不支持灵动岛硬件表现）。
4. 自检（可选，Windows 上也能跑）：
   ```bash
   node scripts/verify-ios-live-activity.cjs
   ```

> 文件已通过工程引用挂进两个 Target；若在 Xcode 里看到红色文件名，说明 `cap sync ios` 覆盖过工程，
> 用 `git checkout ios/App/App.xcodeproj` 恢复即可。

### 6.1 云端打包（GitHub Actions，无需 Mac）

`.github/workflows/build-ios.yml`（Actions → **Build iOS IPA** → Run workflow）会并行产出两个未签名 IPA：

| Artifact | 内容 | 用途 |
|---|---|---|
| `KazNUHelper-full-ipa` | App + `KazNUWidgets.appex` | 测 **Live Activity / 灵动岛 / 桌面小组件**（需付费账号签名） |
| `KazNUHelper-sideload-ipa` | `node scripts/strip-ios-widget-target.cjs` 剥离扩展后的工程 | 免费 Apple ID 侧载测 App 功能（无灵动岛） |

要点：

- runner 用 `macos-26`（镜像自带 Xcode 26.6；Capacitor 8 要求 **Xcode 26+**）；
- 构建前跑 `node scripts/verify-ios-live-activity.cjs` 做工程结构守卫，构建后校验
  `.appex` 是否存在（完整包必须有、侧载包必须没有），不一致直接让 CI 失败；
- 流水线不会 `rm -rf ios`，始终使用仓库里已提交的 Xcode 工程与原生代码。
- 剥离脚本的逻辑：定位 `KazNUWidgets` target → 递归收集其配置/阶段/产物/依赖/文件引用 →
  删除对象块与所有引用 → 移除 App Groups 权限 → 自检（配平、无悬空引用、App target 完好）后才写回。

## 7. 行为契约（TS → Native payload）

Web 通过 `window.__KAZNU_LIVE_ACTIVITY_BRIDGE__`（或 Capacitor 插件 `KaznuLiveActivity`）发送 JSON：

- `control: "start"` → 启动倒计时（课程信息 + 剩余/总秒数）。
- `control: "update"` → 刷新剩余秒数 / 阶段 / 文案（同课程同阶段走 `update`，否则自动重建）。
- `control: "end"`、`kind: "none"`、`shouldShowLiveActivity: false` → `end(dismissalPolicy: .immediate)` 收起。

映射规则（`KaznuActivityManager.handle(_:)`）：旧契约的 `phase` 是**颜色**（green/orange/red），
新实现按需求由 `progress` 推导颜色，因此阶段改用 `kind` 映射（`in-class` → `inClass`，其余 → `preClass`）。
`courseShort / statusLabel / navigation` 继续生效，灵动岛 UI 不受影响。

课表通过 `window.__KAZNU_BG_REMINDER_SYNC__({ lessons })` 同步给原生
（`BackgroundReminderScheduler.syncSchedule` → `KaznuActivityManager.registerSchedule`，写入 App Group + 标准
UserDefaults 并刷新桌面小组件）。

| 时间 | 谁触发 | 表现 |
|---|---|---|
| T-60 | 系统本地通知（App 已死也触发；iOS16+ 为 timeSensitive） | “⏰ 1小时后有课：《Linear Algebra》[204]”，下拉有按钮“开启灵动岛 / Start Live Activity” |
| T-60（点通知/按钮） | 用户交互 → App 回前台 | 立即以 60 分钟窗口启动 Live Activity |
| T-32 | BGAppRefreshTask 后台唤醒（尽力而为） | 若 App 之前被划掉，在这里静默拉起 |
| T-30 | `KaznuActivityManager.sync`（前台每分钟 watcher + 回前台 + BGTask） | `preClass` 半小时倒计时：`30:00` → 绿 → 橙 → 红 |
| 下课 / 下节课 < 15min | 同上 | 自动切到 `inClass` 或下节课的 `preClass` |
| 无课 / 距下节课很远 | 同上 | 自动 `end` 收起 |

> 局限说明：App 被用户完全划掉后，iOS **只保证系统本地通知准时触发**；
> BGAppRefreshTask 由系统调度（受“后台 App 刷新”开关 / 低电量 / 专注模式影响），**不能保证到分钟级**；
> 此外 ActivityKit 的内容更新需要 App 进程存活，因此后台期间圆环颜色 / 文案可能在下次唤醒时才校正
> （圆环内的数字由系统计时器自走，始终准确）。若要做到“杀死后按秒级自动弹灵动岛”，
> 唯一方案是付费账号 + 远程推送 push-to-start（需要服务器）。
