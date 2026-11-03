import * as React from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ArrowUpRight,
  Calculator,
  Database,
  Download,
  GitCompare,
  HeartPulse,
  LayoutDashboard,
  LockKeyhole,
  Shield,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { authStatus, getOperatorToken, health } from '../lib/api';
import { cn } from '../lib/utils';

const nav = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, step: null },
  { to: '/datasets', label: 'Datasets', icon: Database, step: 0 },
  { to: '/planner', label: 'Planner', icon: Calculator, step: 1 },
  { to: '/disruption', label: 'Disruption Lab', icon: Zap, step: 2 },
  { to: '/recovery', label: 'Recovery', icon: HeartPulse, step: 3 },
  { to: '/compare', label: 'Compare', icon: GitCompare, step: 4 },
  { to: '/insights', label: 'Insights', icon: TrendingUp, step: null },
  { to: '/exports', label: 'Exports', icon: Download, step: 5 },
];

const PIPELINE = ['Load', 'Plan', 'Break', 'Recover', 'Compare', 'Export'];

export function Layout({ children }: { children: React.ReactNode }) {
  const { data: h, isError: healthError } = useQuery({
    queryKey: ['health'],
    queryFn: health,
    refetchInterval: 15000,
    retry: false,
  });
  const { data: auth } = useQuery({
    queryKey: ['auth-status'],
    queryFn: authStatus,
    retry: false,
    staleTime: 60_000,
  });
  const locked = auth?.required === true && !getOperatorToken();
  const location = useLocation();

  const isActive = (to: string) => location.pathname === to || location.pathname.startsWith(to + '/');
  const current = nav.find((item) => isActive(item.to));
  const stepIndex = current?.step ?? -1;

  // Three honest states: healthy, degraded (API answered but something is
  // wrong, e.g. the database), or unreachable (no answer at all).
  const healthState: 'ok' | 'degraded' | 'unreachable' | 'checking' = healthError
    ? 'unreachable'
    : !h
      ? 'checking'
      : h.status === 'ok' && h.db === 'ok'
        ? 'ok'
        : 'degraded';

  const healthTone = {
    ok: 'border-emerald-600/15 bg-emerald-50 text-emerald-700',
    degraded: 'border-amber-600/20 bg-amber-50 text-amber-700',
    unreachable: 'border-red-600/15 bg-red-50 text-red-700',
    checking: 'border-slate-900/[0.08] bg-white text-slate-500',
  }[healthState];

  const healthDot = {
    ok: 'bg-emerald-500',
    degraded: 'bg-amber-500',
    unreachable: 'bg-red-500',
    checking: 'bg-slate-300',
  }[healthState];

  const healthLabel = {
    ok: 'API healthy',
    degraded: 'API degraded',
    unreachable: 'API unreachable',
    checking: 'Checking…',
  }[healthState];

  return (
    <div className="min-h-screen bg-paper text-slate-900">
      {/* Dark operations rail — the console's anchor */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[252px] flex-col overflow-hidden bg-ink-900 text-slate-300 md:flex">
        <div aria-hidden className="noise-rail pointer-events-none absolute inset-0 opacity-[0.035]" />
        <div
          aria-hidden
          className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full bg-emerald-400/[0.10] blur-3xl"
        />

        <Link
          to="/"
          className="relative flex h-16 shrink-0 items-center gap-3 border-b border-white/[0.06] px-5 transition-colors hover:bg-white/[0.02]"
          title="Back to overview"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 text-ink-950 shadow-[0_8px_20px_-8px_rgba(16,185,129,0.7)]">
            <Shield className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold tracking-tight text-white">
              Pre-Mortem Dispatch
            </span>
            <span className="mt-0.5 block font-mono text-[9px] uppercase tracking-[0.16em] text-white/35">
              resilience console
            </span>
          </span>
        </Link>

        <nav className="relative flex-1 overflow-y-auto px-3 py-5" aria-label="Primary">
          <div className="px-2 font-mono text-[9px] uppercase tracking-[0.24em] text-white/25">Operations</div>
          <div className="mt-2 space-y-0.5">
            {nav.map((item, index) => {
              const active = isActive(item.to);
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={cn(
                    'group relative flex items-center gap-3 rounded-xl px-2.5 py-2 text-[12.5px] font-medium transition-all duration-150',
                    active
                      ? 'bg-white/[0.07] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                      : 'text-white/50 hover:bg-white/[0.035] hover:text-white/85',
                  )}
                >
                  {active ? (
                    <span className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-emerald-400" />
                  ) : null}
                  <span
                    className={cn(
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-colors',
                      active
                        ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300'
                        : 'border-white/[0.06] bg-white/[0.02] text-white/35 group-hover:text-white/70',
                    )}
                  >
                    <item.icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  <span className="font-mono text-[9px] tabular text-white/20">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                </NavLink>
              );
            })}
          </div>

          <div className="mt-6 rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/35">Pipeline</span>
              <span className="font-mono text-[9px] tabular text-white/25">
                {stepIndex >= 0 ? `${stepIndex + 1}/6` : 'idle'}
              </span>
            </div>
            <div className="mt-2.5 flex gap-1">
              {PIPELINE.map((label, i) => (
                <span
                  key={label}
                  title={label}
                  className={cn(
                    'h-1 flex-1 rounded-full transition-colors',
                    i < stepIndex
                      ? 'bg-emerald-400/50'
                      : i === stepIndex
                        ? 'bg-emerald-400'
                        : 'bg-white/10',
                  )}
                />
              ))}
            </div>
            <p className="mt-2.5 text-[10.5px] leading-relaxed text-white/30">
              {stepIndex >= 0
                ? `${PIPELINE[stepIndex]} · step ${stepIndex + 1} of 6`
                : 'Load, plan, break, recover, compare, export.'}
            </p>
          </div>
        </nav>

        <div className="relative border-t border-white/[0.06] px-5 py-4">
          <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.14em] text-white/25">
            <span>v1.0</span>
            <span>{h?.solver ?? 'engine'}</span>
          </div>
        </div>
      </aside>

      <div className="md:pl-[252px]">
        <header className="sticky top-0 z-30 border-b border-slate-900/[0.06] bg-paper/80 backdrop-blur-xl">
          <div className="flex h-16 items-center justify-between gap-3 px-4 md:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <Link
                to="/"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-900 text-white md:hidden"
                aria-label="Pre-Mortem Dispatch overview"
              >
                <Shield className="h-4 w-4" />
              </Link>
              <div className="min-w-0">
                <div className="hidden items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.18em] text-slate-400 sm:flex">
                  <span>Console</span>
                  <span className="text-slate-300">/</span>
                  <span className="text-slate-600">{current?.label ?? 'Dashboard'}</span>
                </div>
                <div className="truncate text-[13px] font-semibold tracking-tight text-slate-900 sm:hidden">
                  {current?.label ?? 'Dashboard'}
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {locked ? (
                <Link
                  to="/login"
                  className="inline-flex items-center gap-1.5 rounded-full border border-amber-600/20 bg-amber-50 px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-amber-700 transition-colors hover:border-amber-600/40"
                >
                  <LockKeyhole className="h-3 w-3" />
                  Unlock
                </Link>
              ) : null}
              <div
                role="status"
                aria-live="polite"
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.12em]',
                  healthTone,
                )}
                title={h ? JSON.stringify(h) : healthError ? 'No response from the API' : 'checking…'}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', healthDot)} />
                {healthLabel}
                {h?.solver ? <span className="hidden opacity-60 sm:inline">· {h.solver}</span> : null}
              </div>
              <a
                href="/"
                className="hidden items-center gap-1.5 rounded-lg border border-slate-300/80 bg-white px-2.5 py-1.5 text-[11.5px] font-medium text-slate-600 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-colors hover:border-slate-400 hover:text-slate-900 sm:inline-flex"
              >
                Overview
                <ArrowUpRight className="h-3 w-3" />
              </a>
            </div>
          </div>
        </header>

        {/* Mobile navigation: same destinations, one horizontal rail */}
        <div className="sticky top-16 z-20 flex gap-1 overflow-x-auto border-b border-slate-900/[0.06] bg-paper/90 p-2 backdrop-blur md:hidden">
          {nav.map((item) => {
            const active = isActive(item.to);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[11.5px] font-medium transition-colors',
                  active
                    ? 'bg-ink-900 text-white shadow-sm'
                    : 'border border-slate-900/[0.06] bg-white text-slate-600',
                )}
              >
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
              </NavLink>
            );
          })}
        </div>

        <main className="relative min-h-[calc(100vh-4rem)]">
          <div aria-hidden className="panel-grid pointer-events-none absolute inset-x-0 top-0 h-[420px]" />
          <div className="relative mx-auto max-w-[1500px] px-4 pb-16 pt-6 md:px-8 md:pt-8">
            <div key={location.pathname} className="animate-page-in">
              {children}
            </div>
          </div>
          <footer className="relative border-t border-slate-900/[0.05] px-4 py-5 md:px-8">
            <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-2 font-mono text-[9.5px] uppercase tracking-[0.14em] text-slate-400">
              <span className="flex items-center gap-1.5">
                <Activity className="h-3 w-3" />
                Every figure computed · nothing narrated
              </span>
              <span>TRIWIZATHON 2026</span>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}
