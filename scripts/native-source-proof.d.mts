export interface SourceFileRecord {
  path: string;
  size: number;
  sha256: string;
}
export interface SourceGitlinkRecord {
  path: string;
  commit: string;
}
export type GitlinkRecord = SourceGitlinkRecord;
export interface DmgRecord {
  size: number;
  sha256: string;
}
export interface SourceProofInputs {
  format: 1;
  productSha: string;
  probeSha: string;
  productFiles: SourceFileRecord[];
  gitlinks: SourceGitlinkRecord[];
  webFiles: SourceFileRecord[];
  productInputsSha256: string;
  gitlinksSha256: string;
  webInputsSha256: string;
}
export interface CapturedSourceProof extends SourceProofInputs {
  phase: "captured";
}
export interface SealedSourceProof extends SourceProofInputs {
  phase: "sealed";
  productionDmg: DmgRecord;
}
export interface NativeSourceProof extends SourceProofInputs {
  phase: "verified";
  productionDmg: DmgRecord;
  probeFiles: SourceFileRecord[];
}
export interface SourceProofExpectation {
  productSha: string;
  probeSha: string;
  dmg: DmgRecord;
}
export const PROBE_PATHS: readonly string[];
/** Returns the original proof only after the runtime's complete fail-closed checks. */
export function verifySourceProof(proof: unknown, expected: SourceProofExpectation): NativeSourceProof;
export function sourceProofAction(action: "capture", root: string, probeSha: string): Promise<CapturedSourceProof>;
export function sourceProofAction(action: "seal-production", root: string, probeSha: string): Promise<SealedSourceProof>;
export function sourceProofAction(action: "verify", root: string, probeSha: string): Promise<NativeSourceProof>;
export function sourceProofAction(action: "capture" | "seal-production" | "verify", root: string, probeSha: string): Promise<CapturedSourceProof | SealedSourceProof | NativeSourceProof>;
