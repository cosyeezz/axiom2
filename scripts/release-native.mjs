// Inspect release archive bytes without extracting or executing package contents.
// This verifier also runs before npm ci, so it deliberately uses Node built-ins.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const text = bytes => bytes.toString('utf8').replace(/\0.*$/s, '');
function octal(bytes) {
  const value = text(bytes).trim();
  assert.match(value, /^[0-7]*$/, 'Unsupported tar numeric field');
  const result = value ? Number.parseInt(value, 8) : 0;
  assert.ok(Number.isSafeInteger(result)); return result;
}
function pax(bytes) {
  const values = Object.create(null);
  for (let at = 0; at < bytes.length;) {
    const space = bytes.indexOf(32, at);
    assert.ok(space > at, 'Invalid PAX length');
    const lengthText = bytes.subarray(at, space).toString();
    assert.match(lengthText, /^[1-9]\d*$/);
    const length = Number(lengthText);
    assert.ok(Number.isSafeInteger(length) && length > space - at + 2 && at + length <= bytes.length);
    assert.equal(bytes[at + length - 1], 10);
    const field = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(space + 1, at + length - 1)), equals = field.indexOf('=');
    // npm's tar reader splits PAX records by lines. Reject values that can be
    // interpreted as additional records instead of relying on lengths alone.
    assert.ok(!/[\x00-\x1f\x7f]/.test(field), 'Unsafe PAX control character');
    assert.ok(equals > 0);
    const key = field.slice(0, equals), value = field.slice(equals + 1);
    assert.ok(!Object.hasOwn(values, key), 'Duplicate PAX field');
    if (key === 'path') assert.ok(value.length > 0, 'Empty PAX path');
    if (['size', 'uid', 'gid'].includes(key)) assert.match(value, /^(0|[1-9]\d*)$/, 'Invalid PAX number');
    if (['mtime', 'atime', 'ctime'].includes(key)) assert.match(value, /^-?\d+(\.\d+)?$/, 'Invalid PAX timestamp');
    values[key] = value;
    at += length;
  }
  return values;
}

export function assertNativeArchive(archive, files, version) {
  const wanted = new Set(['package/package.json']);
  for (const arch of ['x64', 'arm64']) {
    wanted.add(`package/bin/native/linux-${arch}/axiom-owner`);
    wanted.add(`package/bin/native/linux-${arch}/manifest.json`);
  }
  const tar = gunzipSync(archive, { maxOutputLength: 512 * 1024 * 1024 });
  const found = new Map(); let extensions = {}, longName, terminated = false;
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512); offset += 512;
    if (header.every(byte => byte === 0)) {
      assert.ok(tar.subarray(offset).every(byte => byte === 0), 'Data after tar terminator');
      terminated = true; break;
    }
    let checksum = 0;
    for (let at = 0; at < 512; at++) checksum += at >= 148 && at < 156 ? 32 : header[at];
    assert.equal(octal(header.subarray(148, 156)), checksum, 'Tar checksum mismatch');
    assert.equal(header.subarray(257, 265).toString('hex'), '7573746172003030', 'Unsupported tar header format');
    const size = octal(header.subarray(124, 136)), type = header[156];
    assert.ok([0, 48, 53, 76, 103, 120].includes(type), 'Unsupported tar entry type');
    if (type === 53) assert.equal(size, 0, 'Tar directory must have no data');
    assert.ok(offset + Math.ceil(size / 512) * 512 <= tar.length, 'Truncated tar entry');
    const bytes = tar.subarray(offset, offset + size); offset += Math.ceil(size / 512) * 512;
    if (type === 120 || type === 103) {
      assert.ok(size <= 1024 * 1024, 'Tar metadata exceeds limit');
      const metadata = pax(bytes);
      const allowed = new Set(['path', 'size', 'uid', 'gid', 'uname', 'gname', 'mtime', 'atime', 'ctime']);
      assert.ok(Object.keys(metadata).every(key => allowed.has(key)), 'Unsupported PAX field');
      if (metadata.path !== undefined) assert.ok(!metadata.path.includes('\0'), 'NUL in tar path');
      if (type === 103) assert.ok(!['path', 'linkpath', 'size'].some(key => Object.hasOwn(metadata, key)), 'Unsupported global tar override');
      else {
        if (Object.hasOwn(metadata, 'path')) assert.ok(longName === undefined && extensions.path === undefined, 'Conflicting tar path extensions');
        Object.assign(extensions, metadata);
      }
      continue;
    }
    if (type === 76) {
      assert.ok(size <= 65536);
      assert.ok(longName === undefined && extensions.path === undefined, 'Conflicting tar path extensions');
      longName = text(bytes); continue;
    }
    const prefix = text(header.subarray(345, 500));
    const rawName = extensions.path ?? longName ?? `${prefix ? prefix + '/' : ''}${text(header.subarray(0, 100))}`;
    if (extensions.size !== undefined) assert.equal(extensions.size, String(size), 'Conflicting tar entry size');
    extensions = {}; longName = undefined;
    assert.ok(!rawName.includes('\0') && !rawName.includes('\\') && !rawName.startsWith('/') && !rawName.split('/').includes('..'), 'Unsafe tar path');
    if (type === 0 || type === 48) assert.ok(!rawName.endsWith('/'), 'Regular tar file has a directory path');
    const name = rawName.split('/').filter(part => part && part !== '.').join('/');
    assert.ok(name.length > 0, 'Empty tar path');
    if ([...wanted].some(path => path.startsWith(`${name}/`))) assert.equal(type, 53, `${name}: expected directory ancestor`);
    if (!wanted.has(name)) continue;
    assert.ok(type === 0 || type === 48, `${name}: expected regular file`);
    assert.ok(!found.has(name), `${name}: duplicate archive entry`);
    assert.ok(size > 0 && size <= (name.endsWith('axiom-owner') ? 8 * 1024 * 1024 : 524288), `${name}: invalid size`);
    found.set(name, { bytes, mode: octal(header.subarray(100, 108)) });
  }
  assert.ok(terminated, 'Missing tar terminator');
  for (const name of wanted) assert.ok(found.has(name), `Missing tar entry: ${name}`);
  const pkg = JSON.parse(found.get('package/package.json').bytes);
  assert.equal(pkg.name, '@cosyeezz/axiom2'); assert.equal(pkg.version, version);
  for (const [index, arch] of ['x64', 'arm64'].entries()) {
    const path = `package/bin/native/linux-${arch}`, helper = found.get(`${path}/axiom-owner`);
    const manifest = JSON.parse(found.get(`${path}/manifest.json`).bytes);
    const name = `axiom-owner-linux-${arch}`, asset = files[name];
    assert.ok(Buffer.isBuffer(asset) && asset.length >= 64 && asset.equals(helper.bytes), `${name}: public helper differs from tarball`);
    assert.equal(asset.subarray(0, 6).toString('hex'), '7f454c460201');
    assert.equal(asset.readUInt16LE(18), index === 0 ? 62 : 183);
    assert.ok((helper.mode & 0o111) !== 0 && (helper.mode & 0o6000) === 0, `${name}: invalid executable mode`);
    assert.equal(manifest.protocol, 1); assert.equal(manifest.arch, arch); assert.equal(manifest.sha256, hash(asset));
  }
}
