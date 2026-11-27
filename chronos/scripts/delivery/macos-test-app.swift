// Locate the test bundle in LaunchServices even when ShipIt relaunches it without debugger arguments.
import AppKit

let url = URL(fileURLWithPath: CommandLine.arguments[2]).resolvingSymlinksInPath()
let apps = NSRunningApplication.runningApplications(withBundleIdentifier: "io.github.zulut30.chronos")
    .filter { $0.bundleURL?.resolvingSymlinksInPath().path == url.path }
guard apps.count == 1, let app = apps.first else { exit(1) }

switch CommandLine.arguments[1] {
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
