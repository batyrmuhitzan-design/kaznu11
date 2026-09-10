import ActivityKit
import Foundation
import UIKit
import WidgetKit

/// 课程 Live Activity 的唯一入口（App Target）。
///
/// 职责：
///  1. `start` / `update` / `end`：主 App、Web 桥、后台任务统一通过它操作 Activity；
///  2. `sync(now:)`：需求里的生命周期自动化 ——
///     · 上课前 30 分钟自动启动半小时倒计时（`preClass`，总 1800 秒）；
///     · 上课后倒计时到下课（`inClass`）；
///     · 课中若距下一节课 < 15 分钟 → 自动切换为下节课的倒计时；
///     · 没有课程 / 距下节课很远 → 自动 `end` 收起 Activity；
///  3. 智能刷新：只在对的时刻（60% / 20% 换色点、整分钟、阶段结束）更新内容，
///     其余时间交给系统计时器渲染，节省 ActivityKit 的更新预算。
///
/// 用法：
/// ```swift
/// KaznuActivityManager.shared.start(courseName: "Linear Algebra", roomNumber: "204",
///                                   teacherName: "Dr. A. Suleimenov",
///                                   phase: .preClass, remainingSeconds: 1800, totalSeconds: 1800)
/// KaznuActivityManager.shared.update(remainingSeconds: 900, totalSeconds: 1800, phase: .preClass)
/// KaznuActivityManager.shared.end()
/// ```
@available(iOS 16.2, *)
public final class KaznuActivityManager {

    /// 干净单例：整个 App 生命周期内只此一个
    public static let shared = KaznuActivityManager()

    // MARK: - 常量

    /// App Group（两个 Target 的 entitlements 均已开启），课表缓存与桌面小组件共用
    public static let appGroupID = KaznuLessonStore.appGroupID
    /// App Group 内的课表 key
    public static let scheduleKey = KaznuLessonStore.scheduleKey
    /// 标准 UserDefaults 内的课表备份 key（BackgroundReminderScheduler 读写）
    public static let standardScheduleKey = KaznuLessonStore.standardScheduleKey
    /// 课前提前量：30 分钟（需求 3.1）
    public static let preClassLeadSeconds: TimeInterval = 30 * 60
    /// 课前倒计时总时长：1800 秒（需求 1）
    public static let preClassTotalSeconds: Double = 30 * 60
    /// 距下一节课小于该值时，课中倒计时让位给下节课的课前倒计时（需求 3.2）
    public static let nextClassSwitchSeconds: TimeInterval = 15 * 60

    private static let activityIDKey = "kaznu.course.live.activity.id"

    // MARK: - 对外状态

    /// 系统是否允许 Live Activity（用户在设置里关掉时为 false）
    public var isSupported: Bool { ActivityAuthorizationInfo().areActivitiesEnabled }
    /// 当前是否有本 App 的课程 Activity 在跑
    public var isRunning: Bool { currentActivity() != nil }
    /// 最近一次操作是否成功（供 Web 端回执提示）
    public private(set) var lastSucceeded = false
    /// 最近一次操作的结果描述（供 Web 端回执提示 / 排查）
    public private(set) var lastMessage = "no-request"

    /// 下一次内容刷新（换色 / 换文案 / 阶段结束）的定时器
    private var refreshTimer: Timer?

    private init() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleDidBecomeActive),
            name: UIApplication.didBecomeActiveNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleDidEnterBackground),
            name: UIApplication.didEnterBackgroundNotification,
            object: nil
        )
    }

    /// 回到前台：BGTask 不保证分钟级，这里补一次（含“已归零要收起”的情况）
    @objc private func handleDidBecomeActive() {
        _ = sync()
    }

    /// 进入后台：定时器会被系统挂起，主动释放避免“假活”
    @objc private func handleDidEnterBackground() {
        refreshTimer?.invalidate()
        refreshTimer = nil
    }

    // MARK: - Start

    /// 启动（或复用）一条课程 Live Activity。
    ///
    /// - Parameters:
    ///   - courseName / roomNumber / teacherName：静态属性，写入后不可变更
    ///   - phase：`preClass` 课前 / `inClass` 课中
    ///   - remainingSeconds / totalSeconds：当前阶段剩余与总秒数
    ///   - courseId：课程唯一键；同 key 且同 phase 时只做 update（灵动岛不闪烁）
    ///   - courseShort / statusLabel / navigation：可选增强（紧凑区缩写、副标题、跳转按钮）
    /// - Returns: 是否已成功启动 / 刷新
    @discardableResult
    public func start(
        courseName: String,
        roomNumber: String,
        teacherName: String,
        phase: KaznuCoursePhase,
        remainingSeconds: TimeInterval,
        totalSeconds: TimeInterval,
        courseId: String? = nil,
        courseShort: String? = nil,
        statusLabel: String? = nil,
        navigation: (label: String, url: String)? = nil,
        now: Date = Date()
    ) -> Bool {
        guard isSupported else {
            return fail("Live Activities are disabled in Settings")
        }

        let total = max(1, totalSeconds)
        let remaining = min(total, max(0, remainingSeconds))
        let state = Self.makeState(
            phase: phase,
            remainingSeconds: remaining,
            totalSeconds: total,
            courseShort: courseShort ?? KaznuCourseMetric.initials(of: courseName),
            statusLabel: statusLabel,
            navigation: navigation,
            now: now
        )
        let attributes = KaznuCourseAttributes(
            courseId: courseId ?? Self.courseKey(name: courseName, room: roomNumber, stageEnd: state.stageEnd),
            courseName: courseName,
            roomNumber: roomNumber,
            teacherName: teacherName
        )

        // 同一课程 + 同一阶段：直接 update，避免灵动岛重建造成闪烁
        if let running = currentActivity(),
           running.attributes.courseId == attributes.courseId,
           running.content.state.phase == phase {
            return updateState(state, of: running, now: now)
        }

        // 换课 / 换阶段：旧 Activity 先收起，再以新的静态属性重建
        endActivities()

        do {
            let activity = try Activity<KaznuCourseAttributes>.request(
                attributes: attributes,
                content: ActivityContent(state: state, staleDate: state.stageEnd),
                pushType: nil
            )
            storeActivityID(activity.id)
            scheduleRefresh(for: state, now: now)
            return succeed("Live Activity started (\(phase.rawValue)) id=\(activity.id)")
        } catch {
            return fail("Activity.request failed: \(error.localizedDescription)")
        }
    }

    // MARK: - Update

    /// 刷新剩余秒数 / 阶段 / 文案。没有在跑的 Activity 时返回 false（可改用 `start`）。
    @discardableResult
    public func update(
        remainingSeconds: TimeInterval,
        totalSeconds: TimeInterval,
        phase: KaznuCoursePhase,
        courseShort: String? = nil,
        statusLabel: String? = nil,
        now: Date = Date()
    ) -> Bool {
        guard let running = currentActivity() else {
            return fail("no running Live Activity")
        }
        let total = max(1, totalSeconds)
        let state = Self.makeState(
            phase: phase,
            remainingSeconds: min(total, max(0, remainingSeconds)),
            totalSeconds: total,
            courseShort: courseShort ?? running.content.state.courseShort,
            statusLabel: statusLabel,
            navigation: Self.navigation(from: running.content.state),
            now: now
        )
        return updateState(state, of: running, now: now)
    }

    @discardableResult
    private func updateState(
        _ state: KaznuCourseAttributes.ContentState,
        of activity: Activity<KaznuCourseAttributes>,
        now: Date
    ) -> Bool {
        Task {
            await activity.update(ActivityContent(state: state, staleDate: state.stageEnd))
        }
        scheduleRefresh(for: state, now: now)
        return succeed("Live Activity updated")
    }

    // MARK: - End

    /// 结束全部课程 Activity（没有在跑的返回 false）。
    @discardableResult
    public func end() -> Bool {
        refreshTimer?.invalidate()
        refreshTimer = nil
        guard isRunning else {
            lastSucceeded = false
            lastMessage = "no running Live Activity"
            return false
        }
        endActivities()
        return succeed("Live Activity ended")
    }

    // MARK: - 生命周期自动化（需求 3）

    /// 依据本地课表推导“现在该显示什么”，自动启动 / 刷新 / 结束 Activity。
    ///
    /// 调用时机：App 启动、回到前台、BGAppRefreshTask 唤醒、Web 端同步课表后。
    /// - Returns: 调用结束后是否有 Activity 在运行
    @discardableResult
    public func sync(now: Date = Date()) -> Bool {
        let lessons = KaznuLessonStore.load()
        guard !lessons.isEmpty else {
            _ = endIfRunning("no schedule cached")
            return false
        }
        guard let stage = Self.resolveStage(lessons: lessons, now: now) else {
            _ = endIfRunning("no class within the pre-class window")
            return false
        }
        return start(
            courseName: stage.lesson.name,
            roomNumber: stage.lesson.room ?? "",
            teacherName: stage.lesson.prof ?? "",
            phase: stage.phase,
            remainingSeconds: stage.remaining,
            totalSeconds: stage.total,
            courseId: Self.courseKey(
                name: stage.lesson.name,
                room: stage.lesson.room ?? "",
                stageEnd: stage.end
            ),
            courseShort: stage.lesson.short,
            now: now
        )
    }

    /// 阶段判定规则（需求 3 的唯一实现）：
    ///  1. 正在上课：默认倒计时到下课；若距下一节课 < 15 分钟 → 切换为下节课的课前倒计时；
    ///  2. 尚未开课：距上课 ≤ 30 分钟 → 课前半小时倒计时（总 1800 秒）；
    ///  3. 其它情况 → nil（调用方收起 Activity）。
    static func resolveStage(
        lessons: [KaznuLesson],
        now: Date
    ) -> (lesson: KaznuLesson, phase: KaznuCoursePhase, remaining: TimeInterval, total: Double, end: Date)? {
        let current = lessons.first { lesson in
            guard let start = lesson.startDate(now: now) else { return false }
            return now >= start && now < start.addingTimeInterval(lesson.duration)
        }
        let upcoming = nextLessonStart(after: now, lessons: lessons)

        if let current, let start = current.startDate(now: now) {
            let end = start.addingTimeInterval(current.duration)
            if let upcoming, upcoming.start.timeIntervalSince(now) < Self.nextClassSwitchSeconds {
                // 快下课 + 下节课马上开始 → 直接进入下节课的课前倒计时
                return (
                    upcoming.lesson,
                    .preClass,
                    upcoming.start.timeIntervalSince(now),
                    Self.preClassTotalSeconds,
                    upcoming.start
                )
            }
            return (current, .inClass, end.timeIntervalSince(now), end.timeIntervalSince(start), end)
        }

        if let upcoming {
            let lead = upcoming.start.timeIntervalSince(now)
            if lead <= Self.preClassLeadSeconds {
                return (upcoming.lesson, .preClass, lead, Self.preClassTotalSeconds, upcoming.start)
            }
        }
        return nil
    }

    /// 下一节课（自动处理“今天已过 → 下周同一天”）。
    static func nextLessonStart(
        after now: Date,
        lessons: [KaznuLesson]
    ) -> (lesson: KaznuLesson, start: Date)? {
        var best: (lesson: KaznuLesson, start: Date)?
        let calendar = Calendar.current
        for lesson in lessons {
            guard let thisWeek = lesson.startDate(now: now) else { continue }
            let start = thisWeek > now
                ? thisWeek
                : (calendar.date(byAdding: .day, value: 7, to: thisWeek) ?? thisWeek)
            guard start > now else { continue }
            if best == nil || start < best!.start {
                best = (lesson, start)
            }
        }
        return best
    }

    // MARK: - 智能刷新

    /// 只在“真正需要变”的时刻刷新：换色点（60% / 20%）、整分钟、进入 mm:ss 后、阶段结束。
    private func scheduleRefresh(for state: KaznuCourseAttributes.ContentState, now: Date) {
        refreshTimer?.invalidate()
        let interval = Self.nextRefreshInterval(state: state, now: now)
        let timer = Timer(timeInterval: interval, repeats: false) { [weak self] _ in
            guard let self = self else { return }
            self.refreshTimer = nil
            _ = self.sync()
        }
        timer.tolerance = min(2, interval / 4)
        RunLoop.main.add(timer, forMode: .common)
        refreshTimer = timer
    }

    /// 下一次内容刷新间隔（秒）。
    ///
    /// 说明：ActivityKit 的内容更新需要 App 进程存活；App 在后台时定时器会被系统挂起，
    /// 此时圆环内的数字仍由系统计时器逐秒自走，颜色 / 文案会在下次唤醒（BGTask / 回前台）时校正。
    public static func nextRefreshInterval(
        state: KaznuCourseAttributes.ContentState,
        now: Date
    ) -> TimeInterval {
        let remaining = max(0, state.stageEnd.timeIntervalSince(now))
        guard remaining > 0 else { return 5 }

        var candidates: [TimeInterval] = [remaining]
        // 换色点：剩余比例正好等于 60% / 20% 的那一刻
        for threshold in [KaznuCourseMetric.safeThreshold, KaznuCourseMetric.criticalThreshold] {
            let delta = remaining - state.totalSeconds * threshold
            if delta > 1 { candidates.append(delta) }
        }
        if remaining > KaznuCourseMetric.detailedTextThreshold {
            // `29m` 每分钟变一次：对齐到下一个整分钟
            let toMinute = remaining.truncatingRemainder(dividingBy: 60)
            candidates.append(toMinute > 1 ? toMinute : 60)
        } else {
            // 最后 10 分钟：每 30 秒推进一次圆环，看起来更顺滑
            candidates.append(30)
        }
        return max(5, candidates.min() ?? 60)
    }

    // MARK: - Activity 存取

    private func currentActivity() -> Activity<KaznuCourseAttributes>? {
        let activities = Activity<KaznuCourseAttributes>.activities
        guard !activities.isEmpty else { return nil }
        if let storedID = UserDefaults.standard.string(forKey: Self.activityIDKey),
           let match = activities.first(where: { $0.id == storedID }) {
            return match
        }
        return activities.first
    }

    private func storeActivityID(_ id: String) {
        UserDefaults.standard.set(id, forKey: Self.activityIDKey)
    }

    /// 收起本 App 全部课程 Activity，并清掉本地记录
    private func endActivities() {
        for activity in Activity<KaznuCourseAttributes>.activities {
            Task { await activity.end(nil, dismissalPolicy: .immediate) }
        }
        UserDefaults.standard.removeObject(forKey: Self.activityIDKey)
    }

    /// 没有课程 / 距下节课很远时自动销毁 Activity（需求 3.3）
    @discardableResult
    private func endIfRunning(_ reason: String) -> Bool {
        guard isRunning else {
            lastSucceeded = true
            lastMessage = "idle (\(reason))"
            return false
        }
        endActivities()
        lastSucceeded = true
        lastMessage = "auto-ended (\(reason))"
        return false
    }

    // MARK: - Web 契约适配（src/native/liveActivity.ts）

    /// 兼容既有 Web payload：
    /// ```json
    /// { "control": "start|update|end",
    ///   "course": { "name", "room", "building", "professor", "type" },
    ///   "courseShort": "LA", "countdownSeconds": 1500, "totalSeconds": 1800,
    ///   "phase": "green|orange|red", "kind": "pre-class|in-class|none",
    ///   "statusLabel": "Starts in 25 min",
    ///   "navigation": { "label": "Open Schedule", "url": "kaznuhelper://schedule" },
    ///   "shouldShowLiveActivity": true }
    /// ```
    /// 说明：旧契约的 `phase` 表示**颜色**；新实现按需求由 `progress` 推导颜色，
    /// 因此这里用 `kind` 映射阶段（`in-class` → `inClass`，其余 → `preClass`）。
    @discardableResult
    public func handle(_ payload: [String: Any]) -> Bool {
        let control = Self.string(payload["control"]) ?? "update"
        let kind = Self.string(payload["kind"]) ?? "pre-class"
        let shouldShow = (payload["shouldShowLiveActivity"] as? NSNumber)?.boolValue
        if control == "end" || kind == "none" || shouldShow == false {
            return end()
        }

        let course = payload["course"] as? [String: Any] ?? [:]
        let name = Self.string(course["name"]) ?? "Class"
        let room = Self.string(course["room"]) ?? Self.string(course["building"]) ?? ""
        let teacher = Self.string(course["professor"]) ?? ""
        let total = Self.number(payload["totalSeconds"]) ?? Self.preClassTotalSeconds
        let remaining = Self.number(payload["countdownSeconds"]) ?? 0
        let phase: KaznuCoursePhase = kind == "in-class" ? .inClass : .preClass
        let short = Self.string(payload["courseShort"])
        let status = Self.string(payload["statusLabel"])

        var navigation: (label: String, url: String)?
        if let raw = payload["navigation"] as? [String: Any], let url = Self.string(raw["url"]) {
            navigation = (label: Self.string(raw["label"]) ?? "Open", url: url)
        }

        if control == "update",
           let running = currentActivity(),
           running.attributes.courseName == name,
           running.content.state.phase == phase {
            return update(
                remainingSeconds: remaining,
                totalSeconds: total,
                phase: phase,
                courseShort: short,
                statusLabel: status
            )
        }

        return start(
            courseName: name,
            roomNumber: room,
            teacherName: teacher,
            phase: phase,
            remainingSeconds: remaining,
            totalSeconds: total,
            courseShort: short,
            statusLabel: status,
            navigation: navigation
        )
    }

    /// Web 端每次同步课表后调用（原 BackgroundReminderScheduler.syncSchedule 的缓存逻辑）：
    /// 写入 App Group + 标准 UserDefaults，刷新桌面小组件，并立刻同步一次 Live Activity。
    /// - Returns: 成功缓存的课程条数
    @discardableResult
    public func registerSchedule(lessons rawLessons: [[String: Any]]) -> Int {
        let lessons = KaznuLessonStore.parse(rawLessons)
        guard !lessons.isEmpty else { return 0 }
        KaznuLessonStore.save(lessons)
        WidgetCenter.shared.reloadAllTimelines()
        _ = sync()
        return lessons.count
    }

    // MARK: - 装配 / 工具

    /// 由剩余 / 总秒数推导阶段起止并拼装 ContentState
    static func makeState(
        phase: KaznuCoursePhase,
        remainingSeconds: Double,
        totalSeconds: Double,
        courseShort: String,
        statusLabel: String?,
        navigation: (label: String, url: String)?,
        now: Date
    ) -> KaznuCourseAttributes.ContentState {
        let stageEnd = now.addingTimeInterval(remainingSeconds)
        let stageStart = now.addingTimeInterval(-(totalSeconds - remainingSeconds))
        return KaznuCourseAttributes.ContentState(
            remainingSeconds: remainingSeconds,
            totalSeconds: totalSeconds,
            phase: phase,
            progress: KaznuCourseMetric.progress(totalSeconds: totalSeconds, remainingSeconds: remainingSeconds),
            stageStart: stageStart,
            stageEnd: stageEnd,
            courseShort: courseShort,
            statusLabel: statusLabel ?? KaznuCourseMetric.statusText(phase: phase, remainingSeconds: remainingSeconds),
            navigationLabel: navigation?.label,
            navigationURL: navigation?.url
        )
    }

    /// 课程唯一键：同课程同阶段复用同一条 Activity，换课 / 换阶段则重建
    static func courseKey(name: String, room: String, stageEnd: Date) -> String {
        "\(name)|\(room)|\(Int(stageEnd.timeIntervalSince1970))"
    }

    static func navigation(
        from state: KaznuCourseAttributes.ContentState
    ) -> (label: String, url: String)? {
        guard let url = state.navigationURL else { return nil }
        return (label: state.navigationLabel ?? "Open", url: url)
    }

    @discardableResult
    private func succeed(_ message: String) -> Bool {
        lastSucceeded = true
        lastMessage = message
        return true
    }

    @discardableResult
    private func fail(_ message: String) -> Bool {
        lastSucceeded = false
        lastMessage = message
        return false
    }

    static func string(_ value: Any?) -> String? {
        guard let text = value as? String,
              !text.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        return text
    }

    static func number(_ value: Any?) -> Double? {
        if let number = value as? NSNumber { return number.doubleValue }
        if let number = value as? Double { return number }
        if let number = value as? Int { return Double(number) }
        if let text = value as? String { return Double(text) }
        return nil
    }
}

// MARK: - 课表数据层（App Target 共用；不做版本门槛，BackgroundReminderScheduler 也用它）

/// 一节课。字段与 Web 端 `CourseReminderLesson`、桌面小组件读的 `kaznu.schedule.v1` 完全对齐。
public struct KaznuLesson: Codable, Hashable {
    public let id: String
    public let name: String
    public let short: String?
    public let room: String?
    public let prof: String?
    /// 0 = 周一 … 6 = 周日
    public let weekday: Int
    public let startH: Int
    public let startM: Int
    public let endH: Int
    public let endM: Int

    /// 课程时长（秒），至少 5 分钟，避免脏数据算出 0 进度
    public var duration: TimeInterval {
        let minutes = (endH * 60 + endM) - (startH * 60 + startM)
        return TimeInterval(max(5, minutes)) * 60
    }

    /// 本周内该课程的上课时刻（可能是过去时间，由调用方判断）
    public func startDate(now: Date = Date()) -> Date? {
        let calendar = Calendar.current
        let todayIndex = (calendar.component(.weekday, from: now) + 5) % 7
        let dayDiff = (weekday - todayIndex + 7) % 7
        guard let day = calendar.date(byAdding: .day, value: dayDiff, to: now) else { return nil }
        return calendar.date(bySettingHour: startH, minute: startM, second: 0, of: day)
    }
}

/// 课表缓存读写：App Group 优先（与桌面小组件 / 扩展共用），标准 UserDefaults 兜底。
public enum KaznuLessonStore {
    /// App Group（两个 Target 的 entitlements 均已开启）
    public static let appGroupID = "group.com.kaznu.helper"
    /// App Group 内的课表 key
    public static let scheduleKey = "kaznu.schedule.v1"
    /// 标准 UserDefaults 内的课表 key
    public static let standardScheduleKey = "kaznu.background.lessons.v1"

    /// 读取已缓存课表；两处都没有则返回空数组
    public static func load() -> [KaznuLesson] {
        let sources: [UserDefaults?] = [UserDefaults(suiteName: appGroupID), UserDefaults.standard]
        for source in sources {
            guard let defaults = source else { continue }
            guard let data = defaults.data(forKey: scheduleKey)
                ?? defaults.data(forKey: standardScheduleKey) else { continue }
            if let lessons = try? JSONDecoder().decode([KaznuLesson].self, from: data), !lessons.isEmpty {
                return lessons
            }
        }
        return []
    }

    /// 写入课表（App Group + 标准 UserDefaults 各一份）
    public static func save(_ lessons: [KaznuLesson]) {
        guard let data = try? JSONEncoder().encode(lessons) else { return }
        UserDefaults.standard.set(data, forKey: standardScheduleKey)
        UserDefaults(suiteName: appGroupID)?.set(data, forKey: scheduleKey)
    }

    /// 解析 Web `__KAZNU_BG_REMINDER_SYNC__({ lessons })` 传来的扁平课表
    public static func parse(_ rawLessons: [[String: Any]]) -> [KaznuLesson] {
        var lessons: [KaznuLesson] = []
        for dict in rawLessons {
            guard
                let id = dict["id"] as? String,
                let name = dict["name"] as? String,
                let weekday = int(dict["weekday"]),
                let startH = int(dict["startH"]),
                let startM = int(dict["startM"]),
                let endH = int(dict["endH"]),
                let endM = int(dict["endM"])
            else { continue }
            lessons.append(
                KaznuLesson(
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
            )
        }
        return lessons
    }

    private static func int(_ value: Any?) -> Int? {
        if let number = value as? NSNumber { return number.intValue }
        if let number = value as? Int { return number }
        if let text = value as? String { return Int(text) }
        return nil
    }
}
