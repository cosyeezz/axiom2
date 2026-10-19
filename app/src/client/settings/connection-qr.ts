import QRCode from "qrcode";

/** The QR contract is one explicit-port HTTP root URL on a Tailscale literal IP. */
export function connectionAddress(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 256) return null;
  const match = /^http:\/\/([0-9.]+|\[[0-9a-fA-F:]+\]):([1-9][0-9]{0,4})\/?$/.exec(value);
  if (!match || Number(match[2]) > 65535) return null;
  try {
    const url = new URL(value), host = url.hostname;
    if (host.startsWith("[")) {
      if (!host.startsWith("[fd7a:115c:a1e0:")) return null;
    } else {
      const parts = match[1].split(".");
      if (parts.length !== 4 || parts.some(p => String(Number(p)) !== p || Number(p) > 255) || Number(parts[0]) !== 100 || Number(parts[1]) < 64 || Number(parts[1]) > 127) return null;
    }
    return `http://${host}:${match[2]}/`;
  } catch { return null; }
}

export function connectionQr(address: string) {
  if (!connectionAddress(address)) throw new Error("连接地址无效");
  const qr = QRCode.create(address, { errorCorrectionLevel: "M" });
  const count = qr.modules.size, path: string[] = [];
  for (let row = 0; row < count; row++) for (let col = 0; col < count; col++) {
    if (qr.modules.get(row, col)) path.push(`M${col + 4},${row + 4}h1v1h-1z`);
  }
  return { size: count + 8, path: path.join("") };
}
