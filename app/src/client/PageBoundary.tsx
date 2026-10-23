import { Component, type ErrorInfo, type ReactNode } from "react";
import "./styles/page-error.css";

/** A failed render must leave a recovery action instead of an empty desktop WebView. */
export class PageBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.stack || error.message : String(error) };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Axiom page render failure", error, info.componentStack);
  }
  render() {
    if (this.state.error === null) return this.props.children;
    return <main className="app page-error" role="alert">
      <h1>页面显示遇到问题</h1>
      <p>可以尝试恢复页面。后台会话不会因此停止。</p>
      <button type="button" onClick={() => this.setState({ error: null })}>恢复页面</button>
      <details><summary>错误详情</summary><pre>{this.state.error.slice(0, 2000)}</pre></details>
    </main>;
  }
}
