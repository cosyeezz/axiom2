/** Older running services may return an empty 404; never surface a JSON parser exception. */
export async function folderResponse(response: Response): Promise<string | null> {
  const restart = "本地服务尚不支持文件夹选择，请重启 Axiom2 本地服务后刷新页面再试。";
  if (response.status === 404 || response.status === 405) throw new Error(restart);
  const body = await response.text();
  let value: unknown;
  try { value = JSON.parse(body); }
  catch {
    throw new Error(response.ok
      ? "文件夹选择服务返回了空白或无效响应，请重启本地服务后重试。"
      : `无法打开系统文件夹选择器（HTTP ${response.status}），请检查本地服务后重试。`);
  }
  const result = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (!response.ok)
    throw new Error(typeof result.error === "string" && result.error.trim()
      ? result.error : `无法打开系统文件夹选择器（HTTP ${response.status}）`);
  if (result.path === null) return null;
  if (typeof result.path !== "string" || !result.path.trim())
    throw new Error("文件夹选择器未返回有效目录，请重新选择。");
  return result.path;
}
