//! Bounded archive commit worker. All Unix mutations are relative to held directories.
use serde_json::{json, Value};
use std::{io, path::Path};
pub fn worker() -> bool {
    if std::env::args().nth(1).as_deref() != Some("--axiom-archive-worker") { return false; }
    let result = std::env::args().nth(2).filter(|s| s.len() <= 32768).ok_or_else(|| io::Error::other("归档请求无效"))
        .and_then(|text| serde_json::from_str(&text).map_err(io::Error::other)).and_then(|value| execute(&value));
    match result { Ok(value) => println!("{value}"), Err(error) => { println!("{}", json!({"error":error.to_string()})); std::process::exit(1); } }
    true
}
pub fn execute(request: &Value) -> io::Result<Value> {
    let root = request["root"].as_str().ok_or_else(|| io::Error::other("归档根目录无效"))?;
    if !Path::new(root).is_absolute() { return Err(io::Error::other("归档根目录必须是绝对路径")); }
    #[cfg(unix)] { platform::execute(request) }
    #[cfg(not(unix))] { Err(io::Error::other("当前平台尚未提供经验证的归档安全删除，请保留下载包")) }
}
#[cfg(unix)]
mod platform {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::{ffi::CString, fs::File, io::Read, os::{fd::{AsRawFd, FromRawFd}, unix::{ffi::OsStrExt, fs::MetadataExt}}, path::Component, time::{Duration, Instant}};
    fn invalid(message: &str) -> io::Error { io::Error::other(message) }
    fn name(value: &str) -> io::Result<CString> { CString::new(value).map_err(|_| invalid("归档名称无效")) }
    fn open(parent: &File, name: &CString, flags: i32) -> io::Result<File> {
        let fd = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), flags | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK, 0o600) };
        if fd < 0 { Err(io::Error::last_os_error()) } else { Ok(unsafe { File::from_raw_fd(fd) }) }
    }
    fn root_directory(path: &Path) -> io::Result<File> {
        let mut parent = File::open("/")?;
        for part in path.components() { match part {
            Component::RootDir => {},
            Component::Normal(value) => { let entry = CString::new(value.as_bytes()).map_err(|_| invalid("目录无效"))?; parent = open(&parent, &entry, libc::O_RDONLY | libc::O_DIRECTORY)?; },
            _ => return Err(invalid("目录包含相对路径")),
        } }
        Ok(parent)
    }
    fn present(parent: &File, name: &CString) -> io::Result<bool> {
        let mut info = std::mem::MaybeUninit::<libc::stat>::uninit();
        if unsafe { libc::fstatat(parent.as_raw_fd(), name.as_ptr(), info.as_mut_ptr(), libc::AT_SYMLINK_NOFOLLOW) } == 0 { return Ok(true); }
        let error = io::Error::last_os_error(); if error.kind() == io::ErrorKind::NotFound { Ok(false) } else { Err(error) }
    }
    fn unchanged(info: &std::fs::Metadata, target: &Value) -> bool {
        let stamp = &target["file"];
        info.is_file() && info.nlink() == 1 && stamp[0].as_str() == Some(&info.dev().to_string()) && stamp[1].as_str() == Some(&info.ino().to_string()) && stamp[2].as_u64() == Some(info.len())
    }
    fn digest(file: &mut File, target: &Value) -> io::Result<()> {
        let before = file.metadata()?;
        if !unchanged(&before, target) || before.len() == 0 || before.len() > 128 * 1024 * 1024 { return Err(invalid("归档身份已变化；已保留文件")); }
        let started = Instant::now(); let mut hash = Sha256::new(); let mut bytes = [0u8; 262144]; let mut total = 0u64;
        loop { let count = file.read(&mut bytes)?; if count == 0 { break; } total += count as u64;
            if total > before.len() || started.elapsed() > Duration::from_secs(15) { return Err(invalid("归档核实超时或内容变化；已保留文件")); }
            hash.update(&bytes[..count]);
        }
        let after = file.metadata()?;
        if total != before.len() || before.mtime() != after.mtime() || before.mtime_nsec() != after.mtime_nsec() || before.ctime() != after.ctime() || before.ctime_nsec() != after.ctime_nsec() || !unchanged(&after, target) || target["sha256"].as_str() != Some(&format!("{:x}", hash.finalize())) { return Err(invalid("归档摘要或身份已变化；已保留文件")); }
        Ok(())
    }
    pub(super) fn execute(request: &Value) -> io::Result<Value> { commit(request, || {}) }
    fn commit(request: &Value, before_isolate: impl FnOnce()) -> io::Result<Value> {
        let root = root_directory(Path::new(request["root"].as_str().unwrap()))?;
        let updates = open(&root, &name("updates")?, libc::O_RDONLY | libc::O_DIRECTORY)?;
        let expected = &request["directory"];
        let actual = updates.metadata()?;
        if expected[0].as_str() != Some(&actual.dev().to_string()) || expected[1].as_str() != Some(&actual.ino().to_string()) { return Err(invalid("归档目录身份已变化，保留任务待核实")); }
        // The kernel releases this lock only when every commit writer has exited.
        let lease = open(&updates, &name("archive-commit.lock")?, libc::O_RDWR | libc::O_CREAT)?;
        let info = lease.metadata()?;
        if !info.is_file() || info.nlink() != 1 || unsafe { libc::flock(lease.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 { return Err(invalid("归档提交仍在运行或锁文件无效，请稍后核实")); }
        let task = request["taskId"].as_str().filter(|s| s.len() == 36 && s.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')).ok_or_else(|| invalid("归档任务身份无效"))?;
        let quarantine = name(&format!("archive-quarantine-{task}"))?;
        let stopped = name(&format!("archive-stopped-{task}"))?;
        if request["op"] == "inspect" {
            // A child may not have acquired the lock yet when its parent exits.
            // Revoke this task under the same lock so a delayed child cannot commit.
            let marker = open(&updates, &stopped, libc::O_RDWR | libc::O_CREAT)?;
            let info = marker.metadata()?;
            if !info.is_file() || info.nlink() != 1 || info.len() != 0 { return Err(invalid("归档停止记录无效")); }
            marker.sync_all()?; updates.sync_all()?;
            return Ok(json!({"writerStopped":true,"quarantine":present(&updates, &quarantine)?}));
        }
        if request["op"] != "remove" { return Err(invalid("不支持的归档操作")); }
        if present(&updates, &stopped)? { return Err(invalid("归档任务已停止，不能再次提交")); }
        let id = request["target"]["id"].as_str().filter(|s| s.len() == 75 && s.ends_with("-axiom2.tgz") && s.as_bytes()[..64].iter().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(b))).ok_or_else(|| invalid("归档名称无效"))?;
        if request["target"]["sha256"].as_str() != Some(&id[..64]) { return Err(invalid("归档摘要与文件名不匹配")); }
        if present(&updates, &name("transaction.json")?)? { return Err(invalid("恢复事务尚未结束")); }
        match open(&root, &name("setup")?, libc::O_RDONLY | libc::O_DIRECTORY) {
            Ok(setup) if present(&setup, &name("service-owner.json")?)? => return Err(invalid("安装归属尚未解除")),
            Ok(_) => {}, Err(e) if e.kind() == io::ErrorKind::NotFound => {}, Err(e) => return Err(e),
        }
        let source = name(id)?;
        let mut original = open(&updates, &source, libc::O_RDONLY)?; digest(&mut original, &request["target"])?;
        if unsafe { libc::mkdirat(updates.as_raw_fd(), quarantine.as_ptr(), 0o700) } != 0 { return Err(invalid("已有归档隔离记录，保留文件并请重新核实")); }
        let held = open(&updates, &quarantine, libc::O_RDONLY | libc::O_DIRECTORY)?;
        let candidate = name("archive.tgz")?;
        before_isolate();
        if unsafe { libc::renameat(updates.as_raw_fd(), source.as_ptr(), held.as_raw_fd(), candidate.as_ptr()) } != 0 { return Err(io::Error::last_os_error()); }
        updates.sync_all()?; held.sync_all()?;
        // Rename can capture a replacement: verify the isolated inode before any unlink.
        let mut moved = open(&held, &candidate, libc::O_RDONLY)?;
        if let Err(error) = digest(&mut moved, &request["target"]) { return Err(invalid(&format!("{error}；隔离位置：updates/archive-quarantine-{task}/archive.tgz"))); }
        if unsafe { libc::unlinkat(held.as_raw_fd(), candidate.as_ptr(), 0) } != 0 { return Err(io::Error::last_os_error()); }
        held.sync_all()?;
        if unsafe { libc::unlinkat(updates.as_raw_fd(), quarantine.as_ptr(), libc::AT_REMOVEDIR) } != 0 { return Err(io::Error::last_os_error()); }
        updates.sync_all()?;
        Ok(json!({"removed":true,"remaining":present(&updates, &source)?}))
    }
    #[cfg(test)]
    mod tests {
        use super::*;
        use std::{fs, os::unix::fs::symlink, sync::atomic::{AtomicU64, Ordering}, time::{SystemTime, UNIX_EPOCH}};
        fn fixture() -> (std::path::PathBuf, Value) {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let root = std::env::temp_dir().join(format!("axiom-archive-{}-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos(), NEXT.fetch_add(1, Ordering::Relaxed)));
            fs::create_dir(&root).unwrap(); let root = fs::canonicalize(root).unwrap();
            fs::create_dir(root.join("updates")).unwrap();
            let bytes = b"owned archive"; let sha = format!("{:x}", Sha256::digest(bytes)); let id = format!("{sha}-axiom2.tgz");
            fs::write(root.join("updates").join(&id), bytes).unwrap();
            let file = fs::metadata(root.join("updates").join(&id)).unwrap(); let directory = fs::metadata(root.join("updates")).unwrap();
            let request = json!({"root":root,"op":"remove","taskId":"00000000-0000-4000-8000-000000000001","directory":[directory.dev().to_string(),directory.ino().to_string()],"target":{"id":id,"sha256":sha,"file":[file.dev().to_string(),file.ino().to_string(),file.len()]}});
            (root, request)
        }
        #[test]
        fn replacement_is_preserved_after_isolation() {
            let (root, request) = fixture(); let path = root.join("updates").join(request["target"]["id"].as_str().unwrap());
            let result = commit(&request, || { fs::rename(&path, root.join("original")).unwrap(); fs::write(&path, "keep replacement").unwrap(); });
            assert!(result.is_err());
            assert_eq!(fs::read(root.join("updates/archive-quarantine-00000000-0000-4000-8000-000000000001/archive.tgz")).unwrap(), b"keep replacement");
            assert_eq!(fs::read(root.join("original")).unwrap(), b"owned archive");
            fs::remove_dir_all(root).unwrap();
        }
        #[test]
        fn parent_replacement_cannot_redirect_delete() {
            let (root, request) = fixture(); let id = request["target"]["id"].as_str().unwrap();
            fs::create_dir(root.join("outside")).unwrap(); fs::write(root.join("outside").join(id), "outside survives").unwrap();
            assert!(commit(&request, || { fs::rename(root.join("updates"), root.join("original-updates")).unwrap(); symlink(root.join("outside"), root.join("updates")).unwrap(); }).is_ok());
            assert_eq!(fs::read(root.join("outside").join(id)).unwrap(), b"outside survives");
            assert!(!root.join("original-updates").join(id).exists()); fs::remove_dir_all(root).unwrap();
        }
        #[test]
        fn reconciliation_prevents_a_delayed_worker_from_committing() {
            let (root, mut request) = fixture();
            request["op"] = json!("inspect"); assert_eq!(execute(&request).unwrap()["writerStopped"], true);
            request["op"] = json!("remove"); assert!(execute(&request).is_err());
            assert_eq!(fs::read(root.join("updates").join(request["target"]["id"].as_str().unwrap())).unwrap(), b"owned archive");
            fs::remove_dir_all(root).unwrap();
        }
        #[test]
        fn reconciliation_refuses_a_replaced_updates_directory() {
            let (root, mut request) = fixture();
            fs::rename(root.join("updates"), root.join("previous-updates")).unwrap();
            fs::create_dir(root.join("updates")).unwrap(); request["op"] = json!("inspect");
            assert!(execute(&request).is_err());
            assert_eq!(fs::read_dir(root.join("updates")).unwrap().count(), 0);
            fs::remove_dir_all(root).unwrap();
        }
        #[test]
        fn commit_lock_blocks_reconciliation_until_writer_exits() {
            let (root, mut request) = fixture(); let directory = root_directory(&root.join("updates")).unwrap();
            let held = open(&directory, &name("archive-commit.lock").unwrap(), libc::O_RDWR | libc::O_CREAT).unwrap();
            assert_eq!(unsafe { libc::flock(held.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) }, 0);
            request["op"] = json!("inspect"); assert!(execute(&request).is_err()); drop(held);
            assert_eq!(execute(&request).unwrap()["writerStopped"], true); fs::remove_dir_all(root).unwrap();
        }
    }
}
