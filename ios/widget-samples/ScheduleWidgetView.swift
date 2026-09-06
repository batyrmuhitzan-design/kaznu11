//  ScheduleWidgetView.swift
//  小组件 UI（小号/中号两种尺寸）。
import SwiftUI
import WidgetKit

struct ScheduleWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ScheduleEntry

    var body: some View {
        switch family {
        case .systemSmall:
            smallBody
        default:
            mediumBody
        }
    }

    private var smallBody: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 4) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(entry.state.tint)
                    .frame(width: 8, height: 8)
                Text(entry.note)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(entry.state.tint)
                Spacer(minLength: 0)
            }
            Spacer(minLength: 0)
            Text(entry.title)
                .font(.system(size: 14, weight: .bold))
                .lineLimit(2)
                .minimumScaleFactor(0.75)
            Text(entry.subtitle)
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(.secondary)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .padding(12)
    }

    private var mediumBody: some View {
        HStack(spacing: 14) {
            // 左侧时间轴
            ZStack {
                Circle()
                    .stroke(entry.state.tint.opacity(0.25), lineWidth: 6)
                Circle()
                    .trim(from: 0, to: 0.35)
                    .stroke(entry.state.tint, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                    .rotationEffect(.degrees(-90))
            }
            .frame(width: 46, height: 46)
            .overlay(Text(todayLabel).font(.system(size: 10, weight: .semibold)).foregroundColor(.secondary))

            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 5) {
                    Circle().fill(entry.state.tint).frame(width: 7, height: 7)
                    Text(entry.note)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(entry.state.tint)
                    Spacer(minLength: 0)
                }
                Text(entry.title)
                    .font(.system(size: 16, weight: .bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Text(entry.subtitle)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
    }

    private var todayLabel: String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US")
        f.dateFormat = "EEE"
        return f.string(from: entry.date).uppercased()
    }
}

struct ScheduleWidgetView_Previews: PreviewProvider {
    static var previews: some View {
        ScheduleWidgetView(entry: .placeholder)
            .previewContext(WidgetPreviewContext(family: .systemMedium))
    }
}
