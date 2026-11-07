import * as React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ArrowUpRight,
  LockKeyhole,
  Menu,
  Shield,
} from 'lucide-react';
import { authStatus, getOperatorToken, health } from '../lib/api';
import { cn } from '../lib/utils';
import { useWorkspacePulse } from '../lib/useWorkspacePulse';
import { CONSOLE_NAV, ConsoleNav, isNavActive } from './ConsoleNav';
import { Drawer } from './ui/drawer';

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
  const pulse = useWorkspacePulse();
  const [menuOpen, setMenuOpen] = React.useState(false);

  const current = CONSOLE_NAV.find((item) => isNavActive(location.pathname, item.to));
  const stepIndex = current?.step ?? -1;

  // The drawer is transient UI: it must not survive a navigation or a resize
  // into the desktop layout, where the rail is permanently visible anyway.
  React.useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  React.useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const onChange = () => {
      if (media.matches) setMenuOpen(false);
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

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
      <a
        href="#main-content"
        className="sr-only z-[100] rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to main content
      </a>

      {/* Dark operations rail — fixed, and reading live workspace state */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[264px] flex-col overflow-hidden bg-ink-900 text-slate-300 md:flex">
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

        <div className="relative flex-1 overflow-y-auto">
          <ConsoleNav pathname={location.pathname} />
        </div>

        <div className="relative border-t border-white/[0.06] px-5 py-4">
          <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.14em] text-white/25">
            <span>v1.0</span>
            <span>{h?.solver ?? 'engine'}</span>
          </div>
        </div>
      </aside>

      <div className="md:pl-[264px]">
        <header className="sticky top-0 z-30 border-b border-slate-900/[0.06] bg-paper/80 backdrop-blur-xl">
          <div className="flex h-16 items-center justify-between gap-3 px-4 md:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setMenuOpen(true)}
                aria-label="Open console menu"
                aria-expanded={menuOpen}
                aria-controls="console-menu"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-900/[0.08] bg-white text-slate-700 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-colors hover:border-slate-400 md:hidden"
              >
                <Menu className="h-4 w-4" />
              </button>
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

        {/* Small screens: the pipeline stays pinned instead of a chip strip that
            scrolls the destinations off the edge of the phone. */}
        <div className="sticky top-16 z-20 flex items-center gap-3 border-b border-slate-900/[0.06] bg-paper/90 px-4 py-2 backdrop-blur md:hidden">
          <div className="flex shrink-0 items-center gap-1">
            {pulse.steps.map((step, index) => (
              <Link
                key={step.id}
                to={step.to}
                title={`${step.label} — ${step.done ? 'complete' : 'pending'}`}
                aria-label={`${step.label}: ${step.done ? 'complete' : 'pending'}`}
                className={cn(
                  'h-1.5 w-5 rounded-full transition-colors',
                  step.done ? 'bg-emerald-500/60' : 'bg-slate-900/10',
                  index === stepIndex && 'bg-emerald-600',
                )}
              />
            ))}
          </div>
          <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-slate-400">
            {stepIndex >= 0 ? pulse.steps[stepIndex].label : `${pulse.readyCount}/6`}
          </span>
          <span className="min-w-0 flex-1 truncate text-right text-[11px] text-slate-500">
            {pulse.activeDataset?.name ?? 'No dataset loaded'}
          </span>
        </div>

        <main id="main-content" className="relative min-h-[calc(100vh-4rem)]">
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

      <Drawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title="Pre-Mortem Dispatch"
      >
        <div id="console-menu" className="flex-1 overflow-y-auto">
          <ConsoleNav pathname={location.pathname} onNavigate={() => setMenuOpen(false)} />
        </div>
        <div className="border-t border-white/[0.06] px-5 py-4 font-mono text-[9px] uppercase tracking-[0.14em] text-white/25">
          v1.0 · {h?.solver ?? 'engine'}
        </div>
      </Drawer>
    </div>
  );
}
