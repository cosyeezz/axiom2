/**
 * Skill / script artifact declaration.
 *
 * ── Why declarations exist ──────────────────────────────────────────────
 * `Bash` reports ACP `kind: 'execute'` and carries no `locations`, so a file
 * produced by `python make_deck.py` is invisible to every downstream consumer
 * that derives deliverables from ACP alone (notably the A2A binding's
 * `collectFileArtifacts`, which keys off `kind === 'edit'` + `locations`).
 * Nothing in ACP can tell which files a shell command wrote.
 *
 * Rather than guess (filesystem diffing picks up `__pycache__` and build
 * intermediates) or ask the model to call an extra tool (unreliable — it may
 * simply forget), the script states it outright. A declaration is *code*
 * behaviour: the write runs or it does not.
 *
 * ── Why an out-of-band file rather than stdout ──────────────────────────
 * The first design printed declarations on stdout behind a
 * `::codebuddy-artifact::` marker. That cannot work: stdout is a shared
 * channel that also carries whatever the script *reads*, so `cat some.log` on
 * a log that happens to contain a marker line got adopted as a genuine
 * declaration, silently. Since a declaration may name a local path, and a
 * named local path is read and inlined for the caller, that turned an ordinary
 * `cat` into arbitrary file disclosure. In-band signalling cannot distinguish
 * what a script says from what it quotes. GitHub Actions hit the same wall
 * with `::set-output::` and ended up moving to a file (`$GITHUB_OUTPUT`); this
 * follows that.
 *
 * Nothing parses stdout any more. The marker survived for one release as a
 * migration shim for scripts written against that first design, narrowed to
 * `http(s)` urls so a quoted marker could not name a local file; it is gone
 * now, and a script that still prints one gets no artifact and no warning —
 * the line is ordinary output. The regression guarding that lives in
 * `bash-tool-produced-artifact.spec.ts`.
 *
 * The channel itself lives in `produced-artifact-report.ts`. This module owns
 * only the shape of a declaration and its validation.
 */
/**
 * Cap on a single declaration's JSON payload.
 *
 * A declaration is metadata — uri, name, mime type. Anything larger is a
 * script accidentally piping content through the channel, and parsing it would
 * push the whole blob into session history. Treated as malformed instead.
 */
export declare const ARTIFACT_DECLARATION_MAX_BYTES = 8192;
/**
 * Cap on how many artifacts one command may declare.
 *
 * The per-line cap above bounds a single declaration but says nothing about
 * how many arrive. Declarations are commonly written from a loop (batch
 * rendering), so an off-by-one in that loop turns into tens of thousands of
 * entries — every one of them persisted into session history alongside the
 * tool result, and republished as its own artifact update on the A2A side.
 * Past this count the rest are dropped with a warning, which keeps the
 * failure visible instead of quietly bloating the session.
 */
export declare const ARTIFACT_DECLARATION_MAX_COUNT = 64;
/**
 * A file the tool produced, as declared by the script that made it.
 *
 * Only `uri` is required; everything else improves how the artifact presents
 * downstream. Supplying `mimeType` matters more than it looks: Office types
 * are absent from the extension table used as fallback, and a signed remote
 * URL carries a long query string that defeats suffix sniffing entirely.
 */
export interface ProducedArtifact {
    /** Remote URL, or an absolute local path inside the working directory. */
    uri: string;
    /** Display name. Falls back to the uri's basename. */
    name?: string;
    /** Content type. Falls back to extension lookup. */
    mimeType?: string;
    /** One-line explanation, useful when a run emits several artifacts. */
    description?: string;
    /** Byte size, letting a consumer decide whether to fetch. */
    sizeBytes?: number;
}
/** A declaration that could not be parsed, kept for diagnostics. */
export interface MalformedDeclaration {
    /** The offending line, clipped so a runaway line cannot flood the log. */
    preview: string;
    /** Why it was rejected. */
    reason: string;
}
/** Everything one command's report file yielded. */
export interface ArtifactDeclarationOutcome {
    artifacts: ProducedArtifact[];
    malformed: MalformedDeclaration[];
}
/**
 * A rejection, with the offending line clipped.
 *
 * The clip is what makes the warning safe to log: a script that pipes a whole
 * file into the channel would otherwise put all of it in the log.
 */
export declare function malformed(line: string, reason: string): MalformedDeclaration;
/**
 * Validate one declaration — a single JSON object, one per line of the report
 * file.
 *
 * Returns the artifact on success, or a `MalformedDeclaration` explaining why
 * it was rejected. Every rejection carries a reason because the author never
 * sees this file: a silently dropped line would leave them with a script that
 * ran fine and a caller that received nothing.
 */
export declare function parseProducedArtifactPayload(payload: string): ProducedArtifact | MalformedDeclaration;
/** Narrowing helper — `MalformedDeclaration` and `ProducedArtifact` are disjoint. */
export declare function isMalformedDeclaration(value: ProducedArtifact | MalformedDeclaration): value is MalformedDeclaration;
/**
 * Collapse declarations that name the same file, keeping the first.
 *
 * De-duplication is by `uri` because that is what identifies an artifact
 * downstream — the A2A converter bucket-keys on it, so two entries sharing a
 * uri would collapse into one artifact id there anyway, with whichever arrived
 * last silently overwriting the other. Doing it here keeps the tool result and
 * session history consistent with what the caller ends up seeing, which
 * matters for a script that appends the same uri from a retried loop.
 */
export declare function dedupeArtifactDeclarations(declarations: readonly ProducedArtifact[]): ProducedArtifact[];
