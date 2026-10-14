import { useEffect } from "react";
import "../styles/settings.css";
export default function Connect() {
  useEffect(() => {
    location.replace("http://127.0.0.1:4317/");
  }, []);
  return (
    <main className="settings-main">
      <h1>Axiom2 · 本地服务连接</h1>
      <p>正在连接固定端口 4317。请先在终端运行 axiom2 启动服务。</p>
      <a className="btn" href="http://127.0.0.1:4317/">连接本地服务</a>
      <p>本机连接无需 token。关闭窗口不会停止服务或任务。</p>
    </main>
  );
}
