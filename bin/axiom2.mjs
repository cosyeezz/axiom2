#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const args = process.argv.slice(2);
const json = args.includes("--json");
const command = args.filter((arg) => arg !== "--json");
const report = (value) => console.log(json ? JSON.stringify(value) : value.state === "running"
  ? `Axiom2 服务运行中：${value.url}\n运行中的会话：${value.active.length}\n日志：${value.log}`
  : value.state === "stopped" ? "Axiom2 服务已停止。" : value.message || "Axiom2 服务正在退出。");
try {
  if (Number(process.versions.node.split(".")[0]) < 24) throw Error("Axiom2 需要 Node.js 24+，请从 https://nodejs.org/ 安装后重试。");
  if (command.length === 1 && ["help", "--help", "-h"].includes(command[0])) {
    console.log(`Axiom2 — 本地编码 Agent 工作台

用法：axiom2 [start|stop|status] [--json]

axiom2             在当前终端启动服务，Ctrl+C 正常退出
axiom2 start       启动后台服务，关闭终端或客户端后继续运行
axiom2 stop        正常停止服务和正在运行的任务
axiom2 status      查看服务状态
axiom2 --version   显示安装版本

浏览器 / Pake 地址：http://127.0.0.1:4317/
Pake 内置服务控制页，可以启动和关闭后台服务；未注册登录自启。
AXIOM_DATA_DIR 可指定数据目录，AXIOM_PI_DIR 可指定 pi 配置目录。
更新前请先运行 axiom2 stop，再重新运行安装命令。
卸载：npm uninstall -g @cosyeezz/axiom2（保留用户数据与 pi 配置）`);
  } else if (command.length === 1 && ["--version", "-v"].includes(command[0])) {
    console.log(JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version);
  } else if (!command.length || (command.length === 1 && command[0] === "--daemon")) {
    const { serve } = await import("./service.mjs");
    await serve(command[0] === "--daemon");
  } else if (command.length === 1 && ["start", "stop", "status"].includes(command[0])) {
    const service = await import("./service.mjs");
    report(await service[command[0]]());
  } else throw Error("未知参数。运行 axiom2 --help 查看用法。");
} catch (error) {
  if (json) console.log(JSON.stringify({ state: "error", message: error.message }));
  else console.error(`Axiom2：${error.message}`);
  process.exitCode = 1;
}
