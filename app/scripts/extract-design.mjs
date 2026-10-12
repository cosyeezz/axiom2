// Run from app/. Reads the user-owned design; writes only generated development assets.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => readFileSync(root + '../ui/' + name, 'utf8');
mkdirSync(root + 'src/client/styles', { recursive: true });
const workbench = read('coding-agent-v2-before-subagent-modal-v2.html');
const tokens = workbench.match(/:root\s*\{[\s\S]*?\n\}/)[0];
writeFileSync(root + 'src/client/styles/tokens.css', tokens + '\n');
for (const [target, name] of [['workbench', 'coding-agent-v2-before-subagent-modal-v2.html'], ['settings', 'settings.html'], ['models', 'model-config.html']]) {
  const style = read(name).match(/<style>([\s\S]*?)<\/style>/)[1].replace(/:root\s*\{[\s\S]*?\n\}/, '');
  writeFileSync(root + `src/client/styles/${target}.css`, style);
}
const additional = read('model-config-before-unified-save-v2.html');
const css = additional.match(/#model-reasoning-field\{[\s\S]*?(?=<\/style>)/)[0];
writeFileSync(root + 'src/client/styles/model-interactions.css', css);
const sprite = workbench.match(/<svg aria-hidden="true" style="position:absolute;width:0;height:0">[\s\S]*?<\/svg>/)[0];
writeFileSync(root + 'src/client/icons.svg', sprite);
const license = workbench.match(/<!-- SVG source:[\s\S]*?-->/)[0].slice(5, -3);
writeFileSync(root + 'src/client/ICONS-LICENSE.txt', license.trimEnd() + '\n');
console.log('Extracted design styles, SVG symbols and licenses into app/src/client only.');
