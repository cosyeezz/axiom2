import AppKit
import WebKit

// Isolated WebKit regression runner; never attaches to the user's desktop window.
final class PopoverProbe: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    let web: WKWebView
    init(url: URL) {
        let config = WKWebViewConfiguration()
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1440, height: 900), configuration: config)
        super.init()
        config.userContentController.add(self, name: "report")
        web.navigationDelegate = self
        web.load(URLRequest(url: url))
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        print(message.body)
        exit((message.body as? String)?.contains("\"passed\":true") == true ? 0 : 1)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.evaluateJavaScript("""
        window.runPopoverChecks().then(
          result => window.webkit.messageHandlers.report.postMessage(JSON.stringify(result)),
          error => window.webkit.messageHandlers.report.postMessage(JSON.stringify({passed:false,error:String(error),stack:error.stack,body:document.body.innerText.slice(0,2000)}))
        ); void 0;
        """) { _, error in
            if let error = error { print(error); exit(1) }
        }
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        print(error); exit(1)
    }
}
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let probe = PopoverProbe(url: URL(string: CommandLine.arguments[1])!)
DispatchQueue.main.asyncAfter(deadline: .now() + 45) { fputs("WebKit popover check timed out\n", stderr); exit(2) }
app.run()
