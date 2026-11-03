'use strict';
// Startup-only public metadata. No HTTP hooks or raw argument persistence.
(() => {
  let fd = null;
  let fs = null;
  try {
    fs = require('node:fs');
    const path = require('node:path');
    const argv = process.argv;
    if (!Array.isArray(argv) || argv.length > 64 || argv.length < 2) return;
    for (let i = 0; i < argv.length; i++) {
      const value = argv[i];
      if (typeof value !== 'string' || value.length > 4096 || Buffer.byteLength(value, 'utf8') > 4096) return;
    }
    const version = process.version;
    if (typeof version !== 'string' || !/^v[0-9]{1,2}\.[0-9]{1,2}\.[0-9]{1,2}$/.test(version)) return;
    const pid = process.pid;
    const ppid = process.ppid;
    if (!Number.isSafeInteger(pid) || pid < 1 || pid > 2147483647 ||
        !Number.isSafeInteger(ppid) || ppid < 1 || ppid > 2147483647) return;
    const scriptLeafMatches = argv[1].endsWith('/acp-server.js');
    let stdio = false;
    let ws = false;
    let acpCallback = false;
    for (let i = 2; i < argv.length; i++) {
      if (argv[i] === '--transport=stdio') stdio = true;
      if (argv[i] === '--transport=ws') ws = true;
      if (argv[i] === '--auth=acp-callback') acpCallback = true;
    }
    const roleCandidate = scriptLeafMatches && acpCallback && stdio && !ws
      ? 'kas-stdio-acp-callback'
      : scriptLeafMatches && acpCallback && ws && !stdio
        ? 'kas-ws-acp-callback'
        : 'unknown';
    const value = {
      schema: 'startup-public-marker-1',
      selfPID: pid,
      selfParentPID: ppid,
      nodeVersion: version,
      platform: process.platform === 'darwin' ? 'darwin' : 'other',
      architecture: process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : 'other',
      scriptLeafMatches,
      stdio,
      ws,
      acpCallback,
      roleCandidate,
      httpPatched: false,
      rawArgumentsPersisted: false,
      senderProved: false
    };
    const text = JSON.stringify(value) + '\n';
    if (Buffer.byteLength(text, 'utf8') > 2048) return;
    fd = fs.openSync(path.join(__dirname, 'runtime-marker.json'), 'wx', 0o400);
    fs.writeFileSync(fd, text, { encoding: 'utf8' });
  } catch {
    // No exception message, stack, argument or context crosses this boundary.
  } finally {
    if (fd !== null && fs !== null) {
      try { fs.closeSync(fd); } catch { /* no diagnostic content */ }
    }
  }
})();
