import { Component, type ReactNode, type ErrorInfo } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ErrorBoundary] Caught error:", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            padding: "2rem",
            fontFamily: "system-ui, sans-serif",
            backgroundColor: "var(--bg-primary, #fff)",
            color: "var(--text-primary, #333)",
          }}
        >
          <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>⚠</div>
          <h1 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>
            Something went wrong
          </h1>
          <p style={{ color: "var(--text-secondary, #666)", marginBottom: "1.5rem", textAlign: "center", maxWidth: "480px" }}>
            An unexpected error occurred. The application state has been preserved and you can try to recover.
          </p>
          <pre
            style={{
              backgroundColor: "var(--bg-secondary, #f5f5f5)",
              padding: "1rem",
              borderRadius: "8px",
              fontSize: "0.8rem",
              maxWidth: "100%",
              overflow: "auto",
              maxHeight: "200px",
            }}
          >
            {this.state.error?.message || "Unknown error"}
          </pre>
          <button
            onClick={this.handleReset}
            style={{
              marginTop: "1.5rem",
              padding: "0.5rem 1.5rem",
              border: "none",
              borderRadius: "6px",
              backgroundColor: "var(--accent-color, #0066ff)",
              color: "#fff",
              cursor: "pointer",
              fontSize: "0.9rem",
            }}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
