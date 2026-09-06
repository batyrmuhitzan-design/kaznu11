//  ScheduleWidget.swift
//  iOS 桌面小组件：显示「正在上 / 下一节」课，如 “Linear Algebra 09:00”。
import WidgetKit
import SwiftUI

// MARK: - 时间轴条目

struct ScheduleEntry: TimelineEntry {
    let date: Date
    let title: String      // 例：Linear Algebra
    let subtitle: String   // 例：09:00 – 10:30 · 204
    let note: String       // 例：下一节 / 正在上课 / 今天没课
    let state: ScheduleState
}

enum ScheduleState {
    case live, next, done, none

    var tint: Color {
        switch self {
        case .live: return Color(red: 0.19, green: 0.82, blue: 0.35) // #30D158
        case .next: return Color(red: 1.0, green: 0.62, blue: 0.04)  // #FF9F0A
        case .done, .none: return Color(red: 0.24, green: 0.46, blue: 0.85) // #007AFF
        }
    }
}

extension ScheduleEntry {
    static var placeholder: ScheduleEntry {
        ScheduleEntry(date: Date(),
                      title: "Linear Algebra",
                      subtitle: "09:00 – 10:30 · 204",
                      note: "下一节",
                      state: .next)
    }
}

private func hhmm(_ h: Int, _ m: Int) -> String {
    String(format: "%02d:%02d", h, m)
}

// MARK: - Timeline Provider

struct ScheduleProvider: TimelineProvider {
    func placeholder(in context: Context) -> ScheduleEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (ScheduleEntry) -> Void) {
        completion(.placeholder)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ScheduleEntry>) -> Void) {
        let now = Date()
        let entry = Self.currentEntry(for: now)
        // 每 15 分钟刷新一次即可；如需分钟级精确，可改为按下一节课的开始时刻刷新。
        let next = Calendar.current.date(byAdding: .minute, value: 15, to: now) ?? now.addingTimeInterval(900)
        completion(Timeline(entries: [entry], policy: .after(next)))
    }

    /// 根据“今天 + 当前时刻”算出要展示的课程
    static func currentEntry(for now: Date) -> ScheduleEntry {
        let cal = Calendar.current
        let comps = cal.dateComponents([.hour, .minute, .weekday], from: now)
        // Calendar.weekday：1=周日 … 7=周六 → 项目约定 0=周一 … 6=周日
        let weekday = ((comps.weekday ?? 1) + 5) % 7
        let nowMin = (comps.hour ?? 0) * 60 + (comps.minute ?? 0)

        let lessons = WidgetStore.loadSchedule()?.lessons ?? []
        let today = lessons
            .filter { $0.weekday == weekday }
            .sorted { lhs, rhs in (lhs.startH, lhs.startM) < (rhs.startH, rhs.startM) }

        // 1) 正在上课
        if let cur = today.first(where: { l in
            let s = l.startH * 60 + l.startM
            let e = l.endH * 60 + l.endM
            return nowMin >= s && nowMin < e
        }) {
            return ScheduleEntry(date: now,
                                 title: cur.name,
                                 subtitle: "\(hhmm(cur.startH, cur.startM)) – \(hhmm(cur.endH, cur.endM)) · \(cur.room)",
                                 note: "正在上课",
                                 state: .live)
        }
        // 2) 下一节
        if let nx = today.first(where: { l in l.startH * 60 + l.startM > nowMin }) {
            let start = nx.startH * 60 + nx.startM
            let remainMin = start - nowMin
            return ScheduleEntry(date: now,
                                 title: nx.name,
                                 subtitle: "\(hhmm(nx.startH, nx.startM)) · \(nx.room)",
                                 note: "\(remainMin) 分钟后",
                                 state: .next)
        }
        // 3) 今天没有数据
        if today.isEmpty {
            return ScheduleEntry(date: now, title: "今天没课", subtitle: "暂无课表数据", note: "打开 App 同步", state: .none)
        }
        // 4) 今天的课已结束
        return ScheduleEntry(date: now, title: "今天的课结束了", subtitle: "好好休息 🎉", note: "已完成", state: .done)
    }
}

// MARK: - Widget

struct ScheduleWidget: Widget {
    let kind = "ScheduleWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ScheduleProvider()) { entry in
            ScheduleWidgetView(entry: entry)
        }
        .configurationDisplayName("近期课表")
        .description("显示今天正在上或即将开始的课。")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
