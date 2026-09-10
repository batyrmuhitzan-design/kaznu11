import Foundation
import SwiftUI
import WidgetKit

// 课程实时活动（锁屏大卡片 / 灵动岛）见同 Target 的 KaznuCourseLiveActivity.swift；
// 本文件只保留桌面小组件与 @main WidgetBundle 入口。

// ===================== 桌面小组件（Small / Medium） =====================

@available(iOS 16.1, *)
private struct OverviewLesson: Decodable, Identifiable {
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

@available(iOS 16.1, *)
private struct OverviewEntry: TimelineEntry {
    let date: Date
    let kind: String // "now" | "next" | "none"
    let title: String
    let subtitle: String
    let badge: String
    let progress: Double

    static let empty = OverviewEntry(date: Date(), kind: "none", title: "KazNU Helper", subtitle: "打开 App 同步课表", badge: "—", progress: 0)
}

@available(iOS 16.1, *)
private struct OverviewProvider: TimelineProvider {
    func placeholder(in context: Context) -> OverviewEntry { .empty }
    func getSnapshot(in context: Context, completion: @escaping (OverviewEntry) -> Void) { completion(.empty) }

    func getTimeline(in context: Context, completion: @escaping (Timeline<OverviewEntry>) -> Void) {
        let now = Date()
        let calendar = Calendar.current
        let entries = (0..<48).map { minutes in
            OverviewProvider.entry(at: calendar.date(byAdding: .minute, value: minutes * 5, to: now) ?? now)
        }
        completion(Timeline(entries: entries, policy: .atEnd))
    }

    private static func entry(at date: Date) -> OverviewEntry {
        let calendar = Calendar.current
        let today = (calendar.component(.weekday, from: date) + 5) % 7
        let minutesNow = calendar.component(.hour, from: date) * 60 + calendar.component(.minute, from: date)
        let lessons = OverviewProvider.loadLessons().filter { $0.weekday == today }

        var current: OverviewLesson?
        var next: OverviewLesson?
        for lesson in lessons {
            let start = lesson.startH * 60 + lesson.startM
            let end = lesson.endH * 60 + lesson.endM
            if minutesNow >= start && minutesNow < end {
                if current == nil { current = lesson }
            } else if minutesNow < start {
                if next == nil || start < next!.startH * 60 + next!.startM { next = lesson }
            }
        }

        func timeText(_ h: Int, _ m: Int) -> String { String(format: "%02d:%02d", h, m) }
        if let current {
            let start = current.startH * 60 + current.startM
            let end = current.endH * 60 + current.endM
            let progress = end > start ? min(1, max(0, Double(minutesNow - start) / Double(end - start))) : 0
            return OverviewEntry(
                date: date,
                kind: "now",
                title: current.name,
                subtitle: "\(current.room ?? "") · \(current.prof ?? "")".trimmingCharacters(in: .whitespaces),
                badge: "上课中 · \(timeText(current.endH, current.endM)) 下课",
                progress: 1 - progress
            )
        }
        if let next {
            let remaining = (next.startH * 60 + next.startM) - minutesNow
            return OverviewEntry(
                date: date,
                kind: "next",
                title: next.name,
                subtitle: "\(next.room ?? "") · \(timeText(next.startH, next.startM))".trimmingCharacters(in: .whitespaces),
                badge: remaining > 0 ? "还有 \(remaining) 分钟" : "即将开始",
                progress: 0
            )
        }
        return .empty
    }

    private static func loadLessons() -> [OverviewLesson] {
        guard let suite = UserDefaults(suiteName: "group.com.kaznu.helper"),
              let data = suite.data(forKey: "kaznu.schedule.v1") else { return [] }
        return (try? JSONDecoder().decode([OverviewLesson].self, from: data)) ?? []
    }
}

@available(iOS 16.1, *)
private struct OverviewWidgetView: View {
    let entry: OverviewEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 4) {
                Image(systemName: entry.kind == "now" ? "book.closed.fill" : entry.kind == "next" ? "clock.fill" : "graduationcap.fill")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.white.opacity(0.7))
                Text("KazNU Helper")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(.white.opacity(0.65))
            }
            Text(entry.title)
                .font(.system(size: 15, weight: .bold))
                .foregroundColor(.white)
                .lineLimit(2)
                .minimumScaleFactor(0.75)
            Text(entry.subtitle)
                .font(.system(size: 11))
                .foregroundColor(.white.opacity(0.7))
                .lineLimit(1)
            Spacer(minLength: 2)
            if entry.kind == "now", entry.progress > 0 {
                ProgressView(value: entry.progress)
                    .tint(entry.progress > 0.5 ? Color(red: 0.20, green: 0.78, blue: 0.35) : entry.progress > 0.2 ? Color(red: 1.0, green: 0.58, blue: 0.0) : Color.red)
            }
            Text(entry.badge)
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .foregroundColor(.white.opacity(0.8))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(12)
        .background(Color.black)
    }
}

@available(iOS 16.1, *)
struct KazNUOverviewWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "KazNUOverviewWidget", provider: OverviewProvider()) { entry in
            OverviewWidgetView(entry: entry)
        }
        .configurationDisplayName("KazNU Helper")
        .description("当前课程、教室与倒计时")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
@available(iOS 16.1, *)
struct KazNUWidgetBundle: WidgetBundle {
    var body: some Widget {
        // 课程实时活动（锁屏大卡片 + 灵动岛）
        KaznuCourseLiveActivity()
        // 桌面小组件（Small / Medium）
        KazNUOverviewWidget()
    }
}
