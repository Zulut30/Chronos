// Run a process on Chronos's non-input desktop. Never switch the input desktop.
package main

import (
    "fmt"
    "os"
    "path/filepath"
    "strings"
    "syscall"
    "unsafe"
)

func run() error {
    if len(os.Args) < 4 || !strings.HasPrefix(os.Args[1], "ChronosPC-") || strings.ContainsAny(os.Args[1], `\/`) || !filepath.IsAbs(os.Args[3]) {
        return fmt.Errorf("expected private desktop, launch/run and absolute executable")
    }
    name, err := syscall.UTF16PtrFromString(os.Args[1])
    if err != nil { return err }
    user := syscall.NewLazyDLL("user32.dll")
    desk, _, why := user.NewProc("CreateDesktopW").Call(uintptr(unsafe.Pointer(name)), 0, 0, 0, 0x1ff, 0)
    if desk == 0 { return fmt.Errorf("CreateDesktopW: %w", why) }
    defer user.NewProc("CloseDesktop").Call(desk)
    startup := syscall.StartupInfo{Desktop: name}
    startup.Cb = uint32(unsafe.Sizeof(startup))
    wait := os.Args[2] == "run"
    if !wait && os.Args[2] != "launch" { return fmt.Errorf("unknown operation") }
    inherit := false
    if wait {
        startup.Flags = syscall.STARTF_USESTDHANDLES
        startup.StdInput = syscall.Handle(os.Stdin.Fd())
        startup.StdOutput = syscall.Handle(os.Stdout.Fd())
        startup.StdErr = syscall.Handle(os.Stderr.Fd())
        for _, h := range []syscall.Handle{startup.StdInput,startup.StdOutput,startup.StdErr} {
            if err := syscall.SetHandleInformation(h, syscall.HANDLE_FLAG_INHERIT, syscall.HANDLE_FLAG_INHERIT); err != nil { return err }
        }
        inherit = true
    }
    args := make([]string,0,len(os.Args)-3)
    for _, arg := range os.Args[3:] { args = append(args, syscall.EscapeArg(arg)) }
    exe, err := syscall.UTF16PtrFromString(os.Args[3])
    if err != nil { return err }
    line, err := syscall.UTF16PtrFromString(strings.Join(args," "))
    if err != nil { return err }
    var proc syscall.ProcessInformation
    if err := syscall.CreateProcess(exe,line,nil,nil,inherit,0x08000000,nil,nil,&startup,&proc); err != nil { return err }
    defer syscall.CloseHandle(proc.Thread)
    defer syscall.CloseHandle(proc.Process)
    if !wait {
        // Keep the desktop handle alive until USER32 connects the new GUI process.
        user.NewProc("WaitForInputIdle").Call(uintptr(proc.Process), 5000)
        fmt.Printf("{\"pid\":%d}\n",proc.ProcessId)
        return nil
    }
    if _,err := syscall.WaitForSingleObject(proc.Process,30000); err != nil { return err }
    var code uint32
    if err := syscall.GetExitCodeProcess(proc.Process,&code); err != nil { return err }
    if code == 259 { syscall.TerminateProcess(proc.Process,1); return fmt.Errorf("desktop command timeout") }
    if code != 0 { return fmt.Errorf("desktop command exited %d",code) }
    return nil
}

func main() {
    if err := run(); err != nil { fmt.Fprintln(os.Stderr,err); os.Exit(1) }
}
