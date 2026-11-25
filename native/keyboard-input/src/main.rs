mod decoder;
#[cfg(windows)]
mod win;
fn main() {
    #[cfg(windows)]
    if let Err(error) = win::run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
    #[cfg(not(windows))]
    eprintln!("Ввод с макропада доступен в Windows.");
}
