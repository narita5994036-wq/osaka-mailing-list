import SwiftUI
import UIKit
import WebKit

/// Wraps the existing web registration form + admin panel (bundled as a
/// local resource, not fetched from a server) in a WKWebView. The page's
/// own JS still talks to the Google Apps Script backend over HTTPS via
/// fetch() for everything data-related — this view only needs to handle
/// the things a browser's chrome would normally handle for the page:
/// opening tel:/sms:/mailto: links, opening http(s) links the page marks
/// as "open externally" (target="_blank", window.open), and file
/// downloads (the admin panel's CSV export).
struct WebView: UIViewRepresentable {
    /// This store's Apps Script Web App URL, or nil to use index.html's own
    /// default. Injected as window.MYKITA_STORE_WEBHOOK_URL before the
    /// page's script runs — see index.html's SHEET_WEBHOOK_URL line.
    let webhookURL: String?

    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = false
        if #available(iOS 16.4, *) {
            webView.isInspectable = true // Safari > Develop menu, for debugging on-device; harmless for internal-only builds.
        }
        context.coordinator.load(webhookURL: webhookURL, into: webView)
        return webView
    }

    /// Re-injects and reloads only when the store actually changed (e.g.
    /// after StorePickerView reassigns this device) — not on every SwiftUI
    /// body re-evaluation, which would otherwise wipe in-progress form
    /// input on unrelated view updates.
    func updateUIView(_ webView: WKWebView, context: Context) {
        guard context.coordinator.loadedWebhookURL != webhookURL else { return }
        context.coordinator.load(webhookURL: webhookURL, into: webView)
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        /// Destination file for an in-progress WKDownload, keyed by the
        /// download object's identity — set in decideDestination, read
        /// back in downloadDidFinish to present the share sheet.
        private var downloadDestinations: [ObjectIdentifier: URL] = [:]

        /// The webhookURL last passed to load(webhookURL:into:), so
        /// updateUIView can tell a real store change from an unrelated
        /// SwiftUI body re-evaluation.
        private(set) var loadedWebhookURL: String?

        func load(webhookURL: String?, into webView: WKWebView) {
            loadedWebhookURL = webhookURL

            let controller = webView.configuration.userContentController
            controller.removeAllUserScripts()
            if let webhookURL {
                // JSONSerialization gives a safely-quoted/escaped JS string
                // literal regardless of what's in the URL.
                let encoded = (try? JSONSerialization.data(withJSONObject: [webhookURL]))
                    .flatMap { String(data: $0, encoding: .utf8) }
                    .map { String($0.dropFirst().dropLast()) } // unwrap the [ ] the array added
                    ?? "null"
                let source = "window.MYKITA_STORE_WEBHOOK_URL = \(encoded);"
                controller.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
            }

            guard let indexURL = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Resources") else {
                return
            }
            // Grant read access to the whole Resources folder (not just the
            // file itself) so relative references like assets/*.gif and
            // icons/*.png resolve.
            webView.loadFileURL(indexURL, allowingReadAccessTo: indexURL.deletingLastPathComponent())
        }

        // MARK: Outbound links (tel:, sms:, mailto:, and http(s) navigations
        // the page intends to open outside itself)

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.allow)
                return
            }

            // The initial bundle load and any relative resource it pulls in.
            if url.isFileURL {
                decisionHandler(.allow)
                return
            }

            let scheme = url.scheme?.lowercased() ?? ""
            if scheme == "tel" || scheme == "sms" || scheme == "mailto" {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }

            // http(s) navigations only happen here when the page actually
            // navigates the top-level frame (e.g. window.location = ... for
            // the SMS compose flow's fallback, or a plain <a href> without
            // target="_blank" — the page currently has neither, but this
            // keeps behavior sane if one is ever added). window.open() with
            // target="_blank" — the admin panel's "Open Link" action — goes
            // through createWebViewWith below instead, not here.
            if scheme == "http" || scheme == "https" {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }

            decisionHandler(.allow)
        }

        /// window.open(url, '_blank') — used by the admin panel's
        /// "Open Link" action to open a prospect's confirm page. WKWebView
        /// has no second window to create here, so hand the URL to the
        /// system (Safari) and return nil to signal "handled, no new
        /// WKWebView needed."
        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            if let url = navigationAction.request.url {
                UIApplication.shared.open(url)
            }
            return nil
        }

        // MARK: CSV export download (admin panel's "Download CSV" button,
        // a Blob + <a download> click)

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationResponse: WKNavigationResponse,
            decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
        ) {
            if navigationResponse.canShowMIMEType {
                decisionHandler(.allow)
            } else {
                decisionHandler(.download)
            }
        }

        func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
            download.delegate = self
        }

        func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
            download.delegate = self
        }
    }
}

extension WebView.Coordinator: WKDownloadDelegate {
    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping (URL?) -> Void
    ) {
        let destination = FileManager.default.temporaryDirectory.appendingPathComponent(suggestedFilename)
        try? FileManager.default.removeItem(at: destination)
        downloadDestinations[ObjectIdentifier(download)] = destination
        completionHandler(destination)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let fileURL = downloadDestinations.removeValue(forKey: ObjectIdentifier(download)) else { return }
        DispatchQueue.main.async {
            presentShareSheet(for: fileURL)
        }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloadDestinations.removeValue(forKey: ObjectIdentifier(download))
    }
}

/// Hands the downloaded CSV to the system share sheet (Save to Files,
/// AirDrop, Mail, etc.) — there's no in-app file browser, so this is how
/// staff actually get the export off the device.
@MainActor
private func presentShareSheet(for fileURL: URL) {
    guard
        let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
        let rootVC = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController
    else { return }

    let activityVC = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
    var presenter = rootVC
    while let presented = presenter.presentedViewController {
        presenter = presented
    }
    if let popover = activityVC.popoverPresentationController {
        popover.sourceView = presenter.view
        popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 0, height: 0)
        popover.permittedArrowDirections = []
    }
    presenter.present(activityVC, animated: true)
}
