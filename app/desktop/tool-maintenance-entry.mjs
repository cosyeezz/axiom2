import { offlineToolRequest } from './tool-maintenance.js';
// The native bridge supplies a fixed data root through the environment, never the webview.
try {
  let text = '';
  for await (const chunk of process.stdin) {
    text += chunk;
    if (Buffer.byteLength(text) > 16384) throw Error('清理请求过大。');
  }
  if (!process.env.AXIOM_DATA_DIR) throw Error('缺少本机数据目录。');
  process.stdout.write(JSON.stringify(offlineToolRequest(process.env.AXIOM_DATA_DIR, JSON.parse(text))));
} catch (error) {
  process.stdout.write(JSON.stringify({ state: 'error', message: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
}
