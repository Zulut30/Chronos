# Classify committed address ranges without reading any bytes from the benchmark CLI.
param([Parameter(Mandatory)][int]$ProcessId)
$ErrorActionPreference = 'Stop'
if ($env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or ![Environment]::Is64BitProcess) {
  throw 'Requires x64 PowerShell on a disposable Windows runner'
}
Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class BenchmarkMemoryMap {
  [StructLayout(LayoutKind.Sequential)]
  struct Region {
    public IntPtr Base, AllocationBase;
    public uint AllocationProtect;
    public ushort Partition;
    public UIntPtr Size;
    public uint State, Protect, Type;
  }
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern UIntPtr VirtualQueryEx(IntPtr process, IntPtr address, out Region region, UIntPtr length);
  public static long[] Read(int pid) {
    long[] totals = new long[3];
    using (Process process = Process.GetProcessById(pid)) {
      long next = 0;
      var length = new UIntPtr((uint)Marshal.SizeOf(typeof(Region)));
      while (true) {
        Region region;
        if (VirtualQueryEx(process.Handle, new IntPtr(next), out region, length) == UIntPtr.Zero) {
          int error = Marshal.GetLastWin32Error();
          if (next != 0 && error == 87) break; // End of user address space.
          throw new Win32Exception(error);
        }
        long size = checked((long)region.Size.ToUInt64());
        long end = checked(region.Base.ToInt64() + size);
        if (end <= next) throw new InvalidOperationException("Non-advancing address range");
        next = end;
        if (region.State != 0x1000) continue; // MEM_COMMIT only.
        switch (region.Type) {
          case 0x20000: totals[0] += size; break;
          case 0x40000: totals[1] += size; break;
          case 0x1000000: totals[2] += size; break;
        }
      }
    }
    return totals;
  }
}
"@
$map = [BenchmarkMemoryMap]::Read($ProcessId)
@{ private=$map[0]/1MB; mapped=$map[1]/1MB; image=$map[2]/1MB }
