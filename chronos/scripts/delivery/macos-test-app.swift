// Locate the test bundle in LaunchServices even when ShipIt relaunches it without debugger arguments.
import AppKit
import ApplicationServices

// Read only static UI labels, and only when the runner already grants Accessibility access.
func namesFixture(_ element: AXUIElement, depth: Int = 0) -> Bool {
    guard depth < 8 else { return false }
    func attribute(_ key: String) -> CFTypeRef? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, key as CFString, &value) == .success else { return nil }
        return value
    }
    if (attribute(kAXRoleAttribute) as? String) == kAXStaticTextRole,
       (attribute(kAXValueAttribute) as? String)?.contains("Chronos Safe Storage") == true { return true }
    return (attribute(kAXChildrenAttribute) as? [AXUIElement] ?? []).contains { namesFixture($0, depth: depth + 1) }
}

let url = URL(fileURLWithPath: CommandLine.arguments[2]).resolvingSymlinksInPath()
let apps = NSRunningApplication.runningApplications(withBundleIdentifier: "io.github.zulut30.chronos")
    .filter { $0.bundleURL?.resolvingSymlinksInPath().path == url.path }
guard apps.count == 1, let app = apps.first else { exit(1) }

switch CommandLine.arguments[1] {
case "keychain-window":
    let rows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
        as? [[String: Any]] ?? []
    let dialogs = rows.filter { ($0[kCGWindowOwnerName as String] as? String) == "SecurityAgent" }
    var named = dialogs.contains { ($0[kCGWindowName as String] as? String)?.contains("Chronos Safe Storage") == true }
    if !named && AXIsProcessTrusted() {
        for process in NSWorkspace.shared.runningApplications where process.executableURL?.lastPathComponent == "SecurityAgent" {
            if namesFixture(AXUIElementCreateApplication(process.processIdentifier)) { named = true; break }
        }
    }
    print(named ? "Chronos Safe Storage" : (dialogs.isEmpty ? "none" : "SecurityAgent"))
case "pid":
    print(app.processIdentifier)
case "quit":
    guard app.terminate() else { exit(1) }
    let deadline = Date().addingTimeInterval(20)
    while !app.isTerminated && Date() < deadline {
        RunLoop.current.run(until: Date().addingTimeInterval(0.1))
    }
    exit(app.isTerminated ? 0 : 1)
default:
    exit(2)
}
