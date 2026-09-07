import ActivityKit
import SwiftUI
import WidgetKit

// ===================== Live Activity Widget 声明 =====================

@available(iOS 16.1, *)
struct KazNUHelperLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TimetableLiveActivityAttributes.self) { context in
            // 锁屏 / 通知横幅（iPhone XR 等非灵动岛机型）
            TimetableLiveActivityLockView(context: context)
        } dynamicIsland: { context in
            DynamicIsland {
                // ---------- 展开视图（长按灵动岛） ----------
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 4) {
                            Image(systemName: "bell.badge.fill")
                                .font(.system(size: 9, weight: .bold))
                            Text(context.state.courseShort.uppercased())
                                .font(.system(size: 10, weight: .heavy, design: .monospaced))
                        }
                        Text(context.state.courseName)
                            .font(.system(size: 15, weight: .semibold))
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                }

                DynamicIslandExpandedRegion(.center) {
                    Text("\(context.state.room) · \(context.state.professor)")
                        .font(.system(size: 12))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }

                DynamicIslandExpandedRegion(.trailing) {
                    CountdownRingView(
                        total: context.state.totalSeconds,
                        remaining: context.state.remainingSeconds,
                        size: 40,
                        lineWidth: 4,
                        showDigits: false
                    )
                }

                DynamicIslandExpandedRegion(.bottom) {
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(context.state.statusLabel)
                                .font(.system(size: 11, weight: .medium))
                                .foregroundColor(.white.opacity(0.75))
                            Text(TimetableActivityStyle.countdownText(seconds: context.state.remainingSeconds))
                                .font(.system(size: 18, weight: .semibold, design: .monospaced))
                                .monospacedDigit()
                                .foregroundColor(
                                    TimetableActivityStyle.phaseColor(
                                        total: context.state.totalSeconds,
                                        remaining: context.state.remainingSeconds
                                    )
                                )
                        }
                        Spacer()
                        if let urlString = context.state.navigationURL,
                           let url = URL(string: urlString) {
                            Link(destination: url) {
                                Label(context.state.navigationLabel ?? "Open", systemImage: "arrow.up.right")
                                    .font(.system(size: 12, weight: .semibold))
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 7)
                                    .background(Color.white.opacity(0.18))
                                    .clipShape(Capsule())
                            }
                        }
                    }
                }
            } compactLeading: {
                // 紧凑视图左侧：📚 课程缩写
                HStack(spacing: 4) {
                    Image(systemName: "book.closed.fill")
                        .font(.system(size: 11, weight: .bold))
                    Text(context.state.courseShort.uppercased())
                        .font(.system(size: 12, weight: .heavy, design: .monospaced))
                        .lineLimit(1)
                }
            } compactTrailing: {
                // 紧凑视图右侧：圆环倒计时
                CountdownRingView(
                    total: context.state.totalSeconds,
                    remaining: context.state.remainingSeconds,
                    size: 26,
                    lineWidth: 3,
                    showDigits: false
                )
            } minimal: {
                // 灵动岛最紧凑状态
                Image(systemName: "timer")
                    .font(.system(size: 13, weight: .bold))
            }
        }
    }
}

@main
@available(iOS 16.1, *)
struct KazNUHelperWidgetBundle: WidgetBundle {
    var body: some Widget {
        KazNUHelperLiveActivityWidget()
    }
}
