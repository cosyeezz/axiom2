import { constants } from 'node:fs';
import { mkdtemp, writeFile, open, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = await mkdtemp(join(tmpdir(), 'axiom-rename-diagnosis-'));
try {
  const original = join(root, 'original'), temporary = join(root, 'temporary');
  await writeFile(original, 'old'); await writeFile(temporary, 'new');
  const handle = await open(original, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  let heldSucceeded = false;
  try { await rename(temporary, original); heldSucceeded = true; console.log('RENAME_WITH_OPEN_READ_HANDLE: success'); }
  catch (error) { console.log('RENAME_WITH_OPEN_READ_HANDLE:', error.code); }
  finally { await handle.close(); }
  if (heldSucceeded) await writeFile(temporary, 'new again');
  await rename(temporary, original); console.log('RENAME_AFTER_READ_HANDLE_CLOSE: success');
} finally { await rm(root, { recursive: true, force: true }); }
