import Capacitor
import Foundation

/// 官方 Capacitor 插件通道（与 LocalNotifications 同一套 native bridge）：
/// Web 端通过 `Capacitor.Plugins.KaznuLiveActivity.start(payload)` 直接调用，
/// 不再依赖自定义 WKScriptMessage，从根上消除“消息没送达”的问题。
/// 具体实现委托给 `KaznuActivityManager`（单例，App Target）。
@objc(KaznuLiveActivityPlugin)
public class KaznuLiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "KaznuLiveActivityPlugin"
    public let jsName = "KaznuLiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPushTokens", returnType: CAPPluginReturnPromise),
    ]

    /// 原生拿到新 token（device / push-to-start / activity）→ 通知 Web 层立刻上报后端。
    /// Swift 只负责采集，上报带鉴权、由 Web 层做（见 src/services/LiveActivityPushService.ts）。
    public override func load() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handlePushTokensChanged),
            name: .kaznuPushTokensChanged,
            object: nil
        )
    }

    @objc private func handlePushTokensChanged() {
        notifyListeners("pushTokensChanged", data: [:])
    }

    /// Web 侧读取推送 token 快照（device / push-to-start / 各 Activity 的 push token）。
    ///
    /// 为什么由 JS 上报而不是原生直接传：App 的登录态在 Web 层（localStorage 里的
    /// Bearer token），原生端不保存凭据更安全。JS 拿到快照后带鉴权 POST 给后端，
    /// 见 `src/services/LiveActivityPushService.ts`。
    @objc public func getPushTokens(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if #available(iOS 16.2, *) {
                call.resolve(KaznuActivityManager.shared.pushTokensSnapshot())
            } else {
                call.resolve([
                    "deviceId": "",
                    "deviceToken": "",
                    "pushToStartToken": "",
                    "activities": [String: String](),
                    "timeZone": TimeZone.current.identifier,
                ])
            }
        }
    }

    private func handle(_ payload: [String: Any], _ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if #available(iOS 16.2, *) {
                let manager = KaznuActivityManager.shared
                let authorized = manager.isSupported
                _ = manager.handle(payload)
                call.resolve([
                    "ok": manager.lastSucceeded,
                    "authorized": authorized,
                    "message": manager.lastMessage,
                ])
            } else {
                call.resolve([
                    "ok": false,
                    "authorized": false,
                    "message": "Live Activities require iOS 16.2 or newer",
                ])
            }
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
