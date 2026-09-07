import Capacitor
import UIKit
import WebKit

/// 自定义 CAPBridgeViewController：
///  - 注入 `window.__KAZNU_LIVE_ACTIVITY_BRIDGE__`（把 Web payload 投递到原生）；
///  - 收到后交给 `TimetableLiveActivityController` 启动 / 刷新 / 结束 Live Activity。
final class KaznuBridgeViewController: CAPBridgeViewController, WKScriptMessageHandler {
    override func viewDidLoad() {
        super.viewDidLoad()
        // 注册本地 Capacitor 插件（官方 Bridge 通道，可靠性远高于手写 WKScriptMessage）
        self.bridge?.registerPluginInstance(KaznuLiveActivityPlugin())
    }

    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let configuration = super.webViewConfiguration(for: instanceConfiguration)

        // 接收 Web → Native 的 Live Activity 消息
        configuration.userContentController.add(self, name: "kaznuLiveActivity")
        // 接收 Web → Native 的课表同步（用于后台任务 / 上课提醒计算）
        configuration.userContentController.add(self, name: "kaznuReminderSync")

        let bridgeSource = """
        (function () {
          if (!window.__KAZNU_LIVE_ACTIVITY_BRIDGE__) {
            window.__KAZNU_LIVE_ACTIVITY_BRIDGE__ = function (payload) {
              try {
                window.webkit.messageHandlers.kaznuLiveActivity.postMessage(payload);
              } catch (err) {
                console.warn('KazNU LiveActivity bridge error', err);
              }
            };
          }
          if (!window.__KAZNU_BG_REMINDER_SYNC__) {
            window.__KAZNU_BG_REMINDER_SYNC__ = function (payload) {
              try {
                window.webkit.messageHandlers.kaznuReminderSync.postMessage(payload);
              } catch (err) {
                console.warn('KazNU background reminder sync error', err);
              }
            };
          }
        })();
        """
        let script = WKUserScript(source: bridgeSource, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        configuration.userContentController.addUserScript(script)
        return configuration
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let payload = message.body as? [String: Any] else { return }
        switch message.name {
        case "kaznuLiveActivity":
            DispatchQueue.main.async { [weak self] in
                guard self != nil else { return }
                if #available(iOS 16.2, *) {
                    TimetableLiveActivityController.handle(payload)
                }
            }
        case "kaznuReminderSync":
            BackgroundReminderScheduler.syncSchedule(payload)
        default:
            break
        }
    }
}
