// Run a process on Chronos's non-input desktop. Never switch the input desktop.
package main

import (
    "fmt"
    "io"
    "time"
    "os"
    "strconv"
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
    if os.Args[2] == "save-note" {
        if len(os.Args) != 5 || !strings.EqualFold(filepath.Clean(os.Args[3]),filepath.Join(os.Getenv("SystemRoot"),"System32","notepad.exe")) {
            return fmt.Errorf("expected system Notepad")
        }
        pid, err := strconv.ParseUint(os.Args[4],10,32)
        if err != nil { return err }
        return saveNote(user,desk,uint32(pid))
    }
    startup := syscall.StartupInfo{Desktop: name}
    startup.Cb = uint32(unsafe.Sizeof(startup))
    mode := os.Args[2]
    wait := mode == "run" || mode == "measure"
    if !wait && mode != "launch" && mode != "own" { return fmt.Errorf("unknown operation") }
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
    // Suspend until the kill-on-close job owns the process. Aborting a command cannot leave UIA working.
    if err := syscall.CreateProcess(exe,line,nil,nil,inherit,0x08000004,nil,nil,&startup,&proc); err != nil { return err }
    defer syscall.CloseHandle(proc.Thread)
    defer syscall.CloseHandle(proc.Process)
    if mode != "launch" {
        job, err := bindJob(proc.Process)
        if err != nil { syscall.TerminateProcess(proc.Process,1); return err }
        defer syscall.CloseHandle(job)
    }
    if result,_,err := syscall.NewLazyDLL("kernel32.dll").NewProc("ResumeThread").Call(uintptr(proc.Thread)); uint32(result) == 0xffffffff {
        syscall.TerminateProcess(proc.Process,1); return err
    }
    if !wait {
        // Keep the desktop handle alive until USER32 connects the new GUI process.
        user.NewProc("WaitForInputIdle").Call(uintptr(proc.Process), 5000)
        fmt.Printf("{\"pid\":%d}\n",proc.ProcessId)
        if mode == "own" {
            // stdin belongs to Electron. On disconnect terminate only the process handle we created.
            go func() { io.Copy(io.Discard, os.Stdin); syscall.TerminateProcess(proc.Process, 0) }()
            _, err := syscall.WaitForSingleObject(proc.Process, syscall.INFINITE)
            return err
        }
        return nil
    }
    if mode == "measure" { return measure(proc.Process) }
    if _,err := syscall.WaitForSingleObject(proc.Process,30000); err != nil { return err }
    var code uint32
    if err := syscall.GetExitCodeProcess(proc.Process,&code); err != nil { return err }
    if code == 259 { syscall.TerminateProcess(proc.Process,1); return fmt.Errorf("desktop command timeout") }
    if code != 0 { return fmt.Errorf("desktop command exited %d",code) }
    return nil
}

// Classic Notepad exposes the editor to UIA but its menu provider can reject Expand on a
// non-input desktop. Resolve Save by the menu's accelerator and deliver only that command.
func saveNote(user *syscall.LazyDLL, desktop uintptr, pid uint32) error {
    var window uintptr
    callback := syscall.NewCallback(func(hwnd, unused uintptr) uintptr {
        var owner uint32
        user.NewProc("GetWindowThreadProcessId").Call(hwnd,uintptr(unsafe.Pointer(&owner)))
        if owner != pid { return 1 }
        var name [64]uint16
        user.NewProc("GetClassNameW").Call(hwnd,uintptr(unsafe.Pointer(&name[0])),uintptr(len(name)))
        if syscall.UTF16ToString(name[:]) == "Notepad" { window = hwnd; return 0 }
        return 1
    })
    user.NewProc("EnumDesktopWindows").Call(desktop,callback,0)
    if window == 0 { return fmt.Errorf("owned Notepad window unavailable") }
    menu,_,_ := user.NewProc("GetMenu").Call(window)
    count,_,_ := user.NewProc("GetMenuItemCount").Call(menu)
    for i:=uintptr(0); i<count && i<64; i++ {
        sub,_,_ := user.NewProc("GetSubMenu").Call(menu,i)
        if sub == 0 { continue }
        n,_,_ := user.NewProc("GetMenuItemCount").Call(sub)
        for j:=uintptr(0); j<n && j<128; j++ {
            var label [256]uint16
            user.NewProc("GetMenuStringW").Call(sub,j,uintptr(unsafe.Pointer(&label[0])),uintptr(len(label)),0x400)
            parts := strings.Split(syscall.UTF16ToString(label[:]),"\t")
            if len(parts) != 2 || !strings.EqualFold(strings.TrimSpace(parts[1]),"Ctrl+S") { continue }
            id,_,_ := user.NewProc("GetMenuItemID").Call(sub,j)
            if uint32(id) == 0xffffffff || id == 0 { continue }
            var result uintptr
            ok,_,why := user.NewProc("SendMessageTimeoutW").Call(window,0x111,id,0,2,5000,uintptr(unsafe.Pointer(&result)))
            if ok == 0 { return fmt.Errorf("Save: %w",why) }
            fmt.Println("{\"ok\":true}")
            return nil
        }
    }
    return fmt.Errorf("Save command unavailable")
}

type basicLimit struct {
    ProcessTime, JobTime int64
    Flags uint32
    MinWorking, MaxWorking uintptr
    Active uint32
    Affinity uintptr
    Priority, Scheduling uint32
}
type extendedLimit struct {
    Basic basicLimit
    IO [6]uint64
    Memory [4]uintptr
}
func bindJob(process syscall.Handle) (syscall.Handle,error) {
    kernel := syscall.NewLazyDLL("kernel32.dll")
    raw,_,err := kernel.NewProc("CreateJobObjectW").Call(0,0)
    if raw == 0 { return 0,err }
    job := syscall.Handle(raw)
    var limits extendedLimit
    limits.Basic.Flags = 0x2000 // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    ok,_,err := kernel.NewProc("SetInformationJobObject").Call(raw,9,uintptr(unsafe.Pointer(&limits)),unsafe.Sizeof(limits))
    if ok != 0 { ok,_,err = kernel.NewProc("AssignProcessToJobObject").Call(raw,uintptr(process)) }
    if ok == 0 { syscall.CloseHandle(job); return 0,err }
    return job,nil
}

// PROCESS_MEMORY_COUNTERS is pointer-sized after the two DWORD fields.
type memoryCounters struct {
    Size, Faults uint32
    PeakWorkingSet, WorkingSet, PeakPaged, Paged, PeakNonPaged, NonPaged, Pagefile, PeakPagefile uintptr
}

func measure(process syscall.Handle) error {
    var counters memoryCounters
    counters.Size = uint32(unsafe.Sizeof(counters))
    query := syscall.NewLazyDLL("psapi.dll").NewProc("GetProcessMemoryInfo")
    deadline := time.Now().Add(30*time.Second)
    var peak uintptr
    for {
        ok, _, _ := query.Call(uintptr(process), uintptr(unsafe.Pointer(&counters)), uintptr(counters.Size))
        if ok != 0 && counters.PeakWorkingSet > peak { peak = counters.PeakWorkingSet }
        status, err := syscall.WaitForSingleObject(process, 2)
        if err != nil { return err }
        if status == syscall.WAIT_OBJECT_0 { break }
        if time.Now().After(deadline) { syscall.TerminateProcess(process,1); return fmt.Errorf("measurement timeout") }
    }
    var created, ended, kernel, user syscall.Filetime
    if err := syscall.GetProcessTimes(process,&created,&ended,&kernel,&user); err != nil { return err }
    ticks := func(t syscall.Filetime) uint64 { return uint64(t.HighDateTime)<<32 | uint64(t.LowDateTime) }
    var code uint32
    if err := syscall.GetExitCodeProcess(process,&code); err != nil || code != 0 || peak == 0 { return fmt.Errorf("invalid measurement") }
    fmt.Fprintf(os.Stderr,"peak_bytes=%d cpu_ms=%.3f\n",peak,float64(ticks(kernel)+ticks(user))/10000)
    return nil
}

func main() {
    if err := run(); err != nil { fmt.Fprintln(os.Stderr,err); os.Exit(1) }
}
