export const isLocalPath = (value: string) => /^(?:\/|[A-Za-z]:[\\/]|\\\\|~[\\/]|\.{1,2}[\\/]|file:\/\/)/i.test(value) && !/[\x00-\x1f\x7f]/.test(value);

/** Only explicit JSON path values, never shell commands or fragments of truncated input. */
export function jsonLocalPaths(text: string): string[] {
  if (text.length > 1_000_000) return [];
  let value: unknown;
  try { value = JSON.parse(text); } catch { return []; }
  const paths = new Set<string>();
  let visited = 0;
  function walk(value: unknown, key = "", depth = 0) {
    if (++visited > 2000 || depth > 12 || paths.size >= 50) return;
    if (typeof value === "string") {
      if (value && value.length <= 4096 && (isLocalPath(value) || /^(?:path|file_path|filePath|cwd|directory|rootDir)$/.test(key) && !/^[a-z][a-z\d+.-]*:/i.test(value) && !/[\r\n]/.test(value))) paths.add(value);
    } else if (Array.isArray(value)) value.forEach(item => walk(item, key, depth + 1));
    else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => walk(item, key, depth + 1));
  }
  walk(value);
  return [...paths];
}

export function pathRelativeToFile(path: string, file?: string): string {
  return !file || /^(?:\/|[A-Za-z]:[\\/]|\\\\|~[\\/]|file:\/\/)/i.test(path) ? path : file.replace(/[^\\/]*$/, "") + path;
}
