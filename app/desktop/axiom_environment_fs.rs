//! Metadata-only traversal. Directory handles anchor every lookup; links are never opened.
use std::{io, path::{Component, Path}};

#[derive(Clone, Copy)]
pub(crate) struct Metadata { pub file: bool, pub directory: bool, pub link: bool, pub bytes: u64 }
pub(crate) use platform::Entry;

pub(crate) fn open(path: &Path) -> io::Result<Entry> {
    if !path.is_absolute() || path.components().any(|part| matches!(part, Component::ParentDir | Component::CurDir)) {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "只接受无相对目录段的绝对路径"));
    }
    platform::open(path)
}

#[cfg(unix)]
mod platform {
    use super::*;
    use std::{ffi::{CStr, CString, OsStr}, fs::File, mem::MaybeUninit, os::{fd::{AsRawFd, FromRawFd, IntoRawFd}, unix::ffi::OsStrExt}, sync::Arc};

    pub(crate) struct Entry { parent: Arc<File>, name: CString, pub metadata: Metadata }
    fn name(value: &OsStr) -> io::Result<CString> { CString::new(value.as_bytes()).map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "路径包含空字符")) }
    fn directory(parent: i32, name: &CStr) -> io::Result<File> {
        // O_NONBLOCK also prevents a directory replaced by a FIFO from blocking open.
        let fd = unsafe { libc::openat(parent, name.as_ptr(), libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK) };
        if fd < 0 { Err(io::Error::last_os_error()) } else { Ok(unsafe { File::from_raw_fd(fd) }) }
    }
    fn entry(parent: Arc<File>, name: CString) -> io::Result<Entry> {
        let mut stat = MaybeUninit::<libc::stat>::uninit();
        if unsafe { libc::fstatat(parent.as_raw_fd(), name.as_ptr(), stat.as_mut_ptr(), libc::AT_SYMLINK_NOFOLLOW) } != 0 { return Err(io::Error::last_os_error()); }
        let stat = unsafe { stat.assume_init() };
        let kind = stat.st_mode & libc::S_IFMT;
        Ok(Entry { parent, name, metadata: Metadata { file: kind == libc::S_IFREG, directory: kind == libc::S_IFDIR, link: kind == libc::S_IFLNK, bytes: stat.st_size.max(0) as u64 } })
    }
    pub(crate) fn open(path: &Path) -> io::Result<Entry> {
        let mut parent = Arc::new(directory(libc::AT_FDCWD, c"/")?);
        let names: Vec<_> = path.components().filter_map(|part| match part { Component::Normal(value) => Some(value), _ => None }).collect();
        for value in names.iter().take(names.len().saturating_sub(1)) { parent = Arc::new(directory(parent.as_raw_fd(), &name(value)?)?); }
        entry(parent, match names.last() { Some(value) => name(value)?, None => c".".to_owned() })
    }
    struct Children { stream: *mut libc::DIR, directory: Arc<File> }
    impl Drop for Children { fn drop(&mut self) { unsafe { libc::closedir(self.stream); } } }
    impl Iterator for Children {
        type Item = io::Result<Entry>;
        fn next(&mut self) -> Option<Self::Item> {
            loop {
                // readdir uses errno to distinguish end-of-directory from failure.
                #[cfg(target_os = "macos")] unsafe { *libc::__error() = 0; }
                #[cfg(target_os = "linux")] unsafe { *libc::__errno_location() = 0; }
                let next = unsafe { libc::readdir(self.stream) };
                if next.is_null() {
                    let error = io::Error::last_os_error();
                    return if error.raw_os_error().unwrap_or(0) == 0 { None } else { Some(Err(error)) };
                }
                let name = unsafe { CStr::from_ptr((*next).d_name.as_ptr()) };
                if name == c"." || name == c".." { continue; }
                return Some(entry(self.directory.clone(), name.to_owned()));
            }
        }
    }
    impl Entry {
        pub(crate) fn name(&self) -> std::ffi::OsString { OsStr::from_bytes(self.name.to_bytes()).to_os_string() }
        pub(crate) fn children(&self) -> io::Result<Box<dyn Iterator<Item = io::Result<Entry>>>> {
            let file = directory(self.parent.as_raw_fd(), &self.name)?;
            let duplicate = file.try_clone()?;
            let fd = duplicate.into_raw_fd();
            let stream = unsafe { libc::fdopendir(fd) };
            if stream.is_null() { let error = io::Error::last_os_error(); unsafe { libc::close(fd); } return Err(error); }
            Ok(Box::new(Children { stream, directory: Arc::new(file) }))
        }
    }
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::{fs::{self, File, OpenOptions}, os::windows::fs::{MetadataExt, OpenOptionsExt}, path::PathBuf, sync::Arc};
    struct HeldDirectory { _file: File, _parent: Option<Arc<HeldDirectory>> }
    pub(crate) struct Entry { path: PathBuf, parent: Option<Arc<HeldDirectory>>, pub metadata: Metadata }
    fn metadata(value: fs::Metadata) -> Metadata {
        Metadata { file: value.is_file(), directory: value.is_dir(), link: value.file_attributes() & 0x400 != 0, bytes: value.len() }
    }
    fn hold(path: &Path, parent: Option<Arc<HeldDirectory>>) -> io::Result<Arc<HeldDirectory>> {
        // Deny write and delete sharing while inspecting this directory: neither
        // replacement nor conversion into a reparse point can redirect lookups.
        let file = OpenOptions::new().read(true).share_mode(1).custom_flags(0x02000000 | 0x00200000).open(path)?;
        let value = metadata(file.metadata()?);
        if value.link || !value.directory { return Err(io::Error::new(io::ErrorKind::InvalidInput, "父目录是链接或不是目录")); }
        Ok(Arc::new(HeldDirectory { _file: file, _parent: parent }))
    }
    pub(crate) fn open(path: &Path) -> io::Result<Entry> {
        if path.components().any(|part| matches!(part, Component::Prefix(prefix) if matches!(prefix.kind(), std::path::Prefix::UNC(..) | std::path::Prefix::VerbatimUNC(..) | std::path::Prefix::DeviceNS(..)))) {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "网络或设备路径未扫描"));
        }
        let mut parent = None;
        let mut current = PathBuf::new();
        for part in path.components() {
            current.push(part.as_os_str());
            if current == path { break; }
            if matches!(part, Component::Prefix(_)) { continue; }
            parent = Some(hold(&current, parent)?);
        }
        Ok(Entry { path: path.to_path_buf(), parent, metadata: metadata(fs::symlink_metadata(path)?) })
    }
    impl Entry {
        pub(crate) fn name(&self) -> std::ffi::OsString { self.path.file_name().unwrap_or_default().to_os_string() }
        pub(crate) fn children(&self) -> io::Result<Box<dyn Iterator<Item = io::Result<Entry>>>> {
            let guard = hold(&self.path, self.parent.clone())?;
            let children = fs::read_dir(&self.path)?;
            Ok(Box::new(children.map(move |child| {
                let path = child?.path();
                Ok(Entry { metadata: metadata(fs::symlink_metadata(&path)?), path, parent: Some(guard.clone()) })
            })))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    #[test]
    fn replacement_link_cannot_redirect_an_opened_directory() {
        use std::{fs, os::unix::fs::symlink, time::{SystemTime, UNIX_EPOCH}};
        let base = std::env::temp_dir().join(format!("axiom-inventory-handles-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(base.join("inside/child")).unwrap(); fs::create_dir(base.join("outside")).unwrap();
        fs::write(base.join("outside/private"), b"secret").unwrap();
        let base = fs::canonicalize(base).unwrap();
        let node = open(&base.join("inside")).unwrap();
        let mut children = node.children().unwrap();
        fs::rename(base.join("inside"), base.join("original")).unwrap(); symlink(base.join("outside"), base.join("inside")).unwrap();
        let child = children.next().unwrap().unwrap();
        assert!(child.metadata.directory, "entry lookup remains anchored to original directory");
        assert!(children.next().is_none());
        fs::rename(base.join("original/child"), base.join("original/old-child")).unwrap();
        symlink(base.join("outside"), base.join("original/child")).unwrap();
        assert!(child.children().is_err(), "replacement leaf link is never traversed");
        assert!(open(&base.join("inside/private")).is_err(), "linked ancestors cannot be opened");
        fs::remove_dir_all(base).unwrap();
    }
}
