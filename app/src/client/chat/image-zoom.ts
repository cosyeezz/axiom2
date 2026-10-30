type Size = { width: number; height: number };
export type ImageView = { scale: number; x: number; y: number };
export function imageFitScale(image: Size, viewport: Size): number {
  return Math.min(1, Math.max(1, viewport.width - 48) / (image.width || 1), Math.max(1, viewport.height - 48) / (image.height || 1));
}
export function clampImageScale(scale: number, fit: number): number {
  // Very large images must not jump up to the minimum on their first gesture.
  return Math.max(Math.min(.05, fit), Math.min(3, scale));
}
export function imageWheelScale(scale: number, delta: number, mode: number, pageHeight: number, fit: number): number {
  const pixels = delta * (mode === 1 ? 16 : mode === 2 ? pageHeight : 1);
  // ~5% per typical 100px notch; bound extreme hardware deltas, not fine input.
  return clampImageScale(scale * Math.exp(-Math.max(-100, Math.min(100, pixels)) * .0005), fit);
}
export function imageZoomAt(view: ImageView, scale: number, point: { x: number; y: number }): ImageView {
  const ratio = scale / view.scale;
  return { scale, x: point.x - (point.x - view.x) * ratio, y: point.y - (point.y - view.y) * ratio };
}
export function imageScrollLayout(view: ImageView, image: Size, viewport: Size) {
  // Keep scroll offsets integral; image placement retains subpixel precision
  // rather than accumulating scroll rounding errors over an animated gesture.
  const scrollX = Math.ceil(Math.max(0, 24 - view.x)), scrollY = Math.ceil(Math.max(0, 24 - view.y));
  const x = view.x + scrollX, y = view.y + scrollY;
  return { x, y, scrollX, scrollY,
    width: Math.max(viewport.width + scrollX, x + image.width * view.scale + 24),
    height: Math.max(viewport.height + scrollY, y + image.height * view.scale + 24) };
}
