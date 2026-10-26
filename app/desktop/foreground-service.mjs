// Use the client's reviewed controller with the installed backend. Old releases
// registered themselves before acquiring the startup reservation; never execute
// their launcher just to start an otherwise valid installed backend.
import { realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectLaunchTarget } from './foreground-artifacts.mjs';

try {
  const root = await realpath(process.env.AXIOM_DATA_DIR);
  const installed = await inspectLaunchTarget(root, process.argv[2]);
  process.env.AXIOM_DATA_DIR = root;
  const { serve } = await import('./service-controller.mjs');
  await serve(false, {
    cli: installed.cli, version: installed.version,
    initialize: async options => {
      // The PowerShell launcher enables parent-aware ESM resolution. Resolve
      // import conditions from the installed CLI, not from the desktop bundle.
      const piUrl = import.meta.resolve('@earendil-works/pi-coding-agent', pathToFileURL(installed.cli).href);
      const { getAgentDir } = await import(piUrl);
      process.env.AXIOM_PI_DIR ||= getAgentDir();
      const { startServer } = await import(pathToFileURL(join(dirname(dirname(installed.cli)), 'app', 'dist', 'server', 'index.js')).href);
      return startServer(options);
    },
  });
} catch (error) { console.error(error.stack || error.message); process.exitCode = 1; }
