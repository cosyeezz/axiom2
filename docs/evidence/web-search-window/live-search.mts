// Live check: real WebSearchService (macOS window placement on) against the configured OpenCLI + Chrome.
import { WebSearchService } from "../../../app/src/server/web-access/search-service.ts";
const root = process.env.AXIOM_ROOT ?? `${process.env.HOME}/Library/Application Support/Axiom2`;
const service = new WebSearchService(root), owner = { workspaceId: "live", sessionId: "live", runId: `live-${Date.now()}` };
try {
  for (const q of ["axiom search window test one", "axiom search window test two"]) {
    const started = Date.now();
    const r: any = await service.search(owner, { queries: [q], limit: 3 }, new AbortController().signal);
    console.log(new Date().toISOString(), q, r.status, r.items.length, `${Date.now() - started}ms`);
  }
} finally { service.close(); }
