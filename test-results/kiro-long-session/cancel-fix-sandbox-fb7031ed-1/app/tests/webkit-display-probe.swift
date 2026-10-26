import AppKit
import WebKit

// Send native mouse events only to an isolated, hidden WebView. No desktop input.
final class DisplayDragProbe: NSObject, WKNavigationDelegate {
    let web: WKWebView
    let window: NSWindow
    let controls = ["fontScale", "brightness", "contrast"]
    let fractions: [Double] = [0.30, 0.25, 0.20, 0.15, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.85, 0.90]
    var index = 0
    var target: NSView?
    var left = 0.0, width = 0.0, y = 0.0

    init(url: URL) {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1440, height: 900), configuration: config)
        window = NSWindow(contentRect: web.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        super.init()
        window.contentView = web
        window.makeFirstResponder(web)
        web.navigationDelegate = self
        web.load(URLRequest(url: url))
    }
    func js(_ source: String, _ completion: @escaping (Any?) -> Void) {
        web.evaluateJavaScript(source) { value, error in
            if let error = error { self.fail(String(describing: error)) }
            completion(value)
        }
    }
    func fail(_ message: String) -> Never { fputs("FAIL WebKit display drag: \(message)\n", stderr); exit(1) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail(String(describing: error)) }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { ready() }
    func ready() {
        js("!!document.querySelector('#display-contrast')") { value in
            if value as? Bool == true { self.start() }
            else { DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { self.ready() } }
        }
    }
    func send(_ type: NSEvent.EventType, _ x: Double) {
        let point = NSPoint(x: x, y: y)
        guard let event = NSEvent.mouseEvent(with: type, location: web.convert(point, to: nil), modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseUp ? 0 : 1) else { fail("cannot create mouse event") }
        if target == nil { target = web.hitTest(point) }
        guard let target = target else { fail("no native hit target") }
        switch type {
        case .leftMouseDown: target.mouseDown(with: event)
        case .leftMouseDragged: target.mouseDragged(with: event)
        case .leftMouseUp: target.mouseUp(with: event)
        default: break
        }
    }
    func start() {
        if index == controls.count { print("PASS WebKit: all three actual display controls support held thumb drag in both directions"); exit(0) }
        js("""
        (() => {
          const el = document.querySelector('#display-\(controls[index])');
          el.scrollIntoView({block:'nearest'});
          const r = el.getBoundingClientRect();
          window.dragProbe = {el, values:[], trusted:true, start:Number(el.value), rect:[r.x,r.y,r.width], scroll:document.querySelector('.display-main').scrollTop};
          el.addEventListener('input', event => { dragProbe.values.push(Number(el.value)); dragProbe.trusted &&= event.isTrusted; });
          return {left:r.x,width:r.width,y:r.y+r.height/2,fraction:(Number(el.value)-Number(el.min))/(Number(el.max)-Number(el.min))};
        })()
        """) { value in
            guard let box = value as? [String: Double], let fraction = box["fraction"] else { self.fail("invalid control geometry") }
            self.left = box["left"]!; self.width = box["width"]!; self.y = box["y"]!
            self.target = nil
            self.send(.leftMouseDown, self.left + 8 + (self.width - 16) * fraction)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) {
                self.js("dragProbe.values.length === 0 && Math.abs(Number(dragProbe.el.value)-dragProbe.start) <= 1") { held in
                    if held as? Bool != true { self.fail("\(self.controls[self.index]): holding thumb changed its value") }
                    self.drag(0)
                }
            }
        }
    }
    func drag(_ step: Int) {
        if step < fractions.count {
            send(.leftMouseDragged, left + 8 + (width - 16) * fractions[step])
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { self.drag(step + 1) }
        } else {
            send(.leftMouseUp, left + 8 + (width - 16) * fractions.last!)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                self.js("""
                (() => {
                  const p=dragProbe,r=p.el.getBoundingClientRect(),v=p.values;
                  const stable=[r.x,r.y,r.width].every((n,i)=>Math.abs(n-p.rect[i])<.1) && document.querySelector('.display-main').scrollTop===p.scroll;
                  // WebKit may return focus to body after native mouseup. Check
                  // actual settings updates rather than requiring keyboard focus.
                  const saved=JSON.parse(localStorage.getItem('axiom.display.v1')||'{}');
                  const checks={trusted:p.trusted,continuous:new Set(v).size>=10,bothDirections:Math.min(...v)<p.start-10 && v.at(-1)>p.start+20,persisted:Math.abs(saved[p.el.id.slice('display-'.length)]-Number(p.el.value))<.01,stable};
                  return {passed:Object.values(checks).every(Boolean),checks,values:v,start:p.start,before:p.rect,after:[r.x,r.y,r.width],scrollBefore:p.scroll,scrollAfter:document.querySelector('.display-main').scrollTop,active:document.activeElement?.id || document.activeElement?.tagName};
                })()
                """) { result in
                    guard let result = result as? [String: Any], result["passed"] as? Bool == true else { self.fail("\(self.controls[self.index]): \(String(describing: result))") }
                    print("PASS WebKit \(self.controls[self.index]): \(result)")
                    self.index += 1
                    self.start()
                }
            }
        }
    }
}
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let probe = DisplayDragProbe(url: URL(string: CommandLine.arguments[1])!)
DispatchQueue.main.asyncAfter(deadline: .now() + 45) { fputs("WebKit display drag timed out\n", stderr); exit(2) }
app.run()
