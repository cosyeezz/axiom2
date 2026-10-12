import { useState } from "react";
export function PreviewSetup({
  disabled,
  onOpen,
  onError,
}: {
  disabled: boolean;
  onOpen: (params: Record<string, unknown>) => void;
  onError: (error: string) => void;
}) {
  const [mode, setMode] = useState("static"),
    [directory, setDirectory] = useState("."),
    [executable, setExecutable] = useState("node"),
    [args, setArgs] = useState(
      '["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5173", "--strictPort"]',
    ),
    [port, setPort] = useState(5173),
    [authorized, setAuthorized] = useState(false);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        try {
          onOpen({
            mode,
            directory,
            executable,
            args: mode === "server" ? JSON.parse(args) : [],
            port,
            authorized,
          });
        } catch {
          onError("启动参数必须是 JSON 数组；操作未发送。");
        }
      }}
    >
      <label>
        预览模式
        <select
          className="input"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          <option value="static">静态 HTML 目录</option>
          <option value="server">启动本地项目服务</option>
        </select>
      </label>
      <label>
        工作空间内的相对目录
        <input
          className="input"
          required
          value={directory}
          onChange={(e) => setDirectory(e.target.value)}
        />
      </label>
      {mode === "server" && (
        <>
          <label>
            程序（不经 shell 拼接）
            <input
              className="input"
              required
              value={executable}
              onChange={(e) => setExecutable(e.target.value)}
            />
          </label>
          <label>
            参数 JSON 数组
            <textarea
              className="input"
              required
              value={args}
              onChange={(e) => setArgs(e.target.value)}
            />
          </label>
          <label>
            独占项目端口
            <input
              type="number"
              className="input"
              min="1024"
              max="65535"
              required
              value={port}
              onChange={(e) => setPort(e.target.valueAsNumber)}
            />
          </label>
        </>
      )}
      <label>
        <input
          type="checkbox"
          checked={authorized}
          onChange={(e) => setAuthorized(e.target.checked)}
          required
        />
        授权运行此项目页面／启动程序；项目代码不是沙箱，可访问当前用户权限下的文件。静态预览请仅选择可公开的构建目录。
      </label>
      <button className="btn" disabled={disabled || !authorized}>
        打开项目预览
      </button>
    </form>
  );
}
