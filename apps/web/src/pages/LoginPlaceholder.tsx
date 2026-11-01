import * as React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Fingerprint, LogIn, Shield, ShieldCheck } from 'lucide-react';

/**
 * Placeholder for `/login`.
 *
 * The Firebase authentication module is owned by another workstream. This page
 * exists only so the "Sign in" affordances on the landing page never lead
 * anywhere dead before that module lands.
 *
 * ── To wire up real auth ────────────────────────────────────────────────
 * Option A: replace this component's body with the team's Firebase sign-in UI.
 * Option B: leave the repo alone and set `VITE_LOGIN_URL` in `.env` to the
 *           auth route or hosted URL — the landing page reads that value and
 *           this placeholder stops being reachable.
 */
export default function LoginPlaceholder() {
  const rawTarget = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_LOGIN_URL;
  const target = typeof rawTarget === 'string' && rawTarget.trim() ? rawTarget.trim() : '(not configured)';

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
                ['Identity is owned elsewhere', 'Firebase handles accounts; this console stays usable without one.'],
                ['No data leaves the model', 'Plans and scenarios are stored in the local workspace database.'],
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
              <Fingerprint className="h-5 w-5 text-slate-500" />
            </div>
            <h1 className="mt-5 text-2xl font-semibold tracking-[-0.02em]">Sign in</h1>
            <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-slate-500">
              Authentication is being wired up by the team&apos;s Firebase module. This page is a placeholder so the
              &ldquo;Sign in&rdquo; button never leads anywhere dead.
            </p>

            <div className="mt-6 rounded-xl border border-slate-900/[0.07] bg-slate-50/70 p-3.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-slate-400">
                  VITE_LOGIN_URL
                </span>
                <span className="rounded-full bg-amber-50 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-amber-700 ring-1 ring-inset ring-amber-600/20">
                  pending
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
          </div>
        </div>
      </div>
    </div>
  );
}
