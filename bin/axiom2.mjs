#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const args = process.argv.slice(2);
if (args.length === 1 && ["help", "--help", "-h"].includes(args[0])) {
  console.log(`Axiom2 — 本地编码 Agent 工作台

用法：axiom2 [--help|--version]

axiom2             在当前终端启动服务，Ctrl+C 正常退出
axiom2 --version   显示安装版本

浏览器 / Pake 地址：http://127.0.0.1:4317/
需要 Node.js 24+。关闭客户端窗口不会停止服务；请保留服务终端。
AXIOM_DATA_DIR 可指定数据目录，AXIOM_PI_DIR 可指定 pi 配置目录。
更新前请先结束任务并用 Ctrl+C 退出服务，再重新运行安装命令。
卸载：npm uninstall -g @cosyeezz/axiom2（保留用户数据与 pi 配置）`);
} else if (args.length === 1 && ["--version", "-v"].includes(args[0])) {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  console.log(pkg.version);
} else if (args.length) {
  console.error("未知参数。运行 axiom2 --help 查看用法。");
  process.exitCode = 1;
} else if (Number(process.versions.node.split(".")[0]) < 24) {
  console.error("Axiom2 需要 Node.js 24+，请从 https://nodejs.org/ 安装后重试。");
  process.exitCode = 1;
} else {
  try {
    const { getAgentDir } = await import("@earendil-works/pi-coding-agent");
    process.env.AXIOM_PI_DIR ||= getAgentDir();
    const port = Number(process.env.AXIOM_PORT ?? 4317);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error("AXIOM_PORT 无效");
    const { startServer } = await import("../app/dist/server/index.js");
    const app = await startServer({ port });
    console.log(`Axiom2 已启动：${app.accessUrl}\n数据目录：${app.store.root}\n打开浏览器或 Pake 客户端；保留此终端，Ctrl+C 退出服务。`);
    let closing = false;
    for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
      if (closing) return;
      closing = true;
      void app.close().then(() => process.exit(0), (error) => {
        console.error(`退出失败：${error.message}`);
        process.exit(1);
      });
    });
  } catch (error) {
    console.error(`Axiom2 启动失败：${error.message}`);
    process.exit(1);
  }
}
