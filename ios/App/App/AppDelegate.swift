import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Capacitor's NotificationRouter must stay the UNUserNotificationCenter
        // delegate — it is what feeds `pushNotificationActionPerformed` to JS.
        // Claiming it here silently swallowed every notification tap.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {}
    func applicationDidEnterBackground(_ application: UIApplication) {}
    func applicationWillEnterForeground(_ application: UIApplication) {}
    func applicationDidBecomeActive(_ application: UIApplication) {}
    func applicationWillTerminate(_ application: UIApplication) {}

    // Passes the APNs token to Capacitor, which forwards it to JS.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(
            name: .capacitorDidRegisterForRemoteNotifications,
            object: deviceToken
        )
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(
            name: .capacitorDidFailToRegisterForRemoteNotifications,
            object: error
        )
    }

    // ── Deep links ───────────────────────────────────────────────────────────
    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    // ── Background uploads (Pulse) ───────────────────────────────────────────
    // Pulse videos upload in a background URLSession, so iOS can relaunch the app to deliver that
    // session's events. PulseKit takes the ones it owns; anything else (or a build without
    // PulseKit) is completed right away, as iOS expects.
    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        if PulseKitBackgroundSessions.forward(identifier, completionHandler: completionHandler) {
            return
        }
        completionHandler()
    }
}

/// Forwards background URLSession events to PulseKit (from `@mieweb/pulse-embed`) when it is in
/// the app. PulseKit is looked up by its Objective-C name at run time, so this file has no
/// compile-time dependency on it and the app builds the same with or without the plugin.
/// Foundation only, so the forwarding can be run outside the app.
enum PulseKitBackgroundSessions {
    /// PulseKit's forwarding method returns BOOL: YES when the session is PulseKit's and PulseKit
    /// will call the handler itself.
    private typealias ForwardIMP = @convention(c) (
        AnyObject, Selector, NSString, @escaping @convention(block) () -> Void
    ) -> ObjCBool

    /// Returns true when PulseKit took the events (and owns calling `completionHandler`); false when
    /// PulseKit is missing, lacks the method, or doesn't own `identifier`, and the caller must call
    /// the handler.
    static func forward(_ identifier: String, completionHandler: @escaping () -> Void) -> Bool {
        guard let pulseKitClass = NSClassFromString("PulseKit") as? NSObject.Type else { return false }
        let sharedSelector = NSSelectorFromString("shared")
        guard pulseKitClass.responds(to: sharedSelector),
              let shared = pulseKitClass.perform(sharedSelector)?.takeUnretainedValue() as? NSObject
        else { return false }
        let selector = NSSelectorFromString("handleEventsForBackgroundURLSession:completionHandler:")
        guard shared.responds(to: selector) else { return false }
        let forwardIMP = unsafeBitCast(shared.method(for: selector), to: ForwardIMP.self)
        let handler: @convention(block) () -> Void = { completionHandler() }
        return forwardIMP(shared, selector, identifier as NSString, handler).boolValue
    }
}
