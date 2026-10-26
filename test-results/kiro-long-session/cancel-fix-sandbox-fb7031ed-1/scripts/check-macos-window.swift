import Foundation
import CoreGraphics

let pid = Int(CommandLine.arguments[1])!
for _ in 0..<30 {
    let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    let owned = windows.filter { window in
        guard window[kCGWindowOwnerPID as String] as? Int == pid,
              window[kCGWindowLayer as String] as? Int == 0,
              let bounds = window[kCGWindowBounds as String] as? [String: Any],
              let width = bounds["Width"] as? Double,
              let height = bounds["Height"] as? Double else { return false }
        return width >= 360 && height >= 600
    }
    if !owned.isEmpty {
        guard owned.count == 1 else {
            fputs("Expected one visible application window, found \(owned.count)\n", stderr)
            exit(1)
        }
        let data = try! JSONSerialization.data(withJSONObject: owned, options: [.sortedKeys])
        print(String(data: data, encoding: .utf8)!)
        exit(0)
    }
    Thread.sleep(forTimeInterval: 1)
}
fputs("No visible application window within 30 seconds\n", stderr)
exit(1)
