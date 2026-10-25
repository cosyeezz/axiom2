// Independent bitwise CRC encoder for mock upstream frames (production uses a lookup table).
export function fixtureCrc(bytes: Uint8Array) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let i = 0; i < 8; i++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  }
  return (value ^ 0xffffffff) >>> 0;
}
export function kiroFrame(kind: string, data: unknown, extra: Record<string, string> = {}) {
  const pairs = { ":message-type": "event", ":event-type": kind, ":content-type": "application/json", ...extra };
  const headers = Buffer.concat(Object.entries(pairs).map(([name, value]) => {
    const key = Buffer.from(name), text = Buffer.from(value), prefix = Buffer.alloc(2);
    prefix.writeUInt16BE(text.length);
    return Buffer.concat([Buffer.from([key.length]), key, Buffer.from([7]), prefix, text]);
  }));
  const payload = Buffer.from(JSON.stringify(data)), bytes = Buffer.alloc(16 + headers.length + payload.length);
  bytes.writeUInt32BE(bytes.length); bytes.writeUInt32BE(headers.length, 4); bytes.writeUInt32BE(fixtureCrc(bytes.subarray(0, 8)), 8);
  headers.copy(bytes, 12); payload.copy(bytes, 12 + headers.length); bytes.writeUInt32BE(fixtureCrc(bytes.subarray(0, -4)), bytes.length - 4);
  return bytes;
}
export function kiroResponse(frames: Uint8Array[], split = 0) {
  const bytes = Buffer.concat(frames);
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    for (let i = 0; i < bytes.length; i += split || bytes.length) controller.enqueue(bytes.subarray(i, Math.min(bytes.length, i + (split || bytes.length))));
    controller.close();
  } }), { headers: { "content-type": "application/vnd.amazon.eventstream" } });
}
