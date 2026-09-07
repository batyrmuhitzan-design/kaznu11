import ActivityKit
import Foundation

/// App 端 Live Activity 控制器（ActivityKit）。
///
/// 与 Web 端约定的 payload：
/// ```json
/// {
///   "control": "start" | "update" | "end",
///   "course":  { "name", "type", "professor", "room", "building" },
///   "courseShort": "LA",
///   "countdownSeconds": 1500, "totalSeconds": 1800,
///   "phase": "green", "kind": "pre-class", "statusLabel": "Starts in 25 min",
///   "navigation": { "label": "Open Schedule", "url": "kaznuhelper://schedule" }
/// }
/// ```
/// 计时代理：Activity 以「现在 − 已消耗」为 startDate、「现在 + 剩余」为 endDate，
/// 因此不管中途（T-30~T-0 任意时刻）启动都能精确显示剩余时间。
@available(iOS 16.2, *)
enum TimetableLiveActivityController {
    private static let storedIDKey = "kaznu.timetableLiveActivityID"

    // MARK: - 入口

    static func handle(_ payload: [String: Any]) {
        let control = payload["control"] as? String
        switch control {
        case "start":
            start(from: payload)
        case "update":
            update(from: payload)
        case "end":
            endAll()
        default:
            // 老版本心跳（无 control）：不打扰由服务精确驱动的 Live Activity
            break
        }
    }

    /// 后台任务 / 通知按钮直接以“已算好的启动 payload”拉起 Live Activity。
    static func startNow(_ payload: [String: Any]) {
        start(from: payload)
    }

    // MARK: - Start / Update / End

    private static func start(from payload: [String: Any]) {
        guard let content = makeContent(from: payload) else { return }

        // 如果旧活动还开着，先收掉，避免多个 Live Activity 同屏
        if currentActivity() != nil {
            endAll()
        }

        do {
            let activity = try Activity<TimetableLiveActivityAttributes>.request(
                attributes: content.attributes,
                content: ActivityContent(state: content.state, staleDate: nil)
            )
            UserDefaults.standard.set(activity.id, forKey: storedIDKey)
        } catch {
            // 未授权 / 超过数量上限等情况静默失败（本地通知仍会兜底）
        }
    }

    private static func update(from payload: [String: Any]) {
        guard let activity = currentActivity() else { return }
        let isEndSignal = (payload["kind"] as? String) == "none"
        guard !isEndSignal, let content = makeContent(from: payload) else {
            if isEndSignal { endAll() }
            return
        }
        Task {
            await activity.update(ActivityContent(state: content.state, staleDate: nil))
        }
    }

    private static func endAll() {
        Task {
            let activities = Activity<TimetableLiveActivityAttributes>.activities
            for activity in activities {
                await activity.end(dismissalPolicy: .immediate)
            }
        }
        UserDefaults.standard.removeObject(forKey: storedIDKey)
    }

    private static func currentActivity() -> Activity<TimetableLiveActivityAttributes>? {
        let storedID = UserDefaults.standard.string(forKey: storedIDKey)
        let activities = Activity<TimetableLiveActivityAttributes>.activities
        if let storedID, let match = activities.first(where: { $0.id == storedID }) {
            return match
        }
        return activities.first
    }

    // MARK: - Payload 解析

    private static func makeContent(
        from payload: [String: Any]
    ) -> (attributes: TimetableLiveActivityAttributes, state: TimetableLiveActivityAttributes.ContentState)? {
        let course = payload["course"] as? [String: Any] ?? [:]
        let name = string(course["name"]) ?? "Class"
        let room = string(course["room"]) ?? ""
        let building = string(course["building"]) ?? ""
        let professor = string(course["professor"]) ?? ""
        let short = string(payload["courseShort"]) ?? initials(of: name)
        let kind = string(payload["kind"]) ?? "pre-class"
        let statusLabel = string(payload["statusLabel"]) ?? ""

        let totalSeconds = Double(number(payload["totalSeconds"]) ?? 1800)
        let rawRemaining = Double(number(payload["countdownSeconds"]) ?? 0)
        let remainingSeconds = max(0, min(totalSeconds, rawRemaining))

        // 计时代理：任意时刻启动都精确
        let now = Date()
        let startDate = now.addingTimeInterval(-(totalSeconds - remainingSeconds))
        let endDate = now.addingTimeInterval(remainingSeconds)

        let navigation = payload["navigation"] as? [String: Any]
        let navigationLabel = string(navigation?["label"])
        let navigationURL = string(navigation?["url"])

        let courseID = "\(name)-\(room)-\(Int(endDate.timeIntervalSince1970))"
        let attributes = TimetableLiveActivityAttributes(
            courseId: courseID,
            countdownStartDate: startDate,
            countdownEndDate: endDate
        )
        let state = TimetableLiveActivityAttributes.ContentState(
            courseShort: short,
            courseName: name,
            room: room.isEmpty ? building : room,
            building: building,
            professor: professor,
            statusLabel: statusLabel,
            kind: kind,
            totalSeconds: totalSeconds,
            remainingSeconds: remainingSeconds,
            navigationLabel: navigationLabel,
            navigationURL: navigationURL
        )
        return (attributes, state)
    }

    // MARK: - 小工具

    private static func string(_ value: Any?) -> String? {
        if let text = value as? String, !text.isEmpty { return text }
        return nil
    }

    private static func number(_ value: Any?) -> Double? {
        if let number = value as? NSNumber { return number.doubleValue }
        if let number = value as? Double { return number }
        if let number = value as? Int { return Double(number) }
        return nil
    }

    private static func initials(of name: String) -> String {
        let parts = name.split(separator: " ")
            .filter { !$0.isEmpty && ($0.first?.isLetter == true) }
            .prefix(2)
        if parts.isEmpty { return String(name.prefix(2)).uppercased() }
        return parts.map { String($0.prefix(1)) }.joined().uppercased()
    }
}
