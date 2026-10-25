import type { BinaryLike } from "node:crypto";

export const CERT: string;
export function sha256(bytes: BinaryLike): string;
export function parseSums(text: string): Map<string, string>;
export function verifyBinary(bytes: Buffer, kind: "exe" | "msi" | "deb" | "x64" | "arm64" | "zip"): void;
export function verifyAndroid(proof: unknown, files: ReadonlyMap<string, Buffer>, tag: string, source: string): void;
export function verifyRun(run: unknown, workflow: string): void;
export function verifySourceLogs(logs: string, source: string, expected: number | readonly string[]): void;
export function selectArtifact<T extends { name: string }>(artifacts: readonly T[], name: string): T;
export interface PublishClientsOptions {
  tag: string;
  desktopRun: string;
  androidRun: string;
  macosPublishRun: string;
  publish?: boolean;
}
export function publishClients(options: PublishClientsOptions): Promise<void>;
