import BackgroundTasks
import Foundation
import WidgetKit

/// BGAppRefreshTask：App 被用户完全划掉后，系统仍会在“下一节课开始前 32 分钟”把 App 唤醒，
/// 在本进程里让 `KaznuActivityManager` 重新判定“课前 / 课中 / 该收起”，并拉起或刷新 Live Activity
/// —— 这是 iOS 本地（无远程推送）能做的最大程度补救。
/// 注意：BGTask 的触发由系统调度（受“后台 App 刷新”总开关 / 低电量影响），无法保证到分钟级精确。
@available(iOS 13.0, *)
enum BackgroundReminderScheduler {
    /// Info.plist 里 BGTaskSchedulerPermittedIdentifiers 必须包含它
    static let identifier = "kz.kaznu.helper.refresh"

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
        guard !KaznuLessonStore.load().isEmpty else { return }
        submitNext(now: now)
    }

    private static func submitNext(now: Date) {
        guard let nextStart = nextLessonStart(after: now) else { return }
        // 上课前 32 分钟唤醒（比 30 分钟窗口早 2 分钟，给系统调度抖动留余量）
        let request = BGAppRefreshTaskRequest(identifier: identifier)
        request.earliestBeginDate = max(nextStart.addingTimeInterval(-32 * 60), now.addingTimeInterval(30))
        try? BGTaskScheduler.shared.submit(request)
    }

    // MARK: - 后台任务回调

    private static func handle(_ task: BGAppRefreshTask) {
        // 先把下一次任务挂上
        submitNext(now: Date())
        // 按课表重新判定并同步 Live Activity（课前倒计时 / 课中倒计时 / 自动收起）
        syncCourseLiveActivityIfNeeded(now: Date())

        task.expirationHandler = { /* 后台时间即将耗尽：无需额外清理 */ }
        task.setTaskCompleted(success: true)
    }

    /// 交给 `KaznuActivityManager` 重新判定当前该显示什么（需求 3 的自动化逻辑都在单例里）。
    /// - Returns: 调用后是否有 Live Activity 在运行
    @discardableResult
    static func syncCourseLiveActivityIfNeeded(now: Date = Date()) -> Bool {
        guard #available(iOS 16.2, *) else { return false }
        return KaznuActivityManager.shared.sync(now: now)
    }

    // MARK: - 与 Web 桥的数据同步（kaznuReminderSync message）

    /// JS 每次同步课表后调用：缓存课表 → 刷新桌面小组件 → 重排 BGTask → 立刻同步一次 Live Activity。
    static func syncSchedule(_ payload: [String: Any]) {
        guard let raw = payload["lessons"] as? [[String: Any]] else { return }

        if #available(iOS 16.2, *), KaznuActivityManager.shared.registerSchedule(lessons: raw) > 0 {
            scheduleNextIfNeeded()
            return
        }

        // iOS 16.2 以下没有 Live Activity：只缓存课表 + 刷新桌面小组件
        let lessons = KaznuLessonStore.parse(raw)
        guard !lessons.isEmpty else { return }
        KaznuLessonStore.save(lessons)
        WidgetCenter.shared.reloadAllTimelines()
        scheduleNextIfNeeded()
    }

    // MARK: - 时间工具

    /// 下一节课的上课时刻（自动处理“今天已过 → 下周同一天”）
    static func nextLessonStart(after now: Date) -> Date? {
        var best: Date?
        let calendar = Calendar.current
        for lesson in KaznuLessonStore.load() {
            guard let thisWeek = lesson.startDate(now: now) else { continue }
            let start = thisWeek > now
                ? thisWeek
                : (calendar.date(byAdding: .day, value: 7, to: thisWeek) ?? thisWeek)
            guard start > now else { continue }
            if best == nil || start < best! { best = start }
        }
        return best
    }
}
