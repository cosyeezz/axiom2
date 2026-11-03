import { createHash, randomUUID } from "node:crypto";
import { object, qoderHeaders, qoderReadJson, qoderSignal, type QoderDataPolicy, type QoderIdentity } from "./qoder-protocol.js";

type Image = { mime: string; data: string; targets: Record<string, unknown>[] };
// CLI 1.1.81 egu/Agu/S0o/D0o: upload before serialization, preserving inline data on failure.
// Completed URLs only: unrelated callers never share a cancellable in-flight operation.
export class QoderImages {
  private readonly urls = new Map<string, string>();

  async prepare(payload: { messages: Record<string, unknown>[] }, endpoint: string, identity: QoderIdentity, policy: QoderDataPolicy, transport: typeof fetch, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const images = new Map<string, Image>();
    for (const message of payload.messages) {
      for (const field of ["content", "contents"]) {
        if (!Array.isArray(message[field])) continue;
        for (const raw of message[field]) {
          const part = object(raw);
          if (part.type !== "image_url") continue;
          const target = object(part.image_url), source = target.url;
          if (typeof source !== "string") continue;
          const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(source);
          if (!match) continue;
          let image = images.get(source);
          if (!image) { image = { mime: match[1].toLowerCase(), data: match[2], targets: [] }; images.set(source, image); }
          image.targets.push(target);
        }
      }
    }
    const pending = [...images.values()]; let index = 0;
    const worker = async () => {
      while (index < pending.length) {
        signal?.throwIfAborted();
        const image = pending[index++];
        const key = createHash("sha256").update(endpoint).update("\0").update(identity.userId).update("\0").update(identity.token)
          .update("\0").update(image.mime).update("\0").update(image.data).digest("hex");
        let url = this.urls.get(key);
        if (!url) {
          url = await this.upload(image, endpoint, identity, policy, transport, signal);
          signal?.throwIfAborted();
          if (url) {
            if (this.urls.size >= 512) this.urls.delete(this.urls.keys().next().value!);
            this.urls.set(key, url);
          }
        }
        signal?.throwIfAborted();
        if (url) for (const target of image.targets) target.url = url;
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, pending.length) }, worker));
    signal?.throwIfAborted();
  }

  private async upload(image: Image, endpoint: string, identity: QoderIdentity, policy: QoderDataPolicy, transport: typeof fetch, outer?: AbortSignal): Promise<string | undefined> {
    const signal = qoderSignal(outer, 30000), boundary = `----qodercli-${randomUUID().replaceAll("-", "")}`;
    const extension = image.mime === "image/jpeg" ? "jpg" : image.mime.slice("image/".length);
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="image.${extension}"\r\nContent-Type: ${image.mime}\r\n\r\n`),
      Buffer.from(image.data, "base64"), Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const url = `${endpoint}/algo/api/v2/image/upload?request_id=${randomUUID().replaceAll("-", "")}`;
    try {
      signal.throwIfAborted();
      const response = await transport(url, {
        method: "PUT", redirect: "error", signal, body: new Uint8Array(body),
        // WASM prepareRequest signs the decimal multipart LENGTH, not the binary body.
        // Let Fetch compute Content-Length: an explicit header is duplicated by mixed Undici runtimes.
        headers: { ...qoderHeaders(String(body.length), url, identity, policy), "AI-CLIENT-TIMESTAMP": String(Math.floor(Date.now() / 1000)), "Content-Type": `multipart/form-data; boundary=${boundary}` },
      });
      if (!response.ok) { void response.body?.cancel().catch(() => {}); return; }
      const value = await qoderReadJson(response, false, signal);
      signal.throwIfAborted();
      const string = (value: unknown) => typeof value === "string" && value.length ? value : undefined;
      const nested = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
      const result = nested(value.result), data = nested(value.data);
      const remote = string(value.url) ?? string(result.url) ?? string(result.oss_url) ?? string(data.url) ?? string(data.oss_url);
      if (!remote) return;
      const parsed = new URL(remote);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) return;
      return remote;
    } catch {
      // No auth refresh, upload retry, raw error logging or inference replay; CLI inline fallback only.
      outer?.throwIfAborted();
      return;
    }
  }
}
