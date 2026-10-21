import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
const open = fs.open;
fs.open = async (...args) => {
  const handle = await open(...args);
  for (const method of ['chmod', 'writeFile', 'sync', 'close']) {
    const original = handle[method];
    handle[method] = async function (...values) {
      try { return await original.apply(this, values); }
      catch (error) { console.error('[file-operation]', method, error.code, error.message); throw error; }
    };
  }
  return handle;
};
const rename = fs.rename;
fs.rename = async (...args) => {
  try { return await rename(...args); }
  catch (error) { console.error('[file-operation] rename', error.code, error.message); throw error; }
};
syncBuiltinESMExports();
