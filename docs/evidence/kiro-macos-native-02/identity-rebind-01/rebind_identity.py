#!/usr/bin/python3
"""Read-only official Mach-O snapshot; never executes its input or a subprocess."""
import hashlib
import json
import os
from pathlib import Path
import plistlib
import resource
import stat
import struct
import tempfile
import time

HERE = Path(__file__).resolve().parent
APP = Path('/Applications/Kiro CLI.app/Contents')
CHUNK = 1024 * 1024
MIB = 1024 * 1024
START = time.monotonic()
TOTAL_CAP = 512 * MIB


def check(ok, reason):
    if not ok:
        raise RuntimeError(reason)
    if time.monotonic() - START >= 170:
        raise RuntimeError('deadline')


def identity(s):
    return [s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns]


def read_at(fd, off, length, total):
    check(0 <= off <= total and 0 <= length <= total - off, 'read-range')
    data = os.pread(fd, length, off)
    check(len(data) == length, 'short-read')
    return data


def hash_at(fd, off, length, total):
    check(0 <= off <= total and 0 <= length <= total - off, 'hash-range')
    h = hashlib.sha256()
    for p in range(off, off + length, CHUNK):
        h.update(read_at(fd, p, min(CHUNK, off + length - p), total))
    return h.hexdigest()


def open_regular(path, cap):
    fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW)
    try:
        s = os.fstat(fd)
        check(stat.S_ISREG(s.st_mode) and 0 < s.st_size <= cap, 'input-type-or-cap')
        check(identity(s) == identity(os.stat(path, follow_symlinks=False)), 'input-path-race')
        return fd, s
    except BaseException:
        os.close(fd)
        raise


def small_metadata(path):
    fd, before = open_regular(path, MIB)
    try:
        b = read_at(fd, 0, before.st_size, before.st_size)
        check(identity(before) == identity(os.fstat(fd)), 'metadata-fd-drift')
        check(identity(before) == identity(os.stat(path, follow_symlinks=False)), 'metadata-path-drift')
        return b, identity(before)
    finally:
        os.close(fd)


def macho(fd, total):
    head = read_at(fd, 0, 8, total)
    magic, nfat = struct.unpack('>II', head)
    check(magic in (0xcafebabe, 0xcafebabf) and 1 <= nfat <= 8, 'fat-header')
    width = 20 if magic == 0xcafebabe else 32
    table = read_at(fd, 8, width * nfat, total)
    slices, ranges = [], []
    for i in range(nfat):
        if width == 20:
            cpu, subtype, off, size, align = struct.unpack_from('>IIIII', table, i * width)
        else:
            cpu, subtype, off, size, align, reserved = struct.unpack_from('>IIQQII', table, i * width)
            check(reserved == 0, 'fat-reserved')
        check(0 < size <= total and 8 + width * nfat <= off <= total - size, 'slice-range')
        check(align <= 30 and off % (1 << align) == 0, 'slice-alignment')
        check(all(off + size <= a or off >= b for a, b in ranges), 'overlap-slices')
        ranges.append((off, off + size))
        mh = read_at(fd, off, 32, total)
        m, mcpu, msub, ftype, ncmds, cmdbytes, flags, reserved = struct.unpack('<IIIIIIII', mh)
        check(m == 0xfeedfacf and mcpu == cpu and msub == subtype, 'slice-header')
        check(0 < ncmds <= 4096 and ncmds * 8 <= cmdbytes <= 4 * MIB and 32 + cmdbytes <= size, 'commands-cap')
        commands = read_at(fd, off + 32, cmdbytes, total)
        pos, uuid, sections, links = 0, None, [], []
        for _ in range(ncmds):
            check(pos + 8 <= len(commands), 'command-head')
            cmd, csize = struct.unpack_from('<II', commands, pos)
            check(csize >= 8 and csize % 8 == 0 and pos + csize <= cmdbytes, 'command-size')
            if cmd == 0x1b:
                check(csize == 24 and uuid is None, 'uuid')
                uuid = commands[pos + 8:pos + 24].hex()
            elif cmd == 0x19:
                check(csize >= 72, 'segment-command')
                segname, vmaddr, vmsize, fileoff, filesize, maxprot, initprot, nsect, sflags = struct.unpack_from('<16sQQQQIIII', commands, pos + 8)
                check(fileoff <= size and filesize <= size - fileoff, 'segment-file-range')
                check(nsect <= 1024 and csize == 72 + nsect * 80, 'section-count')
                for j in range(nsect):
                    name, seg, addr, secsize, secoff, salign, reloff, nreloc, sf, r1, r2, r3 = struct.unpack_from('<16s16sQQIIIIIIII', commands, pos + 72 + j * 80)
                    name, seg = name.rstrip(b'\0').decode('ascii'), seg.rstrip(b'\0').decode('ascii')
                    check(len(sections) < 1024, 'section-total')
                    zero = (sf & 255) in (1, 12, 18)
                    if not zero:
                        check(fileoff <= secoff <= fileoff + filesize and secsize <= fileoff + filesize - secoff, 'section-file-range')
                    item = {'segment': seg, 'section': name, 'VA': hex(addr), 'sliceOffset': secoff, 'bytes': secsize, 'zerofill': zero}
                    if name in ('__text', '__const') and not zero:
                        item['sha256'] = hash_at(fd, off + secoff, secsize, total)
                    sections.append(item)
            elif cmd in (0x26, 0x1d):
                check(csize == 16, 'linkedit-command')
                loff, lsize = struct.unpack_from('<II', commands, pos + 8)
                check(loff <= size and lsize <= size - loff, 'linkedit-range')
                links.append({'kind': 'LC_FUNCTION_STARTS' if cmd == 0x26 else 'LC_CODE_SIGNATURE', 'sliceOffset': loff, 'bytes': lsize, 'sha256': hash_at(fd, off + loff, lsize, total)})
            pos += csize
        check(pos == cmdbytes and uuid is not None, 'commands-exact')
        slices.append({'cpuType': hex(cpu), 'cpuSubtype': hex(subtype), 'offset': off, 'bytes': size, 'alignment': align, 'filetype': ftype, 'UUID': uuid, 'ncmds': ncmds, 'sizeofcmds': cmdbytes, 'sha256': hash_at(fd, off, size, total), 'sections': sections, 'linkedit': links})
    return {'fatMagic': hex(magic), 'nfat': nfat, 'slices': slices}


def main():
    marker = HERE / 'RUN_STARTED.json'
    with marker.open('x') as f:
        json.dump({'unixTime': time.time(), 'scriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}, f)
    hard = resource.getrlimit(resource.RLIMIT_CPU)[1]
    cpu = 120 if hard == resource.RLIM_INFINITY else min(120, hard)
    check(cpu > 0, 'cpu-hard-limit')
    resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu))
    fsize_hard = resource.getrlimit(resource.RLIMIT_FSIZE)[1]
    check(fsize_hard == resource.RLIM_INFINITY or fsize_hard >= TOTAL_CAP, 'fsize-hard-limit')
    resource.setrlimit(resource.RLIMIT_FSIZE, (TOTAL_CAP, TOTAL_CAP))
    root = Path(tempfile.mkdtemp(prefix='kiro-mac-identity-rebind01-'))
    check(os.statvfs(root).f_bavail * os.statvfs(root).f_frsize >= 2 * 1024 * MIB, 'free-space')
    (HERE / 'snapshot-root.txt').write_text(str(root) + '\n')
    report = {'status': 'failed', 'snapshotRoot': str(root), 'scriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'cliExecutions': 0, 'modelRequests': 0, 'settingsReads': 0, 'authStorageReads': 0, 'inputs': []}
    opened = []
    try:
        meta_paths = [APP / 'Info.plist', APP / 'Resources/manifest.json']
        meta = [small_metadata(p) for p in meta_paths]
        plist = plistlib.loads(meta[0][0])
        manifest = json.loads(meta[1][0])
        report['publicBundleMetadata'] = {'plist': {k: plist.get(k) for k in ('CFBundleIdentifier', 'CFBundleVersion', 'CFBundleShortVersionString', 'CFBundleExecutable')}, 'manifest': manifest, 'sha256': [hashlib.sha256(b).hexdigest() for b, _ in meta], 'note': 'Public bundle metadata; no CLI --version executed.'}
        for name, cap in [('kiro-cli', 80 * MIB), ('kiro-cli-chat', 450 * MIB)]:
            path = APP / 'MacOS' / name
            fd, before = open_regular(path, cap)
            opened.append((path, fd, before))
        check(sum(s.st_size for _, _, s in opened) <= TOTAL_CAP, 'total-source-cap')
        for path, fd, before in opened:
            dest = root / (path.name + '.macho')
            h = hashlib.sha256()
            with dest.open('xb') as f:
                for off in range(0, before.st_size, CHUNK):
                    b = read_at(fd, off, min(CHUNK, before.st_size - off), before.st_size)
                    check(f.write(b) == len(b), 'short-write')
                    h.update(b)
            dest.chmod(0o400)
            check(identity(os.fstat(fd)) == identity(before), 'source-fd-drift')
            sf, ds = open_regular(dest, TOTAL_CAP)
            try:
                digest = hash_at(sf, 0, ds.st_size, ds.st_size)
                check(ds.st_size == before.st_size and digest == h.hexdigest(), 'snapshot-readback')
                parsed = macho(sf, ds.st_size)
            finally:
                os.close(sf)
            report['inputs'].append({'source': str(path), 'identity': identity(before), 'bytes': before.st_size, 'sha256': h.hexdigest(), 'snapshot': str(dest), 'snapshotMode': '0400', 'snapshotReadbackMatches': True, 'macho': parsed})
        for path, fd, before in opened:
            check(identity(os.fstat(fd)) == identity(before), 'final-fd-drift')
            check(identity(os.stat(path, follow_symlinks=False)) == identity(before), 'final-path-drift')
        report['metadataAndPathStable'] = all(small_metadata(p) == old for p, old in zip(meta_paths, meta))
        check(report['metadataAndPathStable'], 'metadata-drift')
        report['status'] = 'passed_static_snapshot_identity_only'
    except Exception as e:
        report['error'] = {'type': type(e).__name__, 'message': str(e)}
        raise
    finally:
        for _, fd, _ in opened:
            os.close(fd)
        report['wallSeconds'] = time.monotonic() - START
        report['cpuSeconds'] = time.process_time()
        (HERE / 'verification.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'status': report['status'], 'wallSeconds': report['wallSeconds'], 'metadataVersion': report['publicBundleMetadata']['plist']['CFBundleShortVersionString'], 'targets': [{k: x[k] for k in ('source', 'bytes', 'sha256', 'snapshot')} for x in report['inputs']]}))


if __name__ == '__main__':
    main()
