import BackgroundTasks
import Foundation
import WidgetKit

/// BGAppRefreshTask：App 被用户完全划掉后，系统仍会在“下一节课开始前 32 分钟”把 App 唤醒，
/// 在本进程里调用 ActivityKit 启动 Live Activity —— 这是 iOS 本地（无远程推送）能做的最大程度补救。
/// 注意：BGTask 的触发由系统调度（受“后台 App 刷新”总开关 / 低电量影响），无法保证到分钟级精确。
@available(iOS 13.0, *)
enum BackgroundReminderScheduler {
    /// Info.plist 里 BGTaskSchedulerPermittedIdentifiers 必须包含它
    static let identifier = "kz.kaznu.helper.refresh"

    private static let scheduleKey = "kaznu.background.lessons.v1"

    private struct Lesson: Codable {
        let id: String
        let name: String
        let short: String?
        let room: String?
        let prof: String?
        let weekday: Int // 0=周一 … 6=周日
        let startH: Int
        let startM: Int
        let endH: Int
        let endM: Int
    }

    // MARK: - 注册与生命周期

    /// 在 didFinishLaunching 调用一次。
    static func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: nil) { task in
            guard let refreshTask = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            handle(refreshTask)
        }
    }

    /// App 进入前台（becomeActive / 数据同步后）调用，确保系统手里始终有“下一个 32 分钟点”。
    static func scheduleNextIfNeeded(now: Date = Date()) {
        guard loadLessons()?.isEmpty == false else { return }
        submitNext(now: now)
    }

    private static func submitNext(now: Date) {
        guard let nextStart = nextLessonStart(after: now) else { return }
        // 需求：在课程开始前 32 分钟让 BGTask 触发
        let fireDate = nextStart.addingTimeInterval(-32 * 60)
        let request = BGAppRefreshTaskRequest(identifier: identifier)
        request.earliestBeginDate = max(fireDate, now.addingTimeInterval(30))
        try? BGTaskScheduler.shared.submit(request)
    }

    // MARK: - 后台任务回调

    private static func handle(_ task: BGAppRefreshTask) {
        // 先把下一次任务挂上
        submitNext(now: Date())
        // 如果在“上课前 32 分钟 ~ 上课”窗口内 → 静默拉起灵动岛倒计时
        tryStartLiveActivityIfNeeded(now: Date())

        task.expirationHandler = { /* 后台时间即将耗尽：无需额外清理 */ }
        task.setTaskCompleted(success: true)
    }

    /// 计算并尝试启动 Live Activity；返回是否已启动。
    /// 覆盖两个窗口：
    ///  - 课前 T-32 分钟 ~ 上课：倒计时到“上课时刻”
    ///  - 正在上课：倒计时到“下课时刻”（进度=已上课时长）
    /// 非灵动岛机型（iPhone XR 等）系统会自动把同一 Activity 渲染成锁屏/通知栏卡片。
    @discardableResult
    static func tryStartLiveActivityIfNeeded(now: Date = Date()) -> Bool {
        guard let lessons = loadLessons() else { return false }
        guard #available(iOS 16.2, *) else { return false }
        for lesson in lessons {
            guard let start = date(for: lesson.weekday, h: lesson.startH, m: lesson.startM, now: now) else { continue }
            guard let end = date(for: lesson.weekday, h: lesson.endH, m: lesson.endM, now: now),
                  end > start else { continue }

            let preWindowStart = start.addingTimeInterval(-32 * 60)
            if now >= preWindowStart && now < start {
                let remaining = start.timeIntervalSince(now)
                let payload = startPayload(
                    for: lesson,
                    startDate: start,
                    endDate: end,
                    kind: "pre-class",
                    totalSeconds: 30 * 60,
                    remainingSeconds: remaining
                )
                TimetableLiveActivityController.startNow(payload)
                return true
            }
            if now >= start && now < end {
                let total = end.timeIntervalSince(start)
                let remaining = max(0, end.timeIntervalSince(now))
                let payload = startPayload(
                    for: lesson,
                    startDate: start,
                    endDate: end,
                    kind: "in-class",
                    totalSeconds: total,
                    remainingSeconds: remaining
                )
                TimetableLiveActivityController.startNow(payload)
                return true
            }
        }
        return false
    }

    // MARK: - 与 Web 桥的数据同步（kaznuReminderSync message）

    /// JS 每次同步课表后调用：把扁平课表缓存进 UserDefaults 并重排 BGTask。
    static func syncSchedule(_ payload: [String: Any]) {
        guard let lessonsArray = payload["lessons"] as? [[String: Any]] else { return }
        let lessons = lessonsArray.compactMap { dict -> Lesson? in
            guard
                let id = dict["id"] as? String,
                let name = dict["name"] as? String,
                let weekday = (dict["weekday"] as? NSNumber)?.intValue,
                let startH = (dict["startH"] as? NSNumber)?.intValue,
                let startM = (dict["startM"] as? NSNumber)?.intValue,
                let endH = (dict["endH"] as? NSNumber)?.intValue,
                let endM = (dict["endM"] as? NSNumber)?.intValue
            else { return nil }
            return Lesson(
                id: id,
                name: name,
                short: dict["short"] as? String,
                room: dict["room"] as? String,
                prof: dict["prof"] as? String,
                weekday: weekday,
                startH: startH,
                startM: startM,
                endH: endH,
                endM: endM
            )
        }
        guard !lessons.isEmpty else { return }

        if let data = try? JSONEncoder().encode(lessons) {
            UserDefaults.standard.set(data, forKey: scheduleKey)
            // 同步给桌面小组件（App Group，需在签名里开启 App Groups 能力）
            if let suite = UserDefaults(suiteName: "group.com.kaznu.helper") {
                suite.set(data, forKey: "kaznu.schedule.v1")
            }
            WidgetCenter.shared.reloadAllTimelines()
        }
    }

    // MARK: - 数据 / 时间工具

    private static func loadLessons() -> [Lesson]? {
        guard let data = UserDefaults.standard.data(forKey: scheduleKey) else { return nil }
        return try? JSONDecoder().decode([Lesson].self, from: data)
    }

    /// Calendar weekday(1=周日) → 我们的 0=周一…6=周日
    private static func todayIndex(_ now: Date) -> Int {
        return (Calendar.current.component(.weekday, from: now) + 5) % 7
    }

    private static func date(for weekday: Int, h: Int, m: Int, now: Date) -> Date? {
        let calendar = Calendar.current
        let today = calendar.date(bySettingHour: 0, minute: 0, second: 0, of: now) ?? now
        let dayDiff = (weekday - todayIndex(now) + 7) % 7
        guard let day = calendar.date(byAdding: .day, value: dayDiff, to: today) else { return nil }
        return calendar.date(bySettingHour: h, minute: m, second: 0, of: day)
    }

    private static func nextLessonStart(after now: Date) -> Date? {
        guard let lessons = loadLessons() else { return nil }
        var best: Date?
        for lesson in lessons {
            if var candidate = date(for: lesson.weekday, h: lesson.startH, m: lesson.startM, now: now) {
                if candidate <= now, let nextWeek = Calendar.current.date(byAdding: .day, value: 7, to: candidate) {
                    candidate = nextWeek
                }
                if candidate > now && (best == nil || candidate < best!) {
                    best = candidate
                }
            }
        }
        return best
    }

    // MARK: - Payload（与 Web 端 LiveActivity 契约一致）

    private static func startPayload(
        for lesson: Lesson,
        startDate: Date,
        endDate: Date,
        kind: String,
        totalSeconds: Double,
        remainingSeconds: TimeInterval
    ) -> [String: Any] {
        let remaining = max(0, remainingSeconds)
        let fraction = remaining / totalSeconds
        let phase: String = fraction > 0.5 ? "green" : (fraction > 0.25 ? "orange" : "red")
        let courseShort = (lesson.short ?? initials(of: lesson.name)).uppercased()
        let isPreClass = kind == "pre-class"
        let statusLabel = isPreClass
            ? "Starts in \(Int(ceil(remaining / 60))) min"
            : "Class ends in \(Int(ceil(remaining / 60))) min"

        return [
            "control": "start",
            "course": [
                "name": lesson.name,
                "type": "lecture",
                "professor": lesson.prof ?? "",
                "room": lesson.room ?? "",
                "building": "",
            ],
            "courseShort": courseShort,
            "timeWindow": [
                "start": String(format: "%02d:%02d", lesson.startH, lesson.startM),
                "end": String(format: "%02d:%02d", lesson.endH, lesson.endM),
            ],
            "countdownSeconds": remaining,
            "totalSeconds": totalSeconds,
            "phase": phase,
            "kind": kind,
            "statusLabel": statusLabel,
            "navigation": ["label": "Open Schedule", "url": "kaznuhelper://schedule"],
            "shouldShowLiveActivity": true,
        ]
    }

    private static func initials(of name: String) -> String {
        let parts = name.split(separator: " ")
            .filter { !$0.isEmpty && ($0.first?.isLetter == true) }
            .prefix(2)
        if parts.isEmpty { return String(name.prefix(2)) }
        return parts.map { String($0.prefix(1)) }.joined()
    }
}

