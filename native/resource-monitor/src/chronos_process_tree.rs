use std::collections::{HashMap, HashSet};
use std::io::{self, Write};
use std::mem::size_of;
use windows::Win32::Foundation::{CloseHandle, ERROR_NO_MORE_FILES, FILETIME, HANDLE};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{
    GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
};

struct Handle(HANDLE);
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

fn creation_time(pid: u32) -> windows::core::Result<u64> {
    let handle = Handle(unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)? });
    let [mut birth, mut exit, mut kernel, mut user] = [FILETIME::default(); 4];
    unsafe {
        GetProcessTimes(handle.0, &mut birth, &mut exit, &mut kernel, &mut user)?;
    }
    Ok((u64::from(birth.dwHighDateTime) << 32) | u64::from(birth.dwLowDateTime))
}

// Take one parent table snapshot. Only open handles in the requested tree, with
// query-only access. One missing identity invalidates the entire sample.
pub fn write(root: u32) -> io::Result<()> {
    let snapshot = Handle(
        unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }.map_err(io::Error::other)?,
    );
    let mut row = PROCESSENTRY32W {
        dwSize: size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    unsafe { Process32FirstW(snapshot.0, &mut row) }.map_err(io::Error::other)?;
    let mut children = HashMap::<u32, Vec<u32>>::new();
    let mut root_parent = None;
    loop {
        children
            .entry(row.th32ParentProcessID)
            .or_default()
            .push(row.th32ProcessID);
        if row.th32ProcessID == root {
            root_parent = Some(row.th32ParentProcessID);
        }
        if let Err(error) = unsafe { Process32NextW(snapshot.0, &mut row) } {
            if error.code() != ERROR_NO_MORE_FILES.to_hresult() {
                return Err(io::Error::other(error));
            }
            break;
        }
    }
    let parent = root_parent.ok_or_else(|| io::Error::other("root exited"))?;
    let mut pending = vec![(root, parent)];
    let mut visited = HashSet::new();
    let mut out = io::BufWriter::new(io::stdout().lock());
    while let Some((pid, ppid)) = pending.pop() {
        if !visited.insert(pid) {
            continue;
        }
        let birth = creation_time(pid).map_err(io::Error::other)?;
        writeln!(out, "{pid} {ppid} {birth}")?;
        if let Some(descendants) = children.get(&pid) {
            pending.extend(descendants.iter().map(|&child| (child, pid)));
        }
    }
    out.flush()
}
