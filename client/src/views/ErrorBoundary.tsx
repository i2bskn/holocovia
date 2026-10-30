import { Component, type ReactNode } from "react";

// Keeps an unexpected error while rendering a screen from blanking the whole app.
// Give it the path as key so that it is reset when moving to another screen.
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="main">
        <h1>表示中にエラーが発生しました</h1>
        <button type="button" onClick={() => location.reload()}>
          再読み込み
        </button>
      </main>
    );
  }
}
