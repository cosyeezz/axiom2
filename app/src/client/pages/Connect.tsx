import { useState } from "react";
import "../styles/settings.css";
export default function Connect() {
  const [link, setLink] = useState(""),
    [error, setError] = useState("");
  return (
    <main className="settings-main" style={{ maxWidth: 680, margin: "auto" }}>
      <h1>Axiom2 · 本地服务连接</h1>
      <p>
        桌面窗口与浏览器使用同一服务。先在 app 目录运行 npm
        start，再粘贴终端显示的完整访问链接；不扫描端口、不保存访问令牌。
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const url = new URL(link.trim());
            if (
              url.protocol !== "http:" ||
              url.hostname !== "127.0.0.1" ||
              url.username ||
              url.password ||
              url.pathname !== "/" ||
              url.search ||
              !/^#access=[a-f0-9]{64}$/.test(url.hash)
            )
              throw Error();
            location.assign(url.href);
          } catch {
            setError(
              "请使用本机服务显示的 http://127.0.0.1:端口/#access=… 完整链接。",
            );
          }
        }}
      >
        <label htmlFor="access-link">本地访问链接（仅在内存中输入）</label>
        <input
          id="access-link"
          className="input"
          type="password"
          autoComplete="off"
          required
          value={link}
          onChange={(e) => setLink(e.target.value)}
        />
        <button className="btn" type="submit">
          连接本地服务
        </button>
        <p role="status">{error}</p>
      </form>
      <p>
        需要 Node.js 24+。关闭窗口不会停止服务或任务；退出服务请在终端按 Ctrl+C
        并等待清理完成。认证授权在系统浏览器中进行；桌面壳不包含 Node.js 或 pi。
      </p>
    </main>
  );
}
