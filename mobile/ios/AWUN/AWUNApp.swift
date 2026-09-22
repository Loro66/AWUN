import SwiftUI
import WebKit

@main
struct AWUNApp: App {
    var body: some Scene {
        WindowGroup {
            AWUNRootView()
                .background(Color(red: 9 / 255, green: 18 / 255, blue: 12 / 255))
                .ignoresSafeArea(edges: .bottom)
        }
    }
}

struct AWUNRootView: View {
    @State private var loaded = false

    var body: some View {
        ZStack {
            AWUNWebView(loaded: $loaded)
            if !loaded {
                Color.black.ignoresSafeArea()
                Image("AWUNBrand")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 156, height: 156)
            }
        }
    }
}

struct AWUNWebView: UIViewRepresentable {
    @Binding var loaded: Bool

    private var endpoints: [URL] {
        let primary = Bundle.main.object(forInfoDictionaryKey: "AWUNPrimaryURL") as? String ?? "https://awun-1.onrender.com"
        let mirror = Bundle.main.object(forInfoDictionaryKey: "AWUNMirrorURL") as? String ?? ""
        return [primary, mirror].compactMap { candidate in
            guard !candidate.isEmpty,
                  let url = URL(string: candidate),
                  url.scheme?.lowercased() == "https",
                  url.host != nil else { return nil }
            return url
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []

        let view = WKWebView(frame: .zero, configuration: configuration)
        view.backgroundColor = UIColor(red: 9 / 255, green: 18 / 255, blue: 12 / 255, alpha: 1)
        view.isOpaque = false
        view.allowsBackForwardNavigationGestures = true
        view.customUserAgent = "SONGVALE-iOS/2.0"
        view.navigationDelegate = context.coordinator
        context.coordinator.loaded = $loaded
        context.coordinator.endpoints = endpoints

        let refresh = UIRefreshControl()
        refresh.tintColor = UIColor(red: 255 / 255, green: 107 / 255, blue: 26 / 255, alpha: 1)
        refresh.addTarget(context.coordinator, action: #selector(Coordinator.reload(_:)), for: .valueChanged)
        view.scrollView.refreshControl = refresh
        context.coordinator.webView = view
        if let first = endpoints.first {
            view.load(URLRequest(url: first, cachePolicy: .reloadRevalidatingCacheData))
        }
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        weak var webView: WKWebView?
        var loaded: Binding<Bool>?
        var endpoints: [URL] = []
        var endpointIndex = 0

        @objc func reload(_ control: UIRefreshControl) {
            webView?.reload()
            control.endRefreshing()
        }

        private func effectivePort(_ url: URL) -> Int? {
            url.port ?? (url.scheme?.lowercased() == "https" ? 443 : nil)
        }

        private func isTrusted(_ url: URL) -> Bool {
            guard url.scheme?.lowercased() == "https", let host = url.host else { return false }
            return endpoints.contains { endpoint in
                endpoint.scheme?.lowercased() == "https"
                    && endpoint.host?.caseInsensitiveCompare(host) == .orderedSame
                    && effectivePort(endpoint) == effectivePort(url)
            }
        }

        private func openExternal(_ url: URL) {
            guard let scheme = url.scheme?.lowercased(), ["https", "mailto"].contains(scheme) else { return }
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let destination = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }
            if navigationAction.targetFrame?.isMainFrame == false {
                decisionHandler(.allow)
                return
            }
            if navigationAction.targetFrame == nil {
                if isTrusted(destination) {
                    webView.load(navigationAction.request)
                } else {
                    openExternal(destination)
                }
                decisionHandler(.cancel)
                return
            }
            if isTrusted(destination) {
                decisionHandler(.allow)
            } else {
                openExternal(destination)
                decisionHandler(.cancel)
            }
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationResponse: WKNavigationResponse,
            decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
        ) {
            if let response = navigationResponse.response as? HTTPURLResponse,
               response.statusCode >= 400,
               endpointIndex + 1 < endpoints.count {
                endpointIndex += 1
                webView.load(URLRequest(url: endpoints[endpointIndex], cachePolicy: .reloadRevalidatingCacheData))
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            loaded?.wrappedValue = true
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            guard endpointIndex + 1 < endpoints.count else { return }
            endpointIndex += 1
            webView.load(URLRequest(url: endpoints[endpointIndex], cachePolicy: .reloadRevalidatingCacheData))
        }
    }
}
