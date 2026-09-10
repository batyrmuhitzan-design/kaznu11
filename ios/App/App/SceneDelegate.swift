import UIKit
import WebKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = KaznuBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)

        // 3D Touch / 主屏长按图标 → 快捷跳转（冷启动时系统把 shortcutItem 放进 connectionOptions）
        if let shortcutItem = connectionOptions.shortcutItem {
            KaznuQuickActions.dispatch(shortcutItem.type)
        }
    }

    // 已运行 / 从后台恢复时触发主屏快捷操作
    func windowScene(_ windowScene: UIWindowScene,
                     performActionFor shortcutItem: UIApplicationShortcutItem,
                     completionHandler: @escaping (Bool) -> Void) {
        KaznuQuickActions.dispatch(shortcutItem.type)
        completionHandler(true)
    }

    func sceneWillEnterForeground(_ scene: UIScene) {
        // 用户在设置里改动“实时活动/通知”后回到 App：重排 BGTask 并立刻补一次 Activity 同步
        BackgroundReminderScheduler.scheduleNextIfNeeded()
        BackgroundReminderScheduler.syncCourseLiveActivityIfNeeded()
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

/// 主屏 3D Touch / 长按图标快捷操作 → WKWebView 事件桥。
///
/// 原生侧把快捷操作 type 通过 `kaznu:shortcut` CustomEvent 注入 WebView，
/// React 入口（src/native/quickActions.ts + App.tsx）收到后做路由跳转。
/// Web 侧处理完成会写 `window.__kaznuShortcutAck`，这里轮询确认，避免冷启动丢事件。
enum KaznuQuickActions {
    private static var lastType: String?

    static func dispatch(_ type: String, attempts: Int = 24) {
        guard attempts > 0, type != lastType else { return }
        guard let webView = KaznuQuickActions.webView(), !webView.isLoading else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                KaznuQuickActions.dispatch(type, attempts: attempts - 1)
            }
            return
        }
        lastType = type
        let js = """
        (function () {
          if (window.__kaznuShortcutAck === '\(type)') return;
          window.dispatchEvent(new CustomEvent('kaznu:shortcut', { detail: { type: '\(type)' } }));
        })();
        """
        webView.evaluateJavaScript(js) { _, error in
            if error != nil {
                KaznuQuickActions.lastType = nil
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                    KaznuQuickActions.dispatch(type, attempts: attempts - 1)
                }
                return
            }
            // Web 侧处理完会写 __kaznuShortcutAck；没收到就补发一次。
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                KaznuQuickActions.confirm(type, attempts: attempts - 1)
            }
        }
    }

    private static func confirm(_ type: String, attempts: Int) {
        guard attempts > 0, let webView = KaznuQuickActions.webView() else { return }
        let check = "window.__kaznuShortcutAck === '\(type)' ? '1' : '0'"
        webView.evaluateJavaScript(check) { result, _ in
            if (result as? String) != "1" {
                KaznuQuickActions.lastType = nil
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                    KaznuQuickActions.dispatch(type, attempts: attempts)
                }
            }
        }
    }

    private static func webView() -> WKWebView? {
        for scene in UIApplication.shared.connectedScenes {
            guard let windowScene = scene as? UIWindowScene else { continue }
            for window in windowScene.windows {
                if let bridge = window.rootViewController as? CAPBridgeViewController,
                   let webView = bridge.webView {
                    return webView
                }
            }
        }
        return nil
    }
}

