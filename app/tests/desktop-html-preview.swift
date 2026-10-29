// Isolated system WKWebView probe. Never attaches to the running desktop app.
import Cocoa
import WebKit

let allowSrcdoc = CommandLine.arguments.contains("--allow-srcdoc")
let hostPath = CommandLine.arguments[1]
let output = URL(fileURLWithPath: CommandLine.arguments[2])

class NavigationDelegate: NSObject, WKNavigationDelegate {
    var navigations = [[String: Any]]()
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = action.request.url!
        let sameOrigin = url.scheme == "http" && url.host == "127.0.0.1" && url.port == 4317
        let allowed = sameOrigin || (allowSrcdoc && url.absoluteString == "about:srcdoc")
        navigations.append(["url": url.absoluteString, "main": action.targetFrame?.isMainFrame ?? false, "allowed": allowed])
        decisionHandler(allowed ? .allow : .cancel)
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1000, height: 800), styleMask: [.titled], backing: .buffered, defer: false)
let configuration = WKWebViewConfiguration()
configuration.websiteDataStore = .nonPersistent()
let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1000, height: 800), configuration: configuration)
let delegate = NavigationDelegate()
web.navigationDelegate = delegate
window.contentView = web
window.orderFront(nil)
// loadHTMLString supplies a synthetic origin; no running backend is contacted.
web.loadHTMLString(try String(contentsOfFile: hostPath, encoding: .utf8), baseURL: URL(string: "http://127.0.0.1:4317/"))
DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
    web.evaluateJavaScript("JSON.stringify(window.__reports || [])") { result, error in
        var report: [String: Any] = ["allowSrcdoc": allowSrcdoc, "navigations": delegate.navigations,
            "renderReports": result ?? NSNull(), "error": error?.localizedDescription ?? ""]
        web.takeSnapshot(with: nil) { image, snapshotError in
            if let image = image, let tiff = image.tiffRepresentation,
               let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]) {
                try? png.write(to: output.appendingPathExtension("png"))
            }
            report["snapshotError"] = snapshotError?.localizedDescription ?? ""
            do {
                try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
                    .write(to: output.appendingPathExtension("json"))
                app.terminate(nil)
            } catch {
                fputs("Failed to save WKWebView evidence: \(error)\n", stderr)
                exit(1)
            }
        }
    }
}
app.run()
