import { Link, NavLink } from 'react-router-dom';
import {
  ArrowRight,
  Calculator,
  Check,
  Database,
  Download,
  GitCompare,
  HeartPulse,
  LayoutDashboard,
  ShieldCheck,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { useWorkspacePulse, type WorkspacePulse } from '../lib/useWorkspacePulse';
import { cn, relativeTime, scenarioTitle } from '../lib/utils';

export const CONSOLE_NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, step: null },
  { to: '/datasets', label: 'Datasets', icon: Database, step: 0 },
  { to: '/planner', label: 'Planner', icon: Calculator, step: 1 },
  { to: '/resilience', label: 'Resilience', icon: ShieldCheck, step: null },
  { to: '/disruption', label: 'Disruption Lab', icon: Zap, step: 2 },
  { to: '/recovery', label: 'Recovery', icon: HeartPulse, step: 3 },
  { to: '/compare', label: 'Compare', icon: GitCompare, step: 4 },
  { to: '/insights', label: 'Insights', icon: TrendingUp, step: null },
  { to: '/exports', label: 'Exports', icon: Download, step: 5 },
] as const;

export function isNavActive(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(to + '/');
}

/** Right-hand counter, or null when there is nothing worth counting yet. */
function itemBadge(to: string, pulse: WorkspacePulse): string | null {
  switch (to) {
    case '/dashboard':
      return `${pulse.readyCount}/6`;
    case '/datasets':
      return pulse.datasets.length ? String(pulse.datasets.length) : null;
    case '/planner':
      return pulse.baselines.length ? String(pulse.baselines.length) : null;
    case '/disruption':
      return pulse.scenarios.length ? String(pulse.scenarios.length) : null;
    case '/recovery':
      return pulse.scenarios.length ? `${pulse.recovered.length}/${pulse.scenarios.length}` : null;
    case '/compare':
      return pulse.recovered.length ? String(pulse.recovered.length) : null;
    case '/exports':
      return pulse.plans.length ? String(pulse.plans.length) : null;
    default:
      return null;
  }
}

/** Second line under each destination: what is actually in there right now. */
function itemMeta(to: string, pulse: WorkspacePulse): string {
  const latestBaseline = pulse.baselines[0];
  switch (to) {
    case '/dashboard':
      return pulse.scenarios.length
        ? `${pulse.scenarios.length} scenario${pulse.scenarios.length === 1 ? '' : 's'} on record`
        : 'Workspace at a glance';
    case '/datasets':
      return pulse.activeDataset ? `Active · ${pulse.activeDataset.name}` : 'No dataset loaded yet';
    case '/planner':
      return latestBaseline
        ? `${(latestBaseline.kpis.fulfillment_rate * 100).toFixed(1)}% fulfilled · ${latestBaseline.solver}`
        : 'No baseline solved yet';
    case '/resilience':
      return latestBaseline
        ? 'Check single-source and headroom risks'
        : 'Solve a baseline first';
    case '/disruption':
      return pulse.activeScenario ? `Latest · ${scenarioTitle(pulse.activeScenario)}` : 'Nothing broken yet';
    case '/recovery':
      return pulse.recovered.length
        ? `${pulse.recovered.length} recovered plan${pulse.recovered.length === 1 ? '' : 's'}`
        : 'Contingency lanes on standby';
    case '/compare':
      return pulse.recovered.length ? 'Baseline vs disrupted vs recovered' : 'Needs a recovered run';
    case '/insights':
      return pulse.lastEvent
        ? `${pulse.lastEvent.action} · ${relativeTime(pulse.lastEvent.at)}`
        : 'Trends, mix and audit trail';
    case '/exports':
      return pulse.plans.length ? 'CSV built from stored plans' : 'Nothing to export yet';
    default:
      return '';
  }
}

type ConsoleNavProps = {
  pathname: string;
  onNavigate?: () => void;
};

/**
 * The console menu. Fixed in the desktop rail and reused inside the mobile
 * drawer, it renders live workspace state — counters, the active dataset and
 * scenario, real pipeline completion and the next useful action — so it reads
 * as an instrument panel rather than a static list of links.
 */
export function ConsoleNav({ pathname, onNavigate }: ConsoleNavProps) {
  const pulse = useWorkspacePulse();
  const currentStep = CONSOLE_NAV.find((item) => isNavActive(pathname, item.to))?.step ?? -1;

  return (
    <div className="flex min-h-full flex-col">
      <nav aria-label="Primary" className="px-3 pt-5">
        <div className="px-2 font-mono text-[9px] uppercase tracking-[0.24em] text-white/25">
          Operations
        </div>
        <div className="mt-2 space-y-0.5">
          {CONSOLE_NAV.map((item, index) => {
            const active = isNavActive(pathname, item.to);
            const badge = itemBadge(item.to, pulse);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onNavigate}
                className={cn(
                  'group relative flex items-center gap-3 rounded-xl px-2.5 py-2 transition-all duration-150',
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
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12.5px] font-medium">{item.label}</span>
                    {badge ? (
                      <span className="shrink-0 rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-[9px] tabular text-white/60">
                        {badge}
                      </span>
                    ) : (
                      <span className="shrink-0 font-mono text-[9px] tabular text-white/20">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                    )}
                  </span>
                  <span
                    className={cn(
                      'mt-0.5 block truncate text-[10px]',
                      active ? 'text-white/45' : 'text-white/25 group-hover:text-white/40',
                    )}
                  >
                    {itemMeta(item.to, pulse)}
                  </span>
                </span>
              </NavLink>
            );
          })}
        </div>
      </nav>

      <div className="mt-5 px-3">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/35">
              Pipeline
            </span>
            <span className="font-mono text-[9px] tabular text-white/25">
              {pulse.readyCount}/6 ready
            </span>
          </div>
          <div className="mt-2.5 flex gap-1">
            {pulse.steps.map((step, index) => (
              <Link
                key={step.id}
                to={step.to}
                onClick={onNavigate}
                title={`${step.label} — ${step.done ? 'complete' : 'pending'}`}
                aria-label={`${step.label}: ${step.done ? 'complete' : 'pending'}`}
                className={cn(
                  'h-1 flex-1 rounded-full transition-all hover:h-1.5',
                  step.done ? 'bg-emerald-400/60' : 'bg-white/10',
                  index === currentStep && 'bg-emerald-400 ring-2 ring-emerald-400/20',
                )}
              />
            ))}
          </div>
          <p className="mt-2.5 text-[10.5px] leading-relaxed text-white/30">
            {currentStep >= 0
              ? `${pulse.steps[currentStep].label} · step ${currentStep + 1} of 6`
              : 'Load, plan, break, recover, compare, export.'}
          </p>
        </div>
      </div>

      <div className="mt-3 px-3 pb-5">
        <div className="rounded-xl border border-emerald-400/[0.12] bg-emerald-400/[0.045] p-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-emerald-200/50">
              In this workspace
            </span>
            {pulse.lastEvent ? (
              <span className="font-mono text-[9px] text-white/25">
                {relativeTime(pulse.lastEvent.at)}
              </span>
            ) : null}
          </div>
          <dl className="mt-2 space-y-1.5 text-[10.5px]">
            <div className="flex items-baseline justify-between gap-2">
              <dt className="shrink-0 text-white/30">Dataset</dt>
              <dd className="truncate text-white/70">
                {pulse.activeDataset?.name ?? (pulse.isLoading ? 'Reading…' : 'none loaded')}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="shrink-0 text-white/30">Scenario</dt>
              <dd className="truncate text-white/70">
                {pulse.activeScenario ? scenarioTitle(pulse.activeScenario) : 'none simulated'}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="shrink-0 text-white/30">Recovered</dt>
              <dd className="flex items-center gap-1 truncate text-white/70">
                {pulse.recovered.length ? (
                  <Check className="h-3 w-3 shrink-0 text-emerald-300" />
                ) : null}
                {pulse.recovered.length}/{pulse.scenarios.length}
              </dd>
            </div>
          </dl>
          <Link
            to={pulse.next.to}
            onClick={onNavigate}
            className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-emerald-400/90 px-2.5 py-2 text-[11.5px] font-semibold text-ink-950 transition-colors hover:bg-emerald-300"
          >
            <span className="truncate">{pulse.next.label}</span>
            <ArrowRight className="h-3.5 w-3.5 shrink-0" />
          </Link>
          {pulse.lastEvent ? (
            <p className="mt-2 truncate font-mono text-[9px] text-white/25" title={pulse.lastEvent.action}>
              last · {pulse.lastEvent.action}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
