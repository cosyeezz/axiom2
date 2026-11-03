import { useEffect, useState } from "react";
import { componentInstallAction } from "../../shared/component-actions.js";
import { emptyFfmpegState } from "../../shared/ffmpeg.js";
import { LocalPath } from "../LocalPath.js";
import { BackendMaintenance } from "../maintenance/BackendMaintenance.js";
import { ComponentActions, ComponentConfirmation } from "../maintenance/ComponentCard.js";
import { command, useConnectionState, useScope } from "../transport.js";

export function FfmpegTool({ active }: { active: boolean }) {
  const state = useScope("builtin-tools:ffmpeg", emptyFfmpegState), connection = useConnectionState();
  const [sending, setSending] = useState(false), [error, setError] = useState<string>(), [uninstall, setUninstall] = useState(false);
  useEffect(() => {
    if (active && connection.connected) void command("ffmpeg.get").catch((e: Error) => setError(e.message));
  }, [active, connection.connected, connection.generation]);
  const installed = !!state.version;
  const install = componentInstallAction({ label: "FFmpeg", installation: state.error ? "incomplete" : installed ? "installed" : state.revision ? "missing" : "unknown", version: state.version, target: state.latest, repairByReinstall: true });
  async function action(op: string) {
    setSending(true); setError(undefined);
    try { await command(op); } catch (e) { setError((e as Error).message); } finally { setSending(false); }
  }
  const problem = error || state.job?.error || state.error;
  return <article className="supplier-detail tools-detail" id="ffmpeg" aria-labelledby="ffmpeg-heading" style={active ? undefined : { display: "none" }}>
    <div className="tools-content">
      <BackendMaintenance resource="ffmpeg" label="FFmpeg" headingId="ffmpeg-heading" version={state.version || (state.revision ? "未安装" : undefined)} description="本地视频探测、抽帧与媒体预处理" showError={!problem}
        availableVersion={state.latest} availableVersionLabel="最新程序包"
        location={state.directory && <LocalPath path={state.directory} />}
        actions={<ComponentActions context={{ connected: connection.connected, sending, taskRunning: !!state.job?.running }} capabilities={[
          { id: "check-versions", label: "检查程序包版本", support: state.supported ? "supported" : "unsupported", conflictsWithTask: true, execute: () => void action("ffmpeg.check") },
          { ...install, support: state.supported ? "supported" : "unsupported", execute: () => void action("ffmpeg.install") },
          { id: "check-environment", label: "运行自检", applicable: !!state.directory, conflictsWithTask: true, execute: () => void action("ffmpeg.doctor") },
          { id: "uninstall", label: "卸载 FFmpeg", danger: true, execute: () => setUninstall(true) },
        ]} />}
        details={<>
          <p className="maintenance-note">平台 · {state.platform || "读取中"} · 原生双程序，无需 Node/npm 或 Python 环境</p>
          {state.diagnostic && <pre className="maintenance-note">{state.diagnostic.text}</pre>}
        </>}>
        <div className="tools-feedback" aria-live="polite">
          {problem && <p className="tools-error" role="alert">{problem}</p>}
          {state.job && <p role="status">{state.job.message}</p>}
          {!connection.connected && <p>连接已断开，重连后读取当前进度。</p>}
        </div>
        {uninstall && <ComponentConfirmation title="卸载 FFmpeg 与 FFprobe？" description="中止本组件维护操作，直接删除托管程序、配置与专属环境；不等待正在使用它们的任务。视频、已抽取的帧图、技能及系统安装不会删除。" confirmLabel="确认卸载" confirmDisabled={sending || !connection.connected} onClose={() => setUninstall(false)} onConfirm={async () => { setUninstall(false); await action("ffmpeg.uninstall"); }} />}
      </BackendMaintenance>
      <section className="section tools-section" aria-labelledby="ffmpeg-usage-heading">
        <div className="section-heading"><h3 id="ffmpeg-usage-heading">本地视频理解</h3><p>FFprobe 探测 → FFmpeg 按时间抽帧 → 支持图片的模型读取 → 带时间戳总结</p></div>
        <p className="field-help">安装后仅向 Agent 的后续 Bash/PowerShell 命令前置托管双程序路径，不修改系统 PATH、全局包或其他语言环境。普通终端不会自动获得这些命令。</p>
        <p className="field-help">程序来自第三方 shaka-project/static-ffmpeg-binaries 的最新稳定程序包；下载校验 GitHub 发布的 SHA-256，保留 GPLv3 许可、README 和来源记录。程序包标签不等于上游最新版，各架构实际版本请运行自检。安装失败会清理托管文件后重试一次，不能保证保留旧安装。</p>
        <p className="field-help">FFmpeg 本身不理解画面、不提供语音转录。抽帧在本机处理；若使用远程视觉模型，读取的帧图仍会发送给该模型。应限制时长、帧数和图片大小，避免不必要的推理成本。</p>
      </section>
    </div>
  </article>;
}
