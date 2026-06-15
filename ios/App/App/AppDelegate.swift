import UIKit
import Capacitor
import UserNotifications

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Set notification delegate so taps are captured before JS bridge is ready
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    // ... rest of your existing code unchanged ...
}

// ── UNUserNotificationCenterDelegate ─────────────────────────────────────────
extension AppDelegate: UNUserNotificationCenterDelegate {

    // Called when app is in FOREGROUND and notification arrives
    // Return .banner + .sound to show the native iOS banner while app is open
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }

    // Called when user TAPS a notification — app in background, foreground, or just launched
    func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
) {
    let userInfo = response.notification.request.content.userInfo
    print("[AppDelegate] notification tapped, userInfo: \(userInfo)")  // ← add this
    
    if let data = try? JSONSerialization.data(withJSONObject: userInfo),
       let json = String(data: data, encoding: .utf8) {
        UserDefaults.standard.set(json, forKey: "pendingPushNotification")
        UserDefaults.standard.synchronize()
        print("[AppDelegate] stored pendingPushNotification: \(json)")  // ← add this
    }

    NotificationCenter.default.post(
        name: Notification.Name("capacitorNotificationResponse"),
        object: response
    )

    completionHandler()
}
}