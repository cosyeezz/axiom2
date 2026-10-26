// Read-only diagnostics for the explicitly owned Qoder UI test run; no model or credential access.
const { DatabaseSync } = require('node:sqlite');
const { join } = require('node:path');
const db = new DatabaseSync(join(process.env.APPDATA, 'Axiom2', 'axiom.sqlite'), { readOnly: true });
const id = process.argv[2];
if (!/^[a-f\d-]{36}$/.test(id || '') && id !== 'latest-owned') throw Error('Explicit test run UUID or latest-owned required');
const row = id === 'latest-owned' ? db.prepare("SELECT r.id,r.sessionId,r.status,r.selection,r.startedAt,r.endedAt,r.error FROM runs r JOIN sessions s ON s.id=r.sessionId WHERE s.title=? ORDER BY r.startedAt DESC LIMIT 1").get('这是Qoder接入的独立最小测试。不要调用任何工具，不要访问文件或网络。17乘以19等于多少？最终只回复数字。') : db.prepare('SELECT id,sessionId,status,selection,startedAt,endedAt,error FROM runs WHERE id=?').get(id);
if (row) {
  const session = db.prepare('SELECT title,workspaceId FROM sessions WHERE id=?').get(row.sessionId);
  if (!session?.title.startsWith('这是Qoder接入的独立最小测试。')) throw Error('Not the owned minimal Qoder test');
  const binding = db.prepare('SELECT file FROM agent_sessions WHERE sessionId=?').get(row.sessionId);
  console.log(JSON.stringify({run:row,session,binding}));
} else console.log(JSON.stringify({notFound: true, id}));
db.close();
