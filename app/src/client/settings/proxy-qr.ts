import jsQrModule from "jsqr";

// jsQR exports the function directly from CommonJS; its declarations describe an ESM default.
const jsQR = jsQrModule as unknown as typeof import("jsqr").default;

/** Decode pixels locally. Neither the image nor its contents go to a QR service. */
export async function decodeProxyQr(file: File): Promise<string> {
  if (!file.size || file.size > 10 * 1024 * 1024) throw Error("请选择不超过 10 MB 的二维码图片。");
  let image: ImageBitmap;
  try { image = await createImageBitmap(file); }
  catch { throw Error("无法读取图片，请使用 PNG、JPG 或 WebP 格式。"); }
  try {
    if (!image.width || !image.height || image.width * image.height > 32_000_000) throw Error("图片尺寸过大，请裁剪到二维码后重试。");
    const scale = Math.min(1, 2048 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw Error("当前浏览器无法读取图片。");
    context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: "attemptBoth" });
    if (!result?.data.trim()) throw Error("没有识别到二维码，请使用清晰、完整的二维码图片。");
    return result.data.trim();
  } finally { image.close(); }
}
