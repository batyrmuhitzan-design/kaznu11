import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // 注册后台任务：下一节课开始前 32 分钟唤醒 App 拉起 Live Activity
        BackgroundReminderScheduler.register()
        // 启动时先补一次 BGTask 调度，并让 KaznuActivityManager 按课表判定当前该显示什么
        //（课前 30 分钟 / 正在上课 → 拉起倒计时；无课或距下节课很远 → 自动收起）
        BackgroundReminderScheduler.scheduleNextIfNeeded()
        BackgroundReminderScheduler.syncCourseLiveActivityIfNeeded()
        // 远程推送：注册设备并开始监听 push-to-start token
        //（iOS 17.2+ 才有的"App 没打开也能被服务器拉起 Live Activity"能力）
        if #available(iOS 16.2, *) {
            KaznuActivityManager.shared.registerForRemoteNotifications()
        }
        // Override point for customization after application launch.
        return true
    }

    // MARK: - 远程推送回调（Live Activity 走 APNs 时必需）

    /// 系统下发 device token。注意 push-to-start token 是另一条通道
    /// （Activity.pushToStartTokenUpdates，见 KaznuActivityManager.startPushToStartObservation），
    /// 两者都要上报后端，但用途不同。
    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        if #available(iOS 16.2, *) {
            KaznuActivityManager.shared.handleDeviceToken(deviceToken)
        }
    }

    /// 注册失败：最常见原因是 **缺少 aps-environment entitlement**
    ///（免费 Apple ID 无法开启 Push Notifications，需付费账号，见 ios/PUSH_LIVE_ACTIVITY_SETUP.md）。
    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        if #available(iOS 16.2, *) {
            KaznuActivityManager.shared.handleRemoteNotificationFailure(error)
        }
        print("[kaznu] ⚠️ registerForRemoteNotifications 失败：\(error.localizedDescription)")
    }

    // 兜底：某些系统路径会把主屏快捷操作直接派发给 AppDelegate（场景路径走 SceneDelegate）。
    func application(_ application: UIApplication,
                     performActionFor shortcutItem: UIApplicationShortcutItem,
                     completionHandler: @escaping (Bool) -> Void) {
        KaznuQuickActions.dispatch(shortcutItem.type)
        completionHandler(true)
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // 回到前台时确保 BGTask 队列里有“下一节课 -32min”的后台唤醒点
        BackgroundReminderScheduler.scheduleNextIfNeeded()
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}
