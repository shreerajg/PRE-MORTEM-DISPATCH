import * as React from 'react';
import { ShieldAlert } from 'lucide-react';

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
      <div className="flex min-h-screen items-center justify-center bg-paper p-6">
        <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-red-600/15 bg-white shadow-lift">
          <div className="border-b border-red-600/10 bg-red-50/60 p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-red-600/15 bg-white text-red-600">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div className="mt-4 font-mono text-[9.5px] uppercase tracking-[0.2em] text-red-600">Console error</div>
            <h1 className="mt-1.5 text-xl font-semibold tracking-tight text-slate-900">
              Something broke on this screen
            </h1>
          </div>
          <div className="p-6">
            <p className="text-[13px] leading-relaxed text-slate-600">
              Plans and scenarios live on the server, so nothing was lost. Reload to continue, or return to the
              overview.
            </p>
            <pre className="mt-4 max-h-40 overflow-auto rounded-xl border border-white/[0.06] bg-ink-900 p-3 font-mono text-[11.5px] text-slate-100">
              {this.state.error.message}
            </pre>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex items-center rounded-lg bg-slate-900 px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-slate-800"
              >
                Reload console
              </button>
              <a
                href="/"
                className="inline-flex items-center rounded-lg border border-slate-300/80 bg-white px-3.5 py-2 text-[13px] font-medium text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50"
              >
                Back to overview
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
