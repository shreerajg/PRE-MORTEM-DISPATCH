import * as React from 'react';

type Props = { children: React.ReactNode };
type State = { error: Error | null };

/**
 * Last line of defence for render crashes. Server state is untouched, so a
 * reload is a safe recovery path; the message (and request id, when present)
 * gives testers something concrete to report.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Unhandled UI error:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-xl rounded-lg border border-red-200 bg-white p-6 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-red-600">Console error</div>
          <h1 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">Something broke on this screen</h1>
          <p className="mt-2 text-sm text-slate-600">
            Plans and scenarios live on the server, so nothing was lost. Reload to continue, or return to the
            overview.
          </p>
          <pre className="mt-4 max-h-40 overflow-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">
            {this.state.error.message}
          </pre>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700"
            >
              Reload console
            </button>
            <a
              href="/"
              className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              Back to overview
            </a>
          </div>
        </div>
      </div>
    );
  }
}
