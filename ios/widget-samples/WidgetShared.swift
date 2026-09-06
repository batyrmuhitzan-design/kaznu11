//  WidgetShared.swift
//  主 App 与 Widget 小组件共享的数据层（两个 Target 都要加入本文件）。
//  课表通过 App Group 的 UserDefaults 传递，避免重复实现。
import Foundation

/// App Group 标识：必须与 iOS 工程里两个 Target（App / KazNUWidget）
/// 的 App Groups Capability 里添加的 group 完全一致。
public let kaznuWidgetAppGroup = "group.com.kaznu.helper.widget"
/// 课表数据的存储 key
public let kaznuScheduleKey = "kaznu.schedule.v1"

/// 单节课。weekday：0=周一 … 6=周日（与 Schedule 页面后端返回的键一致）。
public struct WidgetLesson: Codable, Equatable {
    public var name: String
    public var type: String
    public var room: String
    public var prof: String
    public var weekday: Int
    public var startH: Int
    public var startM: Int
    public var endH: Int
    public var endM: Int

    public init(name: String, type: String = "lecture", room: String = "", prof: String = "",
                weekday: Int, startH: Int, startM: Int, endH: Int, endM: Int) {
        self.name = name
        self.type = type
        self.room = room
        self.prof = prof
        self.weekday = weekday
        self.startH = startH
        self.startM = startM
        self.endH = endH
        self.endM = endM
    }
}

/// 整份课表快照
public struct WidgetSchedule: Codable {
    public var student: String
    public var updatedAt: Date
    public var lessons: [WidgetLesson]

    public init(student: String, updatedAt: Date = Date(), lessons: [WidgetLesson]) {
        self.student = student
        self.updatedAt = updatedAt
        self.lessons = lessons
    }
}

public enum WidgetStore {
    /// 小组件侧读取（Timeline Provider 里调用）
    public static func loadSchedule() -> WidgetSchedule? {
        guard let ud = UserDefaults(suiteName: kaznuWidgetAppGroup),
              let data = ud.data(forKey: kaznuScheduleKey) else { return nil }
        let dec = JSONDecoder()
        dec.dateDecodingStrategy = .iso8601
        return try? dec.decode(WidgetSchedule.self, from: data)
    }

    /// 主 App 侧写入（原生插件里调用）
    @discardableResult
    public static func saveSchedule(_ schedule: WidgetSchedule) -> Bool {
        guard let ud = UserDefaults(suiteName: kaznuWidgetAppGroup) else { return false }
        let enc = JSONEncoder()
        enc.dateEncodingStrategy = .iso8601
        guard let data = try? enc.encode(schedule) else { return false }
        ud.set(data, forKey: kaznuScheduleKey)
        return true
    }
}
