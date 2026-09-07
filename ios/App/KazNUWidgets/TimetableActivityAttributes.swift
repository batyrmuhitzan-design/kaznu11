import ActivityKit
import Foundation

// ⚠️ 这个文件必须同时被 两个 Target 编译（membership 勾选 App + KazNUWidgets）：
//  - App 用它发起 / 刷新 / 结束 Live Activity；
//  - Widget Extension 用它声明 ActivityConfiguration 并渲染。
// 两侧的 struct 名称与字段必须完全一致，否则系统无法匹配 Activity。
@available(iOS 16.1, *)
public struct TimetableLiveActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// 灵动岛紧凑区缩写（如 LA / HM2）
        public var courseShort: String
        public var courseName: String
        public var room: String
        public var building: String
        public var professor: String
        /// “Starts in 25 min”等辅助文案
        public var statusLabel: String
        /// "pre-class"（课前倒计时到上课时刻）
        public var kind: String
        /// 30 分钟倒计时的总秒数（1800）
        public var totalSeconds: Double
        /// 当前剩余秒数（原生/系统刷新时更新）
        public var remainingSeconds: Double
        /// 展开视图的 Navigation 按钮
        public var navigationLabel: String?
        public var navigationURL: String?

        public init(
            courseShort: String,
            courseName: String,
            room: String,
            building: String,
            professor: String,
            statusLabel: String,
            kind: String,
            totalSeconds: Double,
            remainingSeconds: Double,
            navigationLabel: String? = nil,
            navigationURL: String? = nil
        ) {
            self.courseShort = courseShort
            self.courseName = courseName
            self.room = room
            self.building = building
            self.professor = professor
            self.statusLabel = statusLabel
            self.kind = kind
            self.totalSeconds = totalSeconds
            self.remainingSeconds = remainingSeconds
            self.navigationLabel = navigationLabel
            self.navigationURL = navigationURL
        }
    }

    public let courseId: String
    /// 倒计时起点：上课前 30 分钟
    public let countdownStartDate: Date
    /// 倒计时终点：上课时刻（T-0）
    public let countdownEndDate: Date

    public init(courseId: String, countdownStartDate: Date, countdownEndDate: Date) {
        self.courseId = courseId
        self.countdownStartDate = countdownStartDate
        self.countdownEndDate = countdownEndDate
    }
}
