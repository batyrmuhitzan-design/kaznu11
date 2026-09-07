import ActivityKit
import SwiftUI
import WidgetKit

// ===================== 公共样式 =====================

@available(iOS 16.1, *)
enum TimetableActivityStyle {
    /// 0~1 剩余比例：>0.5 全绿；>0.25 橙色；其余红色（与 Web 端 phaseOf 一致）
    static func fraction(total: Double, remaining: Double) -> Double {
        guard total > 0 else { return 0 }
        return max(0, min(1, remaining / total))
    }

    static func phaseColor(total: Double, remaining: Double) -> Color {
        let fraction = self.fraction(total: total, remaining: remaining)
        if fraction > 0.5 { return Color(red: 0.30, green: 0.85, blue: 0.39) } // #4DD963 绿
        if fraction > 0.25 { return Color(red: 1.0, green: 0.62, blue: 0.04) } // #FF9E0A 橙
        return Color(red: 1.0, green: 0.23, blue: 0.19) // #FF3B30 红
    }

    /// 1800 → "30:00"，599 → "09:59"
    static func countdownText(seconds: Double) -> String {
        let total = Int(max(0, seconds.rounded()))
        let minutes = total / 60
        let secs = total % 60
        return String(format: "%02d:%02d", minutes, secs)
    }
}

// ===================== 倒计时圆环（锁屏 / 灵动岛通用） =====================

@available(iOS 16.1, *)
struct CountdownRingView: View {
    let total: Double
    let remaining: Double
    var size: CGFloat = 54
    var lineWidth: CGFloat = 5
    var showDigits = true

    var body: some View {
        let fraction = TimetableActivityStyle.fraction(total: total, remaining: remaining)
        let color = TimetableActivityStyle.phaseColor(total: total, remaining: remaining)

        ZStack {
            // 底环
            Circle()
                .stroke(Color.white.opacity(0.14), lineWidth: lineWidth)
            // 动态消耗的进度环：全绿 → 橙 → 红
            Circle()
                .trim(from: 0, to: max(0.0001, fraction))
                .stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(.linear(duration: 0.4), value: fraction)

            if showDigits {
                Text(TimetableActivityStyle.countdownText(seconds: remaining))
                    .font(.system(size: size * 0.24, weight: .semibold, design: .monospaced))
                    .monospacedDigit()
                    .foregroundColor(.white)
                    .minimumScaleFactor(0.6)
            }
        }
        .frame(width: size, height: size)
    }
}

// ===================== 锁屏 / 通知横幅（非灵动岛机型） =====================

/// Apple Music / 汽水音乐 风格的深色卡片：左信息 + 右侧倒计时圆环。
@available(iOS 16.1, *)
struct TimetableLiveActivityLockView: View {
    let context: ActivityViewContext<TimetableLiveActivityAttributes>

    var body: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 5) {
                    Image(systemName: "book.closed.fill")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(.white.opacity(0.75))
                    Text(context.state.courseShort.uppercased())
                        .font(.system(size: 10, weight: .heavy, design: .monospaced))
                        .foregroundColor(.white.opacity(0.9))
                }

                Text(context.state.courseName)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)

                Text("\(context.state.room) · \(context.state.professor)")
                    .font(.system(size: 12))
                    .foregroundColor(.white.opacity(0.65))
                    .lineLimit(1)

                Text(context.state.statusLabel)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(
                        TimetableActivityStyle.phaseColor(
                            total: context.state.totalSeconds,
                            remaining: context.state.remainingSeconds
                        )
                    )
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            CountdownRingView(
                total: context.state.totalSeconds,
                remaining: context.state.remainingSeconds,
                size: 56,
                lineWidth: 6,
                showDigits: true
            )
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
        // 黑色深色卡片（灵动岛机型之外的锁屏/横幅）
        .activityBackgroundTint(Color.black)
        .activitySystemActionForegroundColor(Color.white)
    }
}
