# Live Activity 远程推送（APNs）接入指南

> 本文对应「把灵动岛 / 锁屏倒计时从**本地触发**升级为**服务器推送触发**」的改造。
> 关键收益：**用户把 App 划掉（Kill）之后，课前仍能自动在锁屏 / 灵动岛弹出倒计时卡片。**

---

## 0. 先看清楚一个硬门槛 ⚠️

| 能力 | 免费 Apple ID | 付费开发者账号（$99/年） |
|---|---|---|
| 本地 Live Activity（App 在前台/后台时拉起） | ✅ 可用 | ✅ |
| **远程推送 Live Activity**（APNs） | ❌ **不可能** | ✅ 需要 |
| Widget Extension 签名 | ❌ 无法签名扩展 | ✅ |

原因：APNs 需要 **Push Notifications entitlement（`aps-environment`）**，
而免费个人团队无法创建带推送能力的 App ID —— 这条限制来自 Apple，绕不过去。

因此本方案的定位是 **APNs 优先 + 本地兜底**：

* 有付费账号 → 走远程推送，Kill 掉 App 也能自动弹卡片；
* 没有付费账号 → 代码照常编译运行，只是拿不到 push token，
  远程链路自动跳过（后端 `configured=false` 会说明原因），
  **App 内的本地触发逻辑完全不受影响**。

---

## 1. Xcode 侧（3 步）

### 1.1 开启 Push Notifications 能力

Xcode → 选中 **App** Target → **Signing & Capabilities** → `+ Capability` →
**Push Notifications** → 选择你的付费 Team。

Xcode 会自动把 `aps-environment` 写进 entitlements 文件。
仓库里也准备了一份可直接用的版本：`ios/App/App/App.push.entitlements`
（含 `aps-environment = development` + App Group）。要用它就在
**Build Settings → Code Signing Entitlements** 改成 `App/App.push.entitlements`。

> 为什么默认**不**直接写进 `App.entitlements`：该文件已被 pbxproj 的
> `CODE_SIGN_ENTITLEMENTS` 引用，加了推送能力会让构建**强制要求**带推送的
> provisioning profile —— 仓库现有的「免费账号侧载 IPA」流程会当场签名失败。

### 1.2 确认 Info.plist（已改好，无需再动）

* `NSSupportsLiveActivities = YES`（App 与 Widget 两个 plist 都已有）
* `UIBackgroundModes` 已包含 `fetch` **与 `remote-notification`**

### 1.3 真机至少打开一次 App

push-to-start token 只有 App **运行过**才会下发（Apple 机制，无法绕过）。
打开一次后 token 会缓存到 App Group，之后即使 Kill 也不会影响服务器推送。

---

## 2. 服务器侧（FastAPI）

### 2.1 准备 APNs 密钥（`.p8`）

1. Apple Developer → Certificates, Identifiers & Profiles → **Keys** → `+`
2. 勾选 **Apple Push Notifications service (APNs)** → 下载 `.p8`
   （**只能下载一次**，请妥善保管；文件形如 `AuthKey_XXXXXXXXXX.p8`）
3. 记下 **Key ID**（文件名里的 10 位）与 **Team ID**（账号页右上角）

### 2.2 配置环境变量

写进 `/opt/kaznu11-main/.env`（或 systemd 的 `EnvironmentFile`）：

```ini
APNS_KEY_ID=ABCDE12345
APNS_TEAM_ID=9ABCDEFGHI
APNS_KEY_PATH=/opt/kaznu11-main/secrets/AuthKey_ABCDE12345.p8
APNS_BUNDLE_ID=com.kaznu.helper          # Live Activity topic 自动推导为
                                         # com.kaznu.helper.push-type.liveactivity
APNS_USE_SANDBOX=true                    # 开发构建/直接侧载 = true；TestFlight / App Store = false
LIVE_ACTIVITY_LEAD_SECONDS=900           # 课前 15 分钟（需求值）
LIVE_ACTIVITY_ALERT_ON_START=true        # start 时顺带弹一条普通通知（没授权通知时 iOS 自动忽略）
LIVE_ACTIVITY_PUSH_ENABLED=true          # 调试时可临时关掉
LIVE_ACTIVITY_TICK_SECONDS=60            # 调度循环间隔
```

安装依赖（APNs 需要 HTTP/2 与 ES256 JWT）：

```bash
python3 -m pip install --break-system-packages "httpx[http2]" "PyJWT[crypto]" tzdata
systemctl restart kaznu-api
```

> 未配置凭据时：**后端不会崩**，调度器与 `test-push` 会返回
> `apns-not-configured` 并说明原因（见 §4 自检）。

---

## 3. 数据流（一图看懂）

```
App 启动 / 回前台 / token 变化
        │  KaznuLiveActivity.getPushTokens()      ← Swift 只负责"拿 token"
        ▼
LiveActivityPushService (Web)
        │  带 Bearer 鉴权 POST
        ▼
POST /api/v1/live-activity/registration   ← push-to-start token（App 级）
POST /api/v1/live-activity/session        ← 每个 Activity 的 push token
POST /api/v1/lessons/sync                 ← 课表（服务器算"课前 15 分钟"的依据）
        │
        ▼
后端调度器（每 60s，纯函数 plan_pushes 判定）
  距开课 ≤ 15 分钟且未推过 → event: start（用 push-to-start token）
  到上课时刻              → event: update（改成课中倒计时）
  课程结束                → event: end（收起卡片）
        │
        ▼
APNs（HTTP/2 + ES256 JWT，topic = <bundle>.push-type.liveactivity）
        │
        ▼
锁屏 / 灵动岛：Widget 用 Text(timerInterval:) 由**系统逐秒自走**，无需频繁推送
```

**三类 token 别搞混**：

| token | 来源 | 用途 |
|---|---|---|
| `push_to_start_token` | `Activity.pushToStartTokenUpdates`（iOS 17.2+） | 服务器 **start** 新卡片（App 没运行也行） |
| activity `push_token` | `activity.pushTokenUpdates`（iOS 16.2+） | 服务器 update / end **那一张**卡片 |
| `device_token` | `didRegisterForRemoteNotifications` | 普通通知推送（本项目暂只登记） |

---

## 4. 验证清单（按顺序做，每步都有明确预期）

```bash
# ① 服务器凭据就绪？
curl -s -H "Authorization: Bearer <超管token>" https://1losion.me/api/v1/live-activity/apns-status
#   期望：apns.configured=true, usable=true, topic=com.kaznu.helper.push-type.liveactivity

# ② 设备注册上来了吗？（真机打开 App 后）
curl -s -H "Authorization: Bearer <token>" https://1losion.me/api/v1/live-activity/status
#   期望：registrations[].has_push_to_start_token = true

# ③ 端到端最快验证：立刻给自己推一条 15 分钟演示卡片（不用等上课）
curl -s -X POST -H "Authorization: Bearer <token>" https://1losion.me/api/v1/live-activity/test-push
#   期望：{"ok":true,"status":200,...}，随后锁屏出现 Test Push 卡片，且卡片带 PUSH 徽标

# ④ 验证"课前 15 分钟"逻辑（不用真等）
curl -s -X POST -H "Authorization: Bearer <token>" https://1losion.me/api/v1/live-activity/run-scheduler
#   期望：planned / sent 计数与 details 列表
```

App 端自检：卡片左上角出现 **PUSH** 徽标 = 这一帧来自服务器推送；
没有徽标 = 本地触发（说明 push token 还没上报，或 entitlement 没开）。

---

## 5. 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| `didFailToRegisterForRemoteNotifications` 报错 | 没开 Push Notifications 能力 / 用了免费账号 / 描述文件没重新生成 |
| `apns-status` 里 `configured=false` | 缺 `APNS_KEY_ID` / `APNS_TEAM_ID` / `.p8` 路径 |
| `test-push` 返回 `BadDeviceToken` | sandbox / production 环境配错（开发包必须 `APNS_USE_SANDBOX=true`） |
| `TopicDisallowed` | Bundle ID 写错；topic 必须是 `<bundle>.push-type.liveactivity` |
| 卡片出现了但数字不动 | 该帧是本地触发（无 `source: push`）→ 检查 token 是否上报成功 |
| 锁屏一直停在 `15m` 不变 | 旧版 Widget；新版对推送帧用 `Text(timerInterval:)` 由系统逐秒自走 |
| 关机 / 断网期间到点 | APNs 缓存策略为 `apns-expiration=0`（不存）→ 联网后按下一轮调度补推 |

---

## 6. 相关代码索引

| 位置 | 职责 |
|---|---|
| `ios/App/App/KaznuActivityManager.swift` | `pushType: .token`、三类 token 采集、`pushTokensSnapshot()`、`registerForRemoteNotifications()` |
| `ios/App/App/AppDelegate.swift` | device token 回调（成功 / 失败） |
| `ios/App/App/KaznuLiveActivityPlugin.swift` | JS 通道：`getPushTokens` + `pushTokensChanged` 事件 |
| `ios/App/App/KaznuCourseAttributes.swift`（+ Widget 侧同副本） | `ContentState` 显式 `Codable` = **推送契约**（容错解码，缺字段不会丢整条推送） |
| `ios/App/KazNUWidgets/KaznuCourseLiveActivity.swift` | 推送帧用 `Text(timerInterval:)` 系统自走 + `PUSH` 徽标 + `isStale` 提示 |
| `src/native/liveActivity.ts` | `fetchLiveActivityPushTokens()`（读原生 token） |
| `src/services/LiveActivityPushService.ts` | 带鉴权上报 token + 同步课表 + 自动重报 |
| `backend/app/live_activity_payload.py` | APNs payload 构造（**契约唯一来源**，含 Apple 2001 时间基准） |
| `backend/app/apns.py` | HTTP/2 + ES256 JWT 发送端（无凭据时优雅降级） |
| `backend/app/live_activity_scheduler.py` | `plan_pushes()` 纯函数判定 + 调度循环 |
| `backend/app/routers/live_activity.py` | 8 个端点 |
| `backend/tests/check_live_activity_api.py` | 29 项：端点 / 幂等 / 时区 / payload |
| `backend/tests/check_live_activity_contract.py` | 8 项：**Swift CodingKeys ↔ payload 字段**双向比对 |
