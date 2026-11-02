import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Fingerprint,
  KeyRound,
  LockKeyhole,
  LogIn,
  Shield,
  ShieldCheck,
  Unlock,
} from 'lucide-react';
import {
  authCheck,
  authStatus,
  clearOperatorToken,
  getOperatorToken,
  setOperatorToken,
} from '../lib/api';

/**
 * Sign-in entry point.
 *
 * Two honest modes:
 *  - No API_TOKEN configured: the demo console needs no account, so this page
 *    explains the Firebase hand-off and lets you continue.
 *  - API_TOKEN configured: the deployment is gated by a shared operator token,
 *    verified against /auth/check and kept in sessionStorage only.
 *
 * To merge the Firebase module, replace this component with the real sign-in UI
 * or set VITE_LOGIN_URL to the hosted route — the landing page needs no edits.
 */
export default function LoginPlaceholder() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const expired = searchParams.get('reason') === 'expired';
  const rawTarget = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_LOGIN_URL;
  const target = typeof rawTarget === 'string' && rawTarget.trim() ? rawTarget.trim() : '(not configured)';

  const { data: auth, isLoading, isError } = useQuery({
    queryKey: ['auth-status'],
    queryFn: authStatus,
    retry: false,
    staleTime: 30_000,
  });
  const [token, setToken] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [storedToken, setStoredToken] = React.useState<string | null>(() => getOperatorToken());

  const required = auth?.required === true;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const candidate = token.trim();
    if (!candidate) {
      setError('Enter the operator token configured for this deployment.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await authCheck(candidate);
      setOperatorToken(candidate);
      setStoredToken(candidate);
      navigate('/dashboard');
    } catch (err) {
      setError(String((err as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const forget = () => {
    clearOperatorToken();
    setStoredToken(null);
    setToken('');
    setError(null);
  };

  return (
    <div className="min-h-screen bg-paper text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-5xl items-stretch px-4 py-6 sm:px-6 lg:py-10">
        <div className="grid w-full overflow-hidden rounded-3xl border border-slate-900/[0.07] bg-white shadow-lift lg:grid-cols-[1.05fr_0.95fr]">
          {/* Brand panel */}
          <div className="relative hidden flex-col justify-between overflow-hidden bg-ink-900 p-10 text-white lg:flex">
            <div aria-hidden className="noise-rail pointer-events-none absolute inset-0 opacity-[0.04]" />
            <div
              aria-hidden
              className="animate-aurora pointer-events-none absolute -left-20 top-1/4 h-80 w-80 rounded-full bg-emerald-400/[0.14] blur-[90px]"
            />
            <div className="relative">
              <Link to="/" className="inline-flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 text-ink-950">
                  <Shield className="h-4 w-4" />
                </span>
                <span className="text-sm font-semibold tracking-tight">Pre-Mortem Dispatch</span>
              </Link>
              <p className="mt-16 max-w-sm text-3xl font-semibold leading-[1.12] tracking-[-0.03em]">
                Know what breaks
                <br />
                <span className="text-white/40">before it breaks.</span>
              </p>
              <p className="mt-4 max-w-sm text-[13px] leading-relaxed text-white/45">
                A distribution model you can break on purpose: constrained plans, computed impact, priced recovery.
              </p>
            </div>

            <div className="relative space-y-3">
              {[
                ['Optional operator gate', 'Set API_TOKEN to require a shared key; leave it empty for the open demo.'],
                ['No hidden data movement', 'Plans and scenarios stay in the workspace database behind this API.'],
              ].map(([title, body]) => (
                <div key={title} className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300/80" />
                  <div>
                    <div className="text-[12px] font-medium text-white/85">{title}</div>
                    <div className="mt-0.5 text-[11px] leading-relaxed text-white/35">{body}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Form panel */}
          <div className="flex flex-col justify-center p-7 sm:p-10">
            <div className="flex items-center gap-2.5 lg:hidden">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-900 text-white">
                <Shield className="h-4 w-4" />
              </span>
              <span className="text-sm font-semibold tracking-tight">Pre-Mortem Dispatch</span>
            </div>

            <div className="mt-6 flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-900/[0.07] bg-slate-50 lg:mt-0">
              {required ? (
                <LockKeyhole className="h-5 w-5 text-slate-500" />
              ) : (
                <Fingerprint className="h-5 w-5 text-slate-500" />
              )}
            </div>

            <h1 className="mt-5 text-2xl font-semibold tracking-[-0.02em]">Sign in</h1>

            {isLoading ? (
              <p className="mt-4 text-[13px] text-slate-500">Checking this deployment&apos;s access policy…</p>
            ) : required ? (
              <div className="mt-4">
                <p className="max-w-sm text-[13px] leading-relaxed text-slate-500">
                  This deployment is gated by a shared operator token. It is kept in this browser tab only and is
                  never written into the application bundle.
                </p>

                {expired ? (
                  <p className="mt-3 rounded-lg border border-amber-600/20 bg-amber-50 px-3 py-2 text-[11.5px] leading-relaxed text-amber-800">
                    The stored token was rejected. Enter the current <span className="font-mono">API_TOKEN</span>.
                  </p>
                ) : null}

                {storedToken ? (
                  <div className="mt-5 rounded-xl border border-emerald-600/15 bg-emerald-50 p-3.5">
                    <div className="flex items-center gap-2 text-[12px] font-medium text-emerald-800">
                      <Unlock className="h-4 w-4" /> A token is stored in this tab
                    </div>
                    <div className="mt-1 font-mono text-[10.5px] text-emerald-700/70">
                      {storedToken.slice(0, 4)}…{storedToken.slice(-4)}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => navigate('/dashboard')}
                        className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3.5 py-2 text-[12.5px] font-medium text-white transition-colors hover:bg-slate-800"
                      >
                        Continue to console <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={forget}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-300/80 bg-white px-3.5 py-2 text-[12.5px] text-slate-600 transition-colors hover:border-slate-400 hover:text-slate-900"
                      >
                        Clear token
                      </button>
                    </div>
                  </div>
                ) : null}

                <form onSubmit={submit} className="mt-5">
                  <label htmlFor="operator-token" className="mb-1.5 block text-[11px] font-medium text-slate-600">
                    Operator token
                  </label>
                  <div className="relative">
                    <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      id="operator-token"
                      type="password"
                      autoComplete="current-password"
                      value={token}
                      onChange={(event) => setToken(event.target.value)}
                      placeholder="Paste the API_TOKEN value"
                      className="flex h-10 w-full rounded-lg border border-slate-300/80 bg-white pl-9 pr-3 text-[13px] shadow-[0_1px_2px_rgba(16,24,40,0.03)] transition-colors placeholder:text-slate-400 hover:border-slate-400/80 focus:border-emerald-500/70 focus:outline-none focus:ring-4 focus:ring-emerald-500/10"
                    />
                  </div>
                  {error ? (
                    <p className="mt-2 rounded-lg border border-red-600/15 bg-red-50 px-3 py-2 text-[11.5px] text-red-700">
                      {error}
                    </p>
                  ) : null}
                  <button
                    type="submit"
                    disabled={busy}
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-[13px] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_10px_24px_-16px_rgba(15,23,42,0.6)] transition-all hover:bg-slate-800 disabled:pointer-events-none disabled:opacity-50"
                  >
                    {busy ? 'Verifying…' : 'Unlock console'}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </form>

                <Link
                  to="/"
                  className="mt-5 inline-flex items-center gap-1.5 text-[12px] text-slate-500 transition-colors hover:text-slate-900"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Back to overview
                </Link>
              </div>
            ) : (
              <>
                <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-slate-500">
                  {isError
                    ? 'The access policy could not be loaded, so the console remains open in demo mode.'
                    : 'Authentication is being wired up by the team’s Firebase module. This page is a placeholder so the “Sign in” button never leads anywhere dead.'}
                </p>

                <div className="mt-5 rounded-xl border border-slate-900/[0.07] bg-slate-50/70 p-3.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-slate-400">VITE_LOGIN_URL</span>
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-amber-700 ring-1 ring-inset ring-amber-600/20">
                      not required
                    </span>
                  </div>
                  <div className="mt-1.5 break-all font-mono text-[12px] text-slate-700">{target}</div>
                </div>

                <p className="mt-4 text-[12px] leading-relaxed text-slate-500">
                  The console runs without an account today. You can continue straight through.
                </p>

                <div className="mt-6 flex flex-wrap gap-2">
                  <Link
                    to="/dashboard"
                    className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-[13px] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_10px_24px_-16px_rgba(15,23,42,0.6)] transition-all hover:-translate-y-px hover:bg-slate-800"
                  >
                    Continue to console
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                  <Link
                    to="/"
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-300/80 bg-white px-4 py-2.5 text-[13px] text-slate-700 transition-colors hover:border-slate-400 hover:text-slate-900"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back
                  </Link>
                </div>

                <div className="mt-8 flex items-center gap-2 border-t border-slate-900/[0.06] pt-4 font-mono text-[9.5px] uppercase tracking-[0.16em] text-slate-400">
                  <LogIn className="h-3 w-3" />
                  awaiting firebase module
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
