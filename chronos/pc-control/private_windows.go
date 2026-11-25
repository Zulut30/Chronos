// Run a process on Chronos's non-input desktop. Never switch the input desktop.
package main

import (
    "fmt"
    "io"
    "time"
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
