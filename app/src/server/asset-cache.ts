/** Only content-addressed build assets are immutable; entry points and data stay fresh. */
export function assetCacheControl(pathname: string): string {
  return /^\/assets\/(?:[\w.-]+-[\w-]{8,}\.(?:js|css|woff2?|ttf|otf|png|jpe?g|gif|webp|svg|ico)|font-catalog-[\w-]{8,}\.json)$/.test(pathname)
    ? "private, max-age=31536000, immutable"
    : "no-store";
}
