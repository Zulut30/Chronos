use crate::decoder::Decoder;
use sha2::{Digest, Sha256};
use std::{
    cell::RefCell,
    collections::{BTreeSet, HashMap},
    io::{self, BufRead},
    mem::size_of,
    ptr::{null, null_mut},
};
use windows_sys::Win32::{
    Devices::DeviceAndDriverInstallation::*,
    Foundation::*,
    System::LibraryLoader::GetModuleHandleW,
    UI::{Input::*, WindowsAndMessaging::*},
};

const USB: &str = "VID_0816&PID_2471";
struct Collection {
    pad: String,
    label: String,
    consumer: bool,
    decoder: Decoder,
}
type Devices = HashMap<usize, Collection>;
thread_local! {
    static DEVICES: RefCell<Devices> = RefCell::default();
    static OWNER: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain([0]).collect()
}
unsafe fn identify(handle: HANDLE) -> Option<Collection> {
    let mut path = [0u16; 1024];
    let mut length = path.len() as u32;
    if GetRawInputDeviceInfoW(
        handle,
        RIDI_DEVICENAME,
        path.as_mut_ptr().cast(),
        &mut length,
    ) == u32::MAX
    {
        return None;
    }
    let path =
        String::from_utf16_lossy(&path[..path.iter().position(|&c| c == 0)?]).to_ascii_uppercase();
    let mut parts = path.split('#');
    if parts.next()? != r"\\?\HID" {
        return None;
    }
    let interface = parts.next()?;
    let label = interface.strip_prefix(&format!("{USB}&"))?;
    let consumer = label == "MI_00&COL03";
    if !matches!(
        label,
        "MI_01" | "MI_00&COL01" | "MI_00&COL02" | "MI_00&COL03"
    ) {
        return None;
    }
    let instance = wide(&format!("HID\\{interface}\\{}", parts.next()?));
    let mut node = 0;
    if CM_Locate_DevNodeW(&mut node, instance.as_ptr(), 0) != 0 {
        return None;
    }
    for _ in 0..8 {
        let mut parent = 0;
        if CM_Get_Parent(&mut parent, node, 0) != 0 {
            break;
        }
        node = parent;
        let mut id = [0u16; 256];
        if CM_Get_Device_IDW(node, id.as_mut_ptr(), id.len() as u32, 0) != 0 {
            return None;
        }
        let id =
            String::from_utf16_lossy(&id[..id.iter().position(|&c| c == 0)?]).to_ascii_uppercase();
        if id.starts_with(&format!("USB\\{USB}\\")) {
            return Some(Collection {
                pad: format!("{:x}", Sha256::digest(id.as_bytes())),
                label: label.replace('&', "-").to_ascii_lowercase(),
                consumer,
                decoder: Decoder::default(),
            });
        }
    }
    None
}
unsafe fn devices() -> io::Result<Devices> {
    let mut n = 0;
    let size = size_of::<RAWINPUTDEVICELIST>() as u32;
    if GetRawInputDeviceList(null_mut(), &mut n, size) == u32::MAX {
        return Err(io::Error::last_os_error());
    }
    let mut list = vec![RAWINPUTDEVICELIST::default(); n as usize];
    let count = GetRawInputDeviceList(list.as_mut_ptr(), &mut n, size);
    if count == u32::MAX {
        return Err(io::Error::last_os_error());
    }
    Ok(list
        .iter()
        .take(count as usize)
        .filter_map(|d| identify(d.hDevice).map(|c| (d.hDevice as usize, c)))
        .collect())
}
unsafe fn receive(lp: LPARAM) {
    if GetForegroundWindow() as usize != OWNER.get() {
        return;
    }
    let hs = size_of::<RAWINPUTHEADER>() as u32;
    let mut header = RAWINPUTHEADER::default();
    let mut len = hs;
    if GetRawInputData(
        lp as _,
        RID_HEADER,
        (&mut header as *mut RAWINPUTHEADER).cast(),
        &mut len,
        hs,
    ) != hs
    {
        return;
    }
    DEVICES.with_borrow_mut(|devices| {
        let Some(c) = devices.get_mut(&(header.hDevice as usize)) else {
            return;
        };
        let mut len = header.dwSize;
        if !(hs..=65536).contains(&len) {
            return;
        }
        let mut aligned = vec![0u32; (len as usize).div_ceil(4)];
        if GetRawInputData(
            lp as _,
            RID_INPUT,
            aligned.as_mut_ptr().cast(),
            &mut len,
            hs,
        ) != header.dwSize
        {
            return;
        }
        let data =
            std::slice::from_raw_parts(aligned.as_ptr().cast::<u8>(), header.dwSize as usize);
        for signal in c
            .decoder
            .decode(header.dwType, c.consumer, &data[hs as usize..])
        {
            println!("{}:{signal}", c.label);
        }
    });
}
unsafe extern "system" fn proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    match msg {
        WM_INPUT => receive(lp),
        WM_INPUT_DEVICE_CHANGE
            if wp == 2 && DEVICES.with_borrow(|d| d.contains_key(&(lp as usize))) =>
        {
            PostQuitMessage(0)
        }
        WM_CLOSE => {
            PostQuitMessage(0);
            return 0;
        }
        _ => {}
    }
    DefWindowProcW(hwnd, msg, wp, lp)
}
pub fn run() -> io::Result<()> {
    unsafe {
        let args: Vec<_> = std::env::args().skip(1).collect();
        let mut devs = devices()?;
        if args.first().map(String::as_str) == Some("list") {
            for id in devs.values().map(|c| &c.pad).collect::<BTreeSet<_>>() {
                println!("{id}");
            }
            return Ok(());
        }
        if args.len() != 3 || args[0] != "listen" {
            return Err(io::Error::other(
                "Expected list or listen <device> <window>",
            ));
        }
        let owner: usize = args[2].parse().map_err(io::Error::other)?;
        devs.retain(|_, c| c.pad == args[1]);
        if devs.is_empty() {
            println!("absent");
            return Ok(());
        }
        DEVICES.replace(devs);
        OWNER.set(owner);
        let module = GetModuleHandleW(null());
        let name = wide("ChronosKeyboardInput");
        let wc = WNDCLASSW {
            lpfnWndProc: Some(proc),
            hInstance: module,
            lpszClassName: name.as_ptr(),
            ..Default::default()
        };
        if RegisterClassW(&wc) == 0 {
            return Err(io::Error::last_os_error());
        }
        let hwnd = CreateWindowExW(
            0,
            name.as_ptr(),
            name.as_ptr(),
            0,
            0,
            0,
            0,
            0,
            null_mut(),
            null_mut(),
            module,
            null(),
        );
        if hwnd.is_null() {
            return Err(io::Error::last_os_error());
        }
        let regs = [(1, 6), (1, 2), (12, 1)].map(|(page, usage)| RAWINPUTDEVICE {
            usUsagePage: page,
            usUsage: usage,
            dwFlags: RIDEV_INPUTSINK | RIDEV_DEVNOTIFY,
            hwndTarget: hwnd,
        });
        if RegisterRawInputDevices(regs.as_ptr(), 3, size_of::<RAWINPUTDEVICE>() as u32) == 0 {
            return Err(io::Error::last_os_error());
        }
        let target = hwnd as usize;
        std::thread::spawn(move || {
            for line in io::stdin().lock().lines().map_while(Result::ok) {
                let cmd = match line.as_str() {
                    "volume-mute" => 8,
                    "volume-down" => 9,
                    "volume-up" => 10,
                    "media-next" => 11,
                    "media-previous" => 12,
                    "media-play" => 14,
                    _ => continue,
                };
                if GetForegroundWindow() as usize == owner {
                    PostMessageW(target as HWND, WM_APPCOMMAND, target, cmd << 16);
                }
            }
            PostMessageW(target as HWND, WM_CLOSE, 0, 0);
        });
        println!("ready");
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, null_mut(), 0, 0) > 0 {
            DispatchMessageW(&msg);
        }
        Ok(())
    }
}
