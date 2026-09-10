import ActivityKit
import SwiftUI
import WidgetKit

// ===================== 调色板（唯一的 Color 来源） =====================

/// 圆环 / 进度条的三档颜色（需求 2.1）：
/// 剩余 > 60% 绿，20% ~ 60% 橙，< 20% 红。
@available(iOS 16.1, *)
enum KaznuActivityPalette {
    /// 剩余充足
    static let safe = Color(red: 0.20, green: 0.78, blue: 0.35)
    /// 剩余过半
    static let warning = Color(red: 1.00, green: 0.58, blue: 0.00)
    /// 剩余紧急
    static let critical = Color(red: 1.00, green: 0.23, blue: 0.19)

    static func color(for tier: KaznuCourseTier) -> Color {
        switch tier {
        case .safe: return safe
        case .warning: return warning
        case .critical: return critical
        }
    }

    static func color(for state: KaznuCourseAttributes.ContentState) -> Color {
        color(for: state.tier)
    }
}

// ===================== 圆环进度控件 =====================

/// 圆环倒计时（Circular Progress Gauge 风格，参考下载进度控件）。
///
/// · 环体：`Circle().trim(from: 0, to: progress)`，从 12 点顺时针绘制，随剩余比例**逐渐减少**；
/// · 颜色：由 `state.tier` 决定绿 / 橙 / 红，同一色相内部再用线性渐变做出光感；
/// · 圆环内数字：剩余 > 10 分钟显示 `29m`（分钟），最后 10 分钟显示 `09:59`
///   并改由系统计时器逐秒自走（`Text(style: .timer)`），无需 App 每秒 update。
@available(iOS 16.1, *)
struct KaznuCountdownRing: View {
    let state: KaznuCourseAttributes.ContentState
    var size: CGFloat = 62
    var lineWidth: CGFloat = 6
    var showsText = true

    var body: some View {
        let accent = KaznuActivityPalette.color(for: state)

        ZStack {
            // 底环
            Circle()
                .stroke(Color.white.opacity(0.16), lineWidth: lineWidth)
            // 随倒计时收缩的进度环
            Circle()
                .trim(from: 0, to: max(0.001, state.progress))
                .stroke(
                    LinearGradient(
                        colors: [accent, accent.opacity(0.55)],
                        startPoint: .top,
                        endPoint: .bottom
                    ),
                    style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
                .shadow(color: accent.opacity(0.45), radius: 3)
                .animation(.linear(duration: 0.6), value: state.progress)

            if showsText {
                ringLabel(accent: accent)
            }
        }
        .frame(width: size, height: size)
    }

    /// 圆环内的剩余时间：`29m`（粗粒度）→ `09:59`（系统逐秒自走）
    @ViewBuilder
    private func ringLabel(accent: Color) -> some View {
        if state.remainingSeconds > KaznuCourseMetric.detailedTextThreshold {
            Text(state.ringText)
                .font(.system(size: size * 0.30, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundColor(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.55)
        } else {
            Text(state.stageEnd, style: .timer)
                .font(.system(size: size * 0.27, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundColor(accent)
                .lineLimit(1)
                .minimumScaleFactor(0.55)
        }
    }
}

/// 灵动岛紧凑区（compactTrailing）的迷你圆环：圆环 + 剩余分钟数字。
@available(iOS 16.1, *)
struct KaznuCompactRing: View {
    let state: KaznuCourseAttributes.ContentState

    var body: some View {
        let accent = KaznuActivityPalette.color(for: state)

        ZStack {
            Circle()
                .stroke(Color.white.opacity(0.20), lineWidth: 2.5)
            Circle()
                .trim(from: 0, to: max(0.001, state.progress))
                .stroke(accent, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                .rotationEffect(.degrees(-90))

            Text(minutesText)
                .font(.system(size: 9, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundColor(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .frame(width: 24, height: 24)
    }

    private var minutesText: String {
        let minutes = Int(ceil(max(0, state.remainingSeconds) / 60))
        if minutes >= 60 { return "\(Int(ceil(Double(minutes) / 60)))h" }
        return "\(minutes)"
    }
}

/// 线性进度条（锁屏卡片 / 灵动岛展开区共用），颜色随档位变化。
@available(iOS 16.1, *)
struct KaznuProgressBar: View {
    let progress: Double

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.white.opacity(0.16))
                Capsule()
                    .fill(KaznuActivityPalette.color(for: KaznuCourseMetric.tier(progress: progress)))
                    .frame(width: proxy.size.width * CGFloat(max(0.001, min(1, progress))))
            }
        }
        .frame(height: 5)
    }
}

// ===================== 锁屏 / 通知横幅大卡片 =====================

/// 左侧课程信息 + 右侧圆环倒计时（参考 Apple Music / 百度网盘下载卡片的深色样式）。
@available(iOS 16.1, *)
struct KaznuCourseLockScreenView: View {
    let context: ActivityViewContext<KaznuCourseAttributes>

    var body: some View {
        let state = context.state
        let attributes = context.attributes
        let accent = KaznuActivityPalette.color(for: state)

        HStack(alignment: .center, spacing: 14) {
            // ---------- 左：课程信息 ----------
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 6) {
                    Image(systemName: "book.closed.fill")
                        .font(.system(size: 10, weight: .bold))
                    Text(state.courseShort.uppercased())
                        .font(.system(size: 10, weight: .heavy, design: .monospaced))
                    Text(state.phase == .preClass ? "UP NEXT" : "IN CLASS")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(accent)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(accent.opacity(0.22)))
                }
                .foregroundColor(.white.opacity(0.85))

                Text(attributes.courseName)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundColor(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)

                HStack(spacing: 10) {
                    if !attributes.roomNumber.isEmpty {
                        Label(attributes.roomNumber, systemImage: "mappin.and.ellipse")
                    }
                    if !attributes.teacherName.isEmpty {
                        Label(attributes.teacherName, systemImage: "person.fill")
                    }
                }
                .font(.system(size: 12))
                .foregroundColor(.white.opacity(0.70))
                .lineLimit(1)

                Text(state.statusLabel)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(accent)

                KaznuProgressBar(progress: state.progress)
                    .padding(.top, 2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            // ---------- 右：圆环倒计时 ----------
            KaznuCountdownRing(state: state, size: 62, lineWidth: 6)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
        .activityBackgroundTint(Color.black)
        .activitySystemActionForegroundColor(Color.white)
    }
}

// ===================== Live Activity 声明 =====================

@available(iOS 16.1, *)
struct KaznuCourseLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: KaznuCourseAttributes.self) { context in
            // 锁屏 / 通知横幅（iPhone XR 等无灵动岛机型同样走这里）
            KaznuCourseLockScreenView(context: context)
        } dynamicIsland: { context in
            let state = context.state
            let accent = KaznuActivityPalette.color(for: state)
            return DynamicIsland {
                // ---------- 展开：左（课程）/ 右（圆环）/ 底（时间 + 进度 + 跳转） ----------
                DynamicIslandExpandedRegion(.leading) {
                    KaznuExpandedLeading(context: context)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    KaznuCountdownRing(state: state, size: 44, lineWidth: 5, showsText: false)
                        .padding(.trailing, 2)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    KaznuExpandedBottom(context: context, accent: accent)
                }
            } compactLeading: {
                // 极简品牌标识：书本图标（颜色随倒计时档位变化）
                Image(systemName: "book.closed.fill")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundColor(accent)
            } compactTrailing: {
                // 迷你圆环进度条 + 剩余分钟数字
                KaznuCompactRing(state: state)
            } minimal: {
                Image(systemName: "book.closed.fill")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(accent)
            }
            .keylineTint(accent)
        }
    }
}

/// 灵动岛展开区（左）：课程缩写 + 课程名
@available(iOS 16.1, *)
private struct KaznuExpandedLeading: View {
    let context: ActivityViewContext<KaznuCourseAttributes>

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Image(systemName: "book.closed.fill")
                    .font(.system(size: 9, weight: .bold))
                Text(context.state.courseShort.uppercased())
                    .font(.system(size: 10, weight: .heavy, design: .monospaced))
            }
            .foregroundColor(.white.opacity(0.75))

            Text(context.attributes.courseName)
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
    }
}

/// 灵动岛展开区（底）：状态文案 + 系统自走时间 + 线性进度 + 跳转按钮
@available(iOS 16.1, *)
private struct KaznuExpandedBottom: View {
    let context: ActivityViewContext<KaznuCourseAttributes>
    let accent: Color

    var body: some View {
        let state = context.state
        let room = context.attributes.roomNumber

        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text(room.isEmpty ? state.statusLabel : "\(room) · \(state.statusLabel)")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.white.opacity(0.75))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Spacer(minLength: 4)
                Text(state.stageEnd, style: .timer)
                    .font(.system(size: 15, weight: .semibold, design: .monospaced))
                    .monospacedDigit()
                    .foregroundColor(accent)
                    .frame(width: 72, alignment: .trailing)
            }

            KaznuProgressBar(progress: state.progress)

            if let urlString = state.navigationURL, let url = URL(string: urlString) {
                Link(destination: url) {
                    Label(state.navigationLabel ?? "Open", systemImage: "arrow.up.right")
                        .font(.system(size: 12, weight: .semibold))
                }
            }
        }
    }
}
