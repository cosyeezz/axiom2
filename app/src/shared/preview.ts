import type { Scope } from "./protocol.js";
export interface Preview extends Scope {
  id: string;
  url: string;
  origin: string;
  mode: "static" | "server";
  directory: string;
  revision: string;
  status: "running" | "stopped";
}
export interface ElementTarget {
  url: string;
  revision: string;
  selector: string;
  tag: string;
  text: string;
  snippet: string;
  rect: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number };
}
export interface PreviewSelection {
  type: "axiom-element";
  previewId: string;
  binding: string;
  target: ElementTarget;
}
