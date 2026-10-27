/** Acknowledges intent, not completion or installation/authentication success. */
export function operationFeedback(op: string) {
  const action = op.split(".").at(-1) ?? "";
  if (/install/i.test(action) && !/uninstall/i.test(action)) return "正在提交安装请求…";
  if (/uninstall|remove/i.test(action)) return "正在提交移除请求…";
  if (/cancel/i.test(action)) return "正在提交取消请求…";
  if (/save|configure/i.test(action)) return "正在保存设置…";
  if (/rename/i.test(action)) return "正在保存新名称…";
  if (/check|refresh|get|doctor/i.test(action)) return "正在请求检查…";
  if (/copy|move/i.test(action)) return "正在提交资源调整…";
  return "正在提交操作…";
}
