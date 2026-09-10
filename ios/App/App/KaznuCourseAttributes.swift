import ActivityKit
import Foundation

// ⚠️ 这个文件必须同时被 **两个 Target** 编译（File Inspector → Target Membership 勾选 App + KazNUWidgets）：
//  - App：KaznuActivityManager 用它 request / update / end Activity；
//  - KazNUWidgets：KaznuCourseLiveActivity 用它声明 ActivityConfiguration 并渲染锁屏卡片 / 灵动岛。
// 两侧的 struct 名称、字段顺序与类型必须完全一致（本仓库维护两份逐字节相同的副本：
//  ios/App/App/KaznuCourseAttributes.swift 与 ios/App/KazNUWidgets/KaznuCourseAttributes.swift）。

// MARK: - 当前阶段

/// 课程倒计时阶段。
///
/// - `preClass`：上课前倒计时（默认窗口 T-30min → T-0，总时长 1800 秒）
/// - `inClass` ：课中倒计时（到下课时刻）；若距下一节课不足 15 分钟则切到下节课的 `preClass`
@available(iOS 16.1, *)
public enum KaznuCoursePhase: String, Codable, Hashable {
    case preClass
    case inClass
}

// MARK: - 圆环颜色档位

/// 圆环颜色档位：> 60% 绿 / 20% ~ 60% 橙 / < 20% 红。
public enum KaznuCourseTier: String, Codable, Hashable {
    case safe
    case warning
    case critical
}

/// 进度、档位、文案的**唯一**计算源。
///
/// 同时被 App（安排刷新时机）与 Widget（渲染）编译，避免两边算法漂移。
public enum KaznuCourseMetric {
    /// 剩余比例高于该值 → 绿色（需求：> 60%）
    public static let safeThreshold: Double = 0.6
    /// 剩余比例低于该值 → 红色（需求：< 20%）
    public static let criticalThreshold: Double = 0.2
    /// 圆环内文案从 `29m` 切换为 `09:59` 的阈值（10 分钟）
    public static let detailedTextThreshold: Double = 600

    /// 进度比例 = 剩余时间 / 总时间（0.0 ~ 1.0）
    public static func progress(totalSeconds: Double, remainingSeconds: Double) -> Double {
        guard totalSeconds > 0 else { return 0 }
        return min(1, max(0, remainingSeconds / totalSeconds))
    }

    /// 由进度比例推导颜色档位
    public static func tier(progress: Double) -> KaznuCourseTier {
        if progress > safeThreshold { return .safe }
        if progress > criticalThreshold { return .warning }
        return .critical
    }

    /// 由剩余 / 总秒数推导颜色档位
    public static func tier(totalSeconds: Double, remainingSeconds: Double) -> KaznuCourseTier {
        return tier(progress: progress(totalSeconds: totalSeconds, remainingSeconds: remainingSeconds))
    }

    /// 圆环内居中文案：剩余充足时给 `29m`（整分钟），最后 10 分钟给 `09:59`（mm:ss）。
    public static func ringText(remainingSeconds: Double) -> String {
        let seconds = Int(max(0, remainingSeconds.rounded(.up)))
        if Double(seconds) >= detailedTextThreshold {
            return "\(Int(ceil(Double(seconds) / 60)))m"
        }
        return String(format: "%02d:%02d", seconds / 60, seconds % 60)
    }

    /// 卡片副标题：`Starts in 25 min` / `Class ends in 40 min`
    public static func statusText(phase: KaznuCoursePhase, remainingSeconds: Double) -> String {
        let minutes = Int(ceil(max(0, remainingSeconds) / 60))
        switch phase {
        case .preClass:
            return minutes <= 0 ? "Starting now" : "Starts in \(minutes) min"
        case .inClass:
            return minutes <= 0 ? "Ending now" : "Class ends in \(minutes) min"
        }
    }

    /// 课程缩写：`Linear Algebra` → `LA`（灵动岛紧凑区 / 卡片角标）
    public static func initials(of name: String) -> String {
        let parts = name
            .split(separator: " ")
            .filter { !$0.isEmpty && ($0.first?.isLetter == true) }
            .prefix(2)
        if parts.isEmpty { return String(name.prefix(2)).uppercased() }
        return parts.map { String($0.prefix(1)) }.joined().uppercased()
    }
}

// MARK: - Activity Attributes

/// 课程 Live Activity 的数据模型。
///
/// 静态属性（`ActivityAttributes`）放**不随阶段变化的课程身份**，动态状态（`ContentState`）
/// 放倒计时相关字段。注意：切换课程（例如课中切到下节课）时静态属性无法变更，
/// 因此 `KaznuActivityManager` 会先 `end` 再以新的静态属性 `request` 一个新的 Activity。
@available(iOS 16.1, *)
public struct KaznuCourseAttributes: ActivityAttributes {
    /// 动态状态：随倒计时不断刷新
    public struct ContentState: Codable, Hashable {
        /// 当前阶段剩余秒数（快照；圆环内的数字由系统计时器逐秒自走）
        public var remainingSeconds: Double
        /// 当前阶段总秒数（课前半小时倒计时 = 1800）
        public var totalSeconds: Double
        /// 当前阶段：`preClass` 上课前 / `inClass` 课中
        public var phase: KaznuCoursePhase
        /// 进度比例 = 剩余 / 总（0.0 ~ 1.0）
        public var progress: Double
        /// 当前阶段的起止时刻，供 `Text(timerInterval:)` / `ProgressView(timerInterval:)` 自走时
        public var stageStart: Date
        public var stageEnd: Date
        /// 灵动岛紧凑区 / 卡片角标用的课程缩写（如 LA / HM2）
        public var courseShort: String
        /// 辅助文案：`Starts in 25 min`
        public var statusLabel: String
        /// 展开视图的跳转按钮（如“打开课表” → kaznuhelper://schedule）
        public var navigationLabel: String?
        public var navigationURL: String?

        public init(
            remainingSeconds: Double,
            totalSeconds: Double,
            phase: KaznuCoursePhase,
            progress: Double,
            stageStart: Date,
            stageEnd: Date,
            courseShort: String,
            statusLabel: String,
            navigationLabel: String? = nil,
            navigationURL: String? = nil
        ) {
            self.remainingSeconds = remainingSeconds
            self.totalSeconds = totalSeconds
            self.phase = phase
            self.progress = progress
            self.stageStart = stageStart
            self.stageEnd = stageEnd
            self.courseShort = courseShort
            self.statusLabel = statusLabel
            self.navigationLabel = navigationLabel
            self.navigationURL = navigationURL
        }

        /// 颜色档位（绿 / 橙 / 红）
        public var tier: KaznuCourseTier { KaznuCourseMetric.tier(progress: progress) }

        /// 圆环内文案（`29m` / `09:59`）
        public var ringText: String { KaznuCourseMetric.ringText(remainingSeconds: remainingSeconds) }

        /// 阶段剩余时间（以 `stageEnd` 为准，避免快照过期）
        public func remaining(at date: Date) -> Double { max(0, stageEnd.timeIntervalSince(date)) }
    }

    /// 课程唯一键（换课 / 换阶段时用于判断是否复用同一个 Activity）
    public let courseId: String
    /// 课程名称（需求：静态属性 courseName）
    public let courseName: String
    /// 教室号（需求：静态属性 roomNumber）
    public let roomNumber: String
    /// 教师姓名（需求：静态属性 teacherName）
    public let teacherName: String

    public init(courseId: String, courseName: String, roomNumber: String, teacherName: String) {
        self.courseId = courseId
        self.courseName = courseName
        self.roomNumber = roomNumber
        self.teacherName = teacherName
    }
}
