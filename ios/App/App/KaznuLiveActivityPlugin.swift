import ActivityKit
import Capacitor
import Foundation

/// 官方 Capacitor 插件通道（与 LocalNotifications 同一套 native bridge）：
/// Web 端通过 `Capacitor.Plugins.KaznuLiveActivity.start(payload)` 直接调用，
/// 不再依赖自定义 WKScriptMessage，从根上消除“消息没送达”的问题。
@objc(KaznuLiveActivityPlugin)
public class KaznuLiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "KaznuLiveActivityPlugin"
    public let jsName = "KaznuLiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
    ]

    private func handle(_ payload: [String: Any], _ call: CAPPluginCall) {
        DispatchQueue.main.async {
            var authorized = false
            var ok = false
            var message = "no-request"
            if #available(iOS 16.2, *) {
                authorized = ActivityAuthorizationInfo().areActivitiesEnabled
                TimetableLiveActivityController.handle(payload)
                ok = TimetableLiveActivityController.lastRequestSucceeded
                message = TimetableLiveActivityController.lastRequestMessage
            } else {
                message = "Live Activities require iOS 16.2 or newer"
            }
            call.resolve([
                "ok": ok,
                "authorized": authorized,
                "message": message,
            ])
        }
    }

    @objc public func start(_ call: CAPPluginCall) {
        guard let payload = call.options as? [String: Any] else {
            call.reject("payload missing")
            return
        }
        handle(payload, call)
    }

    @objc public func update(_ call: CAPPluginCall) {
        guard let payload = call.options as? [String: Any] else {
            call.reject("payload missing")
            return
        }
        handle(payload, call)
    }

    @objc public func end(_ call: CAPPluginCall) {
        guard let payload = call.options as? [String: Any] else {
            call.reject("payload missing")
            return
        }
        handle(payload, call)
    }
}
