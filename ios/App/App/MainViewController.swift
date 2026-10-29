import Capacitor

class MainViewController: CAPBridgeViewController {
    // Edge-swipe back fires `popstate`, which the client router already handles.
    override func capacitorDidLoad() {
        webView?.allowsBackForwardNavigationGestures = true
    }
}
