// This process becomes the service CLI itself after the durable GO barrier.
// It is not in the npm Job/namespace: a daemon it starts remains independent.
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
const [nonce, cli, ...args] = process.argv.slice(2);
if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(nonce ?? '') || !isAbsolute(cli ?? '') || args.length !== 2 || args[0] !== 'start' || args[1] !== '--json' || !process.send) throw Error('Invalid service request barrier.');
await new Promise((resolve, reject) => {
  const disconnected = () => { clearTimeout(timer); reject(Error('Service request was not authorized.')); };
  const timer = setTimeout(() => { process.removeListener('disconnect', disconnected); process.disconnect?.(); reject(Error('Service request authorization expired.')); }, 30000);
  process.once('disconnect', disconnected);
  process.on('message', message => {
    if (message?.kind !== 'service-go' || message.nonce !== nonce) return;
    clearTimeout(timer); process.removeListener('disconnect', disconnected);
    process.removeAllListeners('message'); process.disconnect(); resolve();
  });
  process.send({ kind: 'service-ready', nonce, pid: process.pid });
});
process.argv = [process.execPath, cli, ...args];
await import(pathToFileURL(cli).href);
