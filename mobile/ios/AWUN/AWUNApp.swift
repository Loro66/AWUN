import SwiftUI
import WebKit

@main
struct AWUNApp: App {
    var body: some Scene {
        WindowGroup {
            AWUNWebView()
                .background(Color(red: 16 / 255, green: 17 / 255, blue: 14 / 255))
                .ignoresSafeArea(edges: .bottom)
        }
    }
}

struct AWUNWebView: UIViewRepresentable {
    private let url = URL(string: "https://awun-api1.onrender.com")!

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []

        let view = WKWebView(frame: .zero, configuration: configuration)
        view.backgroundColor = UIColor(red: 16 / 255, green: 17 / 255, blue: 14 / 255, alpha: 1)
        view.isOpaque = false
        view.allowsBackForwardNavigationGestures = true
        view.customUserAgent = "AWUN-iOS/1.3"
        view.navigationDelegate = context.coordinator

        let refresh = UIRefreshControl()
        refresh.tintColor = UIColor(red: 183 / 255, green: 255 / 255, blue: 25 / 255, alpha: 1)
        refresh.addTarget(context.coordinator, action: #selector(Coordinator.reload(_:)), for: .valueChanged)
        view.scrollView.refreshControl = refresh
        context.coordinator.webView = view
        view.load(URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData))
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        weak var webView: WKWebView?

        @objc func reload(_ control: UIRefreshControl) {
            webView?.reload()
            control.endRefreshing()
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            if navigationAction.targetFrame == nil, let externalURL = navigationAction.request.url {
                UIApplication.shared.open(externalURL)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }
    }
}
