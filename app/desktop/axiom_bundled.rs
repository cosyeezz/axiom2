//! Publish immutable desktop resources without overwriting links or other files.
use std::{collections::hash_map::DefaultHasher, hash::{Hash, Hasher}, io::{self, Read, Write}, path::{Component, Path, PathBuf}};
fn invalid() -> io::Error { io::Error::new(io::ErrorKind::InvalidInput, "内置维护资源路径或内容不安全") }
fn staging_name() -> String {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    format!(".axiom-stage-{}-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos(), NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed))
}
pub(crate) fn publish(base: &Path, files: &[(&str, &str)]) -> io::Result<PathBuf> {
    if !base.is_absolute() || base.components().any(|p| matches!(p, Component::ParentDir | Component::CurDir)) || files.iter().any(|(n, _)| n.is_empty() || n.contains(['/', '\\']) || *n == "." || *n == "..") { return Err(invalid()); }
    // Hash only chooses a cache name; exact content comparisons establish validity.
    let mut hash = DefaultHasher::new(); files.hash(&mut hash);
    let directory = base.join(format!("desktop-runtime-v2-{:016x}", hash.finish()));
    platform::publish(&directory, files)?;
    Ok(directory)
}
#[cfg(unix)]
mod platform {
    use super::*;
    use std::{ffi::CString, fs::File, os::{fd::{AsRawFd, FromRawFd}, unix::{ffi::OsStrExt, fs::MetadataExt}}};
    fn name(value: &std::ffi::OsStr) -> io::Result<CString> { CString::new(value.as_bytes()).map_err(|_| invalid()) }
    fn directory(parent: i32, name: &CString) -> io::Result<File> {
        let fd = unsafe { libc::openat(parent, name.as_ptr(), libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC) };
        if fd < 0 { Err(io::Error::last_os_error()) } else { Ok(unsafe { File::from_raw_fd(fd) }) }
    }
    fn commit(parent: &File, temporary: &CString, target: &CString) -> io::Result<()> {
        #[cfg(target_os = "macos")]
        let result = unsafe { libc::renameatx_np(parent.as_raw_fd(), temporary.as_ptr(), parent.as_raw_fd(), target.as_ptr(), libc::RENAME_EXCL) };
        #[cfg(target_os = "linux")]
        let result = unsafe { libc::syscall(libc::SYS_renameat2, parent.as_raw_fd(), temporary.as_ptr(), parent.as_raw_fd(), target.as_ptr(), libc::RENAME_NOREPLACE) };
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        return Err(io::Error::new(io::ErrorKind::Unsupported, "平台未提供原子资源发布"));
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        if result == 0 { Ok(()) } else { Err(io::Error::last_os_error()) }
    }
    pub(super) fn publish(path: &Path, files: &[(&str, &str)]) -> io::Result<()> {
        let mut parent = directory(libc::AT_FDCWD, &CString::new("/").unwrap())?;
        for part in path.components() {
            if let Component::Normal(value) = part {
                let name = name(value)?;
                if unsafe { libc::mkdirat(parent.as_raw_fd(), name.as_ptr(), 0o700) } != 0 && io::Error::last_os_error().kind() != io::ErrorKind::AlreadyExists { return Err(io::Error::last_os_error()); }
                parent = directory(parent.as_raw_fd(), &name)?;
            }
        }
        for (filename, source) in files {
            let name = CString::new(*filename).map_err(|_| invalid())?;
            let temporary = CString::new(staging_name()).unwrap();
            let fd = unsafe { libc::openat(parent.as_raw_fd(), temporary.as_ptr(), libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC, 0o600) };
            if fd < 0 { return Err(io::Error::last_os_error()); }
            let result = (|| {
                let mut file = unsafe { File::from_raw_fd(fd) }; file.write_all(source.as_bytes())?; file.sync_all()?;
                commit(&parent, &temporary, &name)
            })();
            // Only fully written files become visible at their executable name.
            // A crash can leave an unused staging file, which never blocks retry.
            if result.is_err() { unsafe { libc::unlinkat(parent.as_raw_fd(), temporary.as_ptr(), 0); } }
            if let Err(error) = result {
                if error.kind() != io::ErrorKind::AlreadyExists { return Err(error); }
                let fd = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC) };
                if fd < 0 { return Err(io::Error::last_os_error()); }
                let file = unsafe { File::from_raw_fd(fd) }; let info = file.metadata()?;
                if !info.is_file() || info.nlink() != 1 || info.len() != source.len() as u64 { return Err(invalid()); }
                let mut bytes = Vec::new(); file.take(source.len() as u64 + 1).read_to_end(&mut bytes)?;
                if bytes != source.as_bytes() { return Err(invalid()); }
            }
        }
        parent.sync_all()
    }
}
#[cfg(windows)]
mod platform {
    use super::*;
    use std::{fs::{self, File, OpenOptions}, os::windows::{ffi::OsStrExt, fs::{MetadataExt, OpenOptionsExt}, io::AsRawHandle}};
    #[repr(C)]
    struct FileInformation { attributes: u32, times: [u32; 6], volume: u32, size: [u32; 2], links: u32, index: [u32; 2] }
    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileW(existing: *const u16, target: *const u16) -> i32;
        fn GetFileInformationByHandle(handle: *mut std::ffi::c_void, information: *mut FileInformation) -> i32;
    }
    fn single_link(file: &File) -> io::Result<bool> {
        let mut info = std::mem::MaybeUninit::<FileInformation>::uninit();
        if unsafe { GetFileInformationByHandle(file.as_raw_handle(), info.as_mut_ptr()) } == 0 { return Err(io::Error::last_os_error()); }
        Ok(unsafe { info.assume_init() }.links == 1)
    }
    fn commit(temporary: &Path, target: &Path) -> io::Result<()> {
        let source: Vec<u16> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
        let destination: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
        if unsafe { MoveFileW(source.as_ptr(), destination.as_ptr()) } == 0 { Err(io::Error::last_os_error()) } else { Ok(()) }
    }
    pub(super) fn publish(path: &Path, files: &[(&str, &str)]) -> io::Result<()> {
        if path.components().any(|part| matches!(part, Component::Prefix(prefix) if matches!(prefix.kind(), std::path::Prefix::UNC(..) | std::path::Prefix::VerbatimUNC(..) | std::path::Prefix::DeviceNS(..)))) { return Err(invalid()); }
        let mut guards = Vec::new(); let mut current = PathBuf::new();
        for part in path.components() {
            current.push(part.as_os_str());
            if matches!(part, Component::Prefix(_)) { continue; }
            match fs::create_dir(&current) { Ok(()) => {}, Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {}, Err(e) => return Err(e) }
            let guard = OpenOptions::new().read(true).share_mode(1).custom_flags(0x02000000 | 0x00200000).open(&current)?;
            let info = guard.metadata()?;
            if !info.is_dir() || info.file_attributes() & 0x400 != 0 { return Err(invalid()); }
            guards.push(guard);
        }
        for (name, source) in files {
            let target = path.join(name);
            let temporary = path.join(staging_name());
            let mut file = OpenOptions::new().write(true).create_new(true).open(&temporary)?;
            let written = file.write_all(source.as_bytes()).and_then(|_| file.sync_all());
            drop(file);
            let result = written.and_then(|_| commit(&temporary, &target));
            if result.is_err() { let _ = fs::remove_file(&temporary); }
            match result {
                Ok(()) => {},
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
                    let file = OpenOptions::new().read(true).share_mode(1).custom_flags(0x00200000).open(&target)?;
                    let info = file.metadata()?;
                    if !info.is_file() || info.file_attributes() & 0x400 != 0 || !single_link(&file)? || info.len() != source.len() as u64 { return Err(invalid()); }
                    let mut bytes = Vec::new(); file.take(source.len() as u64 + 1).read_to_end(&mut bytes)?;
                    if bytes != source.as_bytes() { return Err(invalid()); }
                },
                Err(e) => return Err(e),
            }
        }
        Ok(())
    }
}
#[cfg(all(test, windows))]
mod windows_tests {
    use super::*;
    use std::fs;
    #[test]
    fn publication_rejects_identical_hard_links() {
        let root = std::env::temp_dir().join(staging_name()); fs::create_dir(&root).unwrap();
        let files = [("entry.mjs", "release-owned")];
        let path = publish(&root, &files).unwrap();
        assert_eq!(publish(&root, &files).unwrap(), path);
        let outside = root.join("outside"); fs::write(&outside, "release-owned").unwrap();
        fs::remove_file(path.join("entry.mjs")).unwrap(); fs::hard_link(&outside, path.join("entry.mjs")).unwrap();
        assert!(publish(&root, &files).is_err());
        assert_eq!(fs::read_to_string(&outside).unwrap(), "release-owned");
        fs::remove_dir_all(root).unwrap();
    }
}
#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::{fs, os::unix::fs::symlink, time::{SystemTime, UNIX_EPOCH}};
    #[test]
    fn unfinished_staging_does_not_block_retry_or_expose_partial_content() {
        let root = std::env::temp_dir().join(staging_name()); fs::create_dir(&root).unwrap();
        let root = fs::canonicalize(root).unwrap(); let files = [("entry.mjs", "complete-source")];
        let path = publish(&root, &files).unwrap(); fs::remove_file(path.join("entry.mjs")).unwrap();
        fs::write(path.join(".axiom-stage-interrupted"), "partial").unwrap();
        assert_eq!(publish(&root, &files).unwrap(), path);
        assert_eq!(fs::read_to_string(path.join("entry.mjs")).unwrap(), "complete-source");
        let threads: Vec<_> = (0..8).map(|_| { let root = root.clone(); std::thread::spawn(move || publish(&root, &files).unwrap()) }).collect();
        for thread in threads { assert_eq!(thread.join().unwrap(), path); }
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn immutable_publication_rejects_links_without_overwriting_targets() {
        let root = std::env::temp_dir().join(format!("axiom-bundle-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir(&root).unwrap(); let root = fs::canonicalize(root).unwrap();
        let files = [("entry.mjs", "release-owned")];
        let path = publish(&root, &files).unwrap(); assert_eq!(publish(&root, &files).unwrap(), path);
        let outside = root.join("outside"); fs::write(&outside, "keep me").unwrap();
        fs::remove_file(path.join("entry.mjs")).unwrap(); symlink(&outside, path.join("entry.mjs")).unwrap();
        assert!(publish(&root, &files).is_err()); assert_eq!(fs::read_to_string(&outside).unwrap(), "keep me");
        fs::remove_file(path.join("entry.mjs")).unwrap(); fs::hard_link(&outside, path.join("entry.mjs")).unwrap();
        assert!(publish(&root, &files).is_err()); assert_eq!(fs::read_to_string(&outside).unwrap(), "keep me");
        fs::remove_file(path.join("entry.mjs")).unwrap(); fs::remove_dir(&path).unwrap(); symlink(&outside, &path).unwrap();
        assert!(publish(&root, &files).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
