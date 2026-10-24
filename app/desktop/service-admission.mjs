// One OS-backed SQLite write lease shared by desktop install/update/removal.
// The connection stays open for the operation; a crashed owner cannot leave a stale lock.
import { DatabaseSync } from 'node:sqlite';
import { lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
export async function serviceAdmission(root) {
  const actual = await realpath(root), file = join(actual, 'service-maintenance.sqlite');
  try { const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink()) throw Error('后台维护锁路径无效。'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const db = new DatabaseSync(file);
  try { db.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE'); }
  catch { db.close(); throw Error('后台正在安装、更新或卸载，请等待当前维护完成。'); }
  return () => db.close();
}
