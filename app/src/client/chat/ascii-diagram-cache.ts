import { asciiDiagramBlocks, parseAsciiDiagram, type AsciiDiagram, type DiagramBlock } from "../../shared/ascii-diagram.js";
import type { DerivedCache } from "./derived-cache.js";

/** Cache failed recognition too: ordinary logs can contain diagram-like punctuation. */
export function cachedAsciiDiagram(cache: DerivedCache | null, source: string): AsciiDiagram | undefined {
  const parse = () => {
    try { return parseAsciiDiagram(source) ?? null; } catch { return null; }
  };
  return (cache ? cache.get(`ascii-diagram:v1:${source}`, parse) : parse()) ?? undefined;
}

/** Pure source ranges and geometry survive virtual row recycling, never viewing state. */
export function cachedAsciiDiagramBlocks(cache: DerivedCache | null, source: string): DiagramBlock[] {
  const parse = () => {
    try { return asciiDiagramBlocks(source); } catch { return []; }
  };
  return cache ? cache.get(`ascii-blocks:v1:${source}`, parse) : parse();
}
