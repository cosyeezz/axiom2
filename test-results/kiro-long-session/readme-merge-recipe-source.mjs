import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { buildRecoveryEvidence, recoveryModels } from './scripts/kiro-live-evidence.mjs';
const [firstRoot, nextRoot, output] = process.argv.slice(2);
const states = Object.fromEntries(recoveryModels.map(id => {
  const root = ['minimax-m2.1', 'claude-haiku-4.5'].includes(id) ? firstRoot : nextRoot;
  return [id, JSON.parse(readFileSync(resolve(root, id, 'state.json'), 'utf8'))];
}));
const evidence = buildRecoveryEvidence(states, { allowIncomplete: true });
mkdirSync(dirname(resolve(output)), { recursive: true });
writeFileSync(resolve(output), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
