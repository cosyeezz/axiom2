import { Component, type ErrorInfo, type ReactNode } from "react";
export default class StartupBoundary extends Component<{ children: ReactNode }, { error: string; copied: boolean }> {
  state = { error: "", copied: false };
  static getDerivedStateFromError(error: unknown) { return { error: error instanceof Error ? error.message : String(error) }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Axiom startup render failure", error, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return <main className="startup-fallback" role="alert"><span>AXIOM 2 / DESKTOP</span><h1>连接页面未能正常显示</h1><p>后台任务可能仍在运行。可以重新加载页面，或复制诊断信息。</p><pre>{this.state.error.slice(0, 2000)}</pre><div><button onClick={() => location.reload()}>重新加载</button><button onClick={() => void navigator.clipboard.writeText(`Axiom desktop startup\n${new Date().toISOString()}\n${this.state.error}`).then(() => this.setState({ copied: true }), () => {})}>{this.state.copied ? "已复制诊断" : "复制诊断"}</button></div></main>;
  }
}
