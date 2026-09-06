//  KaznuWidgetPlugin.swift
//  Capacitor 本地插件：把 JS 传来的课表写入 App Group，并刷新 WidgetKit 时间轴。
//
//  需要放进一个“可被 cap sync 发现的插件包”里（见 WIDGET_GUIDE.md 第 2 节）：
//    plugins/kaznu-widget/ios/Sources/KaznuWidgetPlugin/KaznuWidgetPlugin.swift
//  这样 cap sync 会自动把它注册进 capacitor.config.json 的 packageClassList，
//  JS 侧 registerPlugin('KaznuWidget') 就能调用到下面的 syncSchedule。
import Capacitor
import Foundation
import WidgetKit

@objc(KaznuWidgetPlugin)
public class KaznuWidgetPlugin: CAPPlugin {

    private let appGroup = "group.com.kaznu.helper.widget"
    private let storageKey = "kaznu.schedule.v1"

    /// 入参示例（由 JS 侧传入）：
    /// {
    ///   "schedule": {
    ///     "student": "20260001",
    ///     "updatedAt": "2026-09-07T09:00:00Z",
    ///     "lessons": [
    ///       { "name": "Linear Algebra", "type": "lecture", "room": "204",
    ///         "prof": "Akhmetov N.T.", "weekday": 0,
    ///         "startH": 9, "startM": 0, "endH": 10, "endM": 30 }
    ///     ]
    ///   }
    /// }
    @objc func syncSchedule(_ call: CAPPluginCall) {
        guard let schedule = call.getObject("schedule"),
              let data = try? JSONSerialization.data(withJSONObject: schedule) else {
            call.reject("schedule payload missing or invalid")
            return
        }

        guard let defaults = UserDefaults(suiteName: appGroup) else {
            call.reject("App Group unavailable: \(appGroup)")
            return
        }

        defaults.set(data, forKey: storageKey)

        // 通知 WidgetKit 刷新所有小组件时间轴
        if #available(iOS 14.0, *) {
            WidgetCenter.shared.reloadAllTimelines()
        }
        call.resolve(["ok": true])
    }
}
