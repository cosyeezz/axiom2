// Bounded, nonblocking registration reads, shared by every native service route.
use std::{fs, io::Read, path::Path};

pub(crate) fn read(path: &Path) -> Result<Vec<u8>, String> {
    const LIMIT: u64 = 16 * 1024;
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)] {
        use std::os::unix::fs::OpenOptionsExt;
        // Check the opened handle, not a pre-open stat: a concurrent FIFO/link
        // replacement must neither block this thread nor redirect the read.
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC);
    }
    #[cfg(windows)] {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x00200000); // FILE_FLAG_OPEN_REPARSE_POINT
    }
    let file = options.open(path).map_err(|_| "无法安全读取服务安装记录，请检查安装来源。")?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    #[cfg(windows)] {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 { return Err("服务安装记录不能是重解析点。".into()); }
    }
    if !metadata.is_file() || metadata.len() > LIMIT { return Err("服务安装记录必须是小于等于 16 KiB 的普通文件。".into()); }
    let mut bytes = Vec::new();
    file.take(LIMIT + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > LIMIT { return Err("服务安装记录超过读取上限。".into()); }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{path::PathBuf, sync::atomic::{AtomicU64, Ordering}};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("axiom-service-record-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
            fs::create_dir(&path).unwrap(); Self(path)
        }
        fn record(&self) -> PathBuf { self.0.join("installation.json") }
    }
    impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
    #[test]
    fn ordinary_record_is_read_without_mutation() {
        let f = Fixture::new(); let path = f.record();
        let bytes = br#"{"node":"/node","cli":"/cli"}"#;
        fs::write(&path, bytes).unwrap();
        let before = fs::metadata(&path).unwrap();
        assert_eq!(read(&path).unwrap(), bytes);
        let after = fs::metadata(&path).unwrap();
        assert_eq!(before.modified().unwrap(), after.modified().unwrap());
        assert_eq!(before.permissions(), after.permissions());
        assert_eq!(fs::read_dir(&f.0).unwrap().count(), 1);
    }
    #[test]
    fn size_limit_is_exact_and_oversized_record_is_preserved() {
        let f = Fixture::new(); let path = f.record();
        fs::write(&path, vec![b'x'; 16384]).unwrap(); assert_eq!(read(&path).unwrap().len(), 16384);
        fs::write(&path, vec![b'x'; 16385]).unwrap(); assert!(read(&path).is_err());
        assert_eq!(fs::metadata(&path).unwrap().len(), 16385);
    }
    #[test]
    fn directory_and_missing_record_are_rejected_without_creation() {
        let f = Fixture::new(); let path = f.record();
        assert!(read(&path).is_err()); assert!(!path.exists());
        fs::create_dir(&path).unwrap(); assert!(read(&path).is_err());
        assert_eq!(fs::read_dir(&path).unwrap().count(), 0);
    }
    #[cfg(unix)]
    #[test]
    fn symlink_is_not_followed() {
        let f = Fixture::new(); let target = f.0.join("outside");
        fs::write(&target, b"keep").unwrap();
        std::os::unix::fs::symlink(&target, f.record()).unwrap();
        assert!(read(&f.record()).is_err()); assert_eq!(fs::read(&target).unwrap(), b"keep");
    }
    #[cfg(unix)]
    #[test]
    fn fifo_is_rejected_without_waiting_for_a_writer() {
        use std::{ffi::CString, os::unix::ffi::OsStrExt};
        let f = Fixture::new(); let path = f.record();
        let name = CString::new(path.as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(name.as_ptr(), 0o600) }, 0);
        let start = std::time::Instant::now();
        assert!(read(&path).is_err());
        assert!(start.elapsed() < std::time::Duration::from_secs(2));
        assert!(!fs::symlink_metadata(&path).unwrap().is_file());
    }
}
