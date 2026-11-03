import AppKit
import WebKit
let htmlPath = CommandLine.arguments[1], output = CommandLine.arguments[2]
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
final class Check: NSObject, WKNavigationDelegate {
 var window: NSWindow!, view: WKWebView!
 var step = 0, total = 0
 func start() {
  window = NSWindow(contentRect:NSRect(x:0,y:0,width:1000,height:850),styleMask:[.borderless],backing:.buffered,defer:false)
  view = WKWebView(frame:window.contentView!.bounds)
  window.contentView!.addSubview(view); view.navigationDelegate = self
  // Display behind existing windows without activating or touching the user's app.
  window.orderBack(nil)
  view.loadFileURL(URL(fileURLWithPath:htmlPath),allowingReadAccessTo:URL(fileURLWithPath:htmlPath).deletingLastPathComponent())
 }
 func webView(_ webView:WKWebView,didFinish navigation:WKNavigation!) {
  view.evaluateJavaScript("testCases.length") { result,error in
   guard let count = result as? Int else {print(error ?? "missing cases");exit(1)}
   self.total=count;self.advance()
  }
 }
 func advance() {
  if step == total {print("PASS snapshots \(total)");NSApp.terminate(nil);return}
  view.evaluateJavaScript("runCase(\(step))") { result,error in
   if let error = error {print(error);exit(1)}
   let name=(result as! [String:Any])["name"] as! String
   DispatchQueue.main.asyncAfter(deadline:.now()+0.4) {
    self.view.evaluateJavaScript("JSON.stringify(inspectCase(\(self.step)))") { value,error in
     if let error=error {print(error);exit(1)}
     let json=value as! String;print(json)
     try! json.write(toFile:output+"/"+name+".json",atomically:true,encoding:.utf8)
     let config=WKSnapshotConfiguration()
     self.view.takeSnapshot(with:config) { image,error in
      guard let image=image,let tiff=image.tiffRepresentation,let bitmap=NSBitmapImageRep(data:tiff),let data=bitmap.representation(using:.png,properties:[:]) else {print(error ?? "snapshot failed");exit(1)}
      try! data.write(to:URL(fileURLWithPath:output+"/"+name+".png"))
      self.step += 1;self.advance()
     }
    }
   }
  }
 }
}
let check=Check();check.start()
DispatchQueue.main.asyncAfter(deadline:.now()+120){print("timeout");exit(1)}
app.run()
