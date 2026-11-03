import AppKit
import WebKit

let args = CommandLine.arguments
let htmlPath = args[1], output = args[2]
let application = NSApplication.shared
application.setActivationPolicy(.accessory)
final class Check: NSObject, WKNavigationDelegate {
    var window: NSWindow!
    var view: WKWebView!
    var step = 0
    let cases = ["idle", "visible", "hidden", "svg-hidden", "svg-visible", "svg-hidden-again"]
    func start() {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 800, height: 600), styleMask: [.borderless], backing: .buffered, defer: false)
        view = WKWebView(frame: window.contentView!.bounds)
        window.contentView!.addSubview(view)
        view.navigationDelegate = self
        window.orderBack(nil)
        view.loadFileURL(URL(fileURLWithPath: htmlPath), allowingReadAccessTo: URL(fileURLWithPath: htmlPath).deletingLastPathComponent())
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { advance() }
    func advance() {
        if step == cases.count { NSApp.terminate(nil); return }
        let name = cases[step]
        let js = "document.body.dataset.state='\(name)'; JSON.stringify([...document.querySelectorAll('button')].map(b=>({opacity:getComputedStyle(b).opacity,svgOpacity:getComputedStyle(b.querySelector('svg')).opacity,box:b.getBoundingClientRect().toJSON()})))"
        view.evaluateJavaScript(js) { result, error in
            print(name, result ?? "nil", error?.localizedDescription ?? "")
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                self.view.evaluateJavaScript("JSON.stringify([...document.querySelectorAll('button')].map(b=>({opacity:getComputedStyle(b).opacity,display:getComputedStyle(b.querySelector('svg')).display})))") { value, error in print("settled", name, value ?? "nil") }
                let config = WKSnapshotConfiguration()
                self.view.takeSnapshot(with: config) { image, error in
                    guard let image = image, let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let data = bitmap.representation(using: .png, properties: [:]) else { print("snapshot failure", error?.localizedDescription ?? "unknown"); exit(1) }
                    try! data.write(to: URL(fileURLWithPath: output + "/" + name + ".png"))
                    self.step += 1
                    self.advance()
                }
            }
        }
    }
}
let check = Check()
check.start()
DispatchQueue.main.asyncAfter(deadline: .now() + 25) { print("timeout"); exit(1) }
application.run()
