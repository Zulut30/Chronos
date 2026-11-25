use std::io::{self, Write};

#[link(name = "kernel32")]
unsafe extern "system" {
    fn SetThreadExecutionState(flags: u32) -> u32;
}

// Windows releases the thread's request when it exits. EOF on the server's
// private pipe also ends the hold after an ungraceful server shutdown.
pub fn hold() -> io::Result<()> {
    const ES_CONTINUOUS: u32 = 0x80000000;
    const ES_SYSTEM_REQUIRED: u32 = 1;
    if unsafe { SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) } == 0 {
        return Err(io::Error::last_os_error());
    }
    writeln!(io::stdout().lock(), "held")?;
    io::copy(&mut io::stdin().lock(), &mut io::sink())?;
    Ok(())
}
