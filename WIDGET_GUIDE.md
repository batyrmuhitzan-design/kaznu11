# KazNU Helper — iOS 桌面小组件（WidgetKit）接入指南

仓库已预置可直接使用的示例代码：`ios/widget-samples/`（Widget 主体 + 数据层 + 原生插件）。

> ⚠️ **先读这个坑**：你现在是用 **免费 Apple ID + Sideloadly** 侧载测试。
> 免费个人证书**不能签名 App Extension（Widget 就是扩展）**，带 Widget 的包直接侧载会失败（报
> `Unable to Install / Provisioning doesn't support extensions`）。所以：
> - 小组件请**先在 Mac 上用付费开发者账号（$99/年）真机调试**，或先在 **Xcode 模拟器**里验证 UI；
> - 现有的「无 Widget 裸 App + Sideloadly 免费侧载」流程**不受影响**，两组配置可共存。

---

## 0. 前置条件
- macOS + Xcode ≥ 14（建议 15/16）；iOS Deployment Target 已是 15.0（iPhone XR 需 iOS ≥15）。
- 已能跑通：`npm install` → `npm run build` → `npx cap sync ios` → Xcode 打开 `ios/App/App.xcodeproj` 直接 Run。

---

## 1. 在 iOS 原生工程里加 Widget 扩展 Target

1. 终端（Mac）：
   ```bash
   npm run build
   npx cap sync ios
   open ios/App/App.xcodeproj
   ```
2. Xcode 菜单 **File → New → Target…** → 选 **Widget Extension**。
   - Product Name：`KazNUWidget`；**Embed in Application** 选 `App`；
   - 取消勾选 **Include Live Activity**；若有 **Include Configuration App Intent** 也取消
     （本方案用最简的 `StaticConfiguration` 时间轴，无需用户配置）。
3. 把 Xcode 模板生成的 `KazNUWidget.swift`、`KazNUWidgetBundle.swift` 等删掉，把本仓库
   `ios/widget-samples/` 的 4 个文件拖进 **KazNUWidget Target**（勾 Copy items if needed）：
   - `WidgetShared.swift`（共享数据模型 + AppGroup 读写）
   - `ScheduleWidget.swift`（TimelineProvider + Widget 定义）
   - `ScheduleWidgetView.swift`（SwiftUI 界面 small / medium）
   - `ScheduleWidgetBundle.swift`（`@main` 入口）
4. 给两个 Target 加 **App Groups** 能力：`App` 与 `KazNUWidget` 各自
   **Signing & Capabilities → + Capability → App Groups**，都添加 `group.com.kaznu.helper.widget`
   （自动生成各自 `.entitlements`，含 `com.apple.security.application-groups`）。
   ⚠️ 免费个人 Team 下此能力是灰的/不可用——即第 0 节的限制。
5. 选签名 Team 后 `⌘R` 跑模拟器；桌面长按 → 左上角 **+** → 搜 “近期课表” 添加小组件。
   没数据时会显示「打开 App 同步」。

---
## 2. 数据通路：JS → App Group → Widget

```
React(课表 JSON)
   │  课表接口返回后调用
   ▼
registerPlugin('KaznuWidget').syncSchedule({ schedule })
   ▼  【原生小插件 KaznuWidgetPlugin】
UserDefaults(suiteName:"group.com.kaznu.helper.widget")["kaznu.schedule.v1"]
   ▼
WidgetCenter.shared.reloadAllTimelines()
   ▼  【小组件 TimelineProvider】
WidgetStore.loadSchedule() → 算出“正在上/下一节” → 渲染
```

### 2.1 做一个能被 cap sync 自动识别的“本地插件”
Capacitor 只自动注册 **package.json 里的插件**（写进原生 `capacitor.config.json` 的
`packageClassList`），所以即使代码只在本仓库，也要包成 npm 插件目录：

```text
plugins/kaznu-widget/
├── package.json
├── Package.swift
└── ios/Sources/KaznuWidgetPlugin/KaznuWidgetPlugin.swift   ← 直接复制 ios/widget-samples/KaznuWidgetPlugin.swift
```

`package.json`（`capacitor.ios.src` 声明原生代码位置）：
```json
{
  "name": "@kaznu/widget-sync",
  "version": "0.1.0",
  "description": "Sync schedule into App Group and reload WidgetKit timelines",
  "license": "MIT",
  "peerDependencies": { "@capacitor/core": ">=8.0.0" },
  "capacitor": { "ios": { "src": "ios" } }
}
```

`Package.swift`（Swift Package，供 Xcode 编译插件）：
```swift
// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "KaznuWidgetPlugin",
    platforms: [.iOS(.v15)],
    products: [.library(name: "KaznuWidgetPlugin", targets: ["KaznuWidgetPlugin"])],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "KaznuWidgetPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/KaznuWidgetPlugin"
        )
    ]
)
```

安装并重新同步（`file:` 依赖让 CLI 能发现它）：
```bash
npm install "@kaznu/widget-sync@file:plugins/kaznu-widget"
npm run build
npx cap sync ios   # packageClassList 会多出 "KaznuWidgetPlugin"，与 @capacitor/status-bar 同机制
```

### 2.2 JS 侧调用（放 `src/native/widgetSync.ts`）
```ts
import { Capacitor, registerPlugin } from "@capacitor/core";

export interface WidgetLesson {
  name: string; type: string; room: string; prof: string;
  weekday: number;            // 0=周一 … 6=周日
  startH: number; startM: number; endH: number; endM: number;
}
export interface WidgetSchedule {
  student: string; updatedAt: string; lessons: WidgetLesson[];
}

interface KaznuWidgetPlugin {
  syncSchedule(options: { schedule: WidgetSchedule }): Promise<{ ok: boolean }>;
}

const KaznuWidget = registerPlugin<KaznuWidgetPlugin>("KaznuWidget", {
  web: () => ({ syncSchedule: async () => ({ ok: true }) }), // 浏览器空实现
});

export async function syncScheduleToWidget(schedule: WidgetSchedule) {
  if (!Capacitor.isNativePlatform()) return;
  try { await KaznuWidget.syncSchedule({ schedule }); }
  catch (e) { console.warn("Widget sync failed:", e); }
}
```

### 2.3 在 App 拉到课表后调用
`src/views/Schedule.tsx` 的 `useEffect` 里，`setCoursesByDay(data)` 之后追加：

```ts
import { syncScheduleToWidget } from "../native/widgetSync";

const lessons = Object.entries(data ?? {}).flatMap(([weekday, list]) =>
  (list as any[]).map((c) => ({
    name: c.name, type: c.type ?? "lecture", room: c.room ?? "", prof: c.prof ?? "",
    weekday: Number(weekday), startH: c.startH, startM: c.startM, endH: c.endH, endM: c.endM,
  }))
);
void syncScheduleToWidget({
  student: STUDENT_ID,
  updatedAt: new Date().toISOString(),
  lessons,
});
```

**数据契约与 `/api/schedule` 对齐**：key 为 `"0"…"6"`（周一→周日），每条含
`name/room/prof/type/startH/startM/endH/endM`——Widget 与 App 共用一份，只改一处。

---

## 3. 让 GitHub Actions 出的 IPA 也带上 Widget

**关键**：绝对不能在 CI 里 `rm -rf ios && npx cap add ios`，那会把 Xcode 里配好的
KazNUWidget Target 与原生定制全部清掉。仓库现状（`.github/workflows/build-ios.yml`）已经改为
**保留仓库里已提交的 ios 工程、只 sync**，并一次产出两个包
（`KazNUHelper-full-ipa` 含扩展、`KazNUHelper-sideload-ipa` 已剥离扩展给免费账号侧载）：

```yaml
    - name: Install dependencies
      run: npm ci

    - name: Build web app
      run: npm run build

    # 保留已提交 ios 工程（内含 KazNUWidget Target 等原生定制），只做同步
    - name: Sync Capacitor iOS
      run: npx cap sync ios

    - name: Build unsigned app
      run: |
        cd ios/App
        xcodebuild -project App.xcodeproj -scheme App -configuration Release \
          -destination 'generic/platform=iOS' -derivedDataPath build \
          CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" CODE_SIGN_STYLE=Manual
        mkdir -p Payload && cp -r build/Build/Products/Release-iphoneos/App.app Payload/
        zip -r KazNUHelper-full-unsigned.ipa Payload
```
（`xcodebuild` 会连 KazNUWidgets 扩展一起编译并嵌入 `App.app/PlugIns/`；
CI 会校验 `.appex` 是否存在，缺失就判失败，避免出“假完整包”。）

