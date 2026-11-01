import * as React from 'react';
import { ArrowRight } from 'lucide-react';
import type { KPISnapshot } from '../lib/api';
import { cn } from '../lib/utils';

export type JourneyTone = 'neutral' | 'bad' | 'good';

export type JourneyPhase = {
  key: string;
  label: string;
  kpis?: KPISnapshot | null;
  tone?: JourneyTone;
  pending?: string;
};

const TONE: Record<JourneyTone, { dot: string; bar: string; value: string }> = {
  neutral: { dot: 'bg-slate-800', bar: 'bg-slate-800', value: 'text-slate-900' },
  bad: { dot: 'bg-red-500', bar: 'bg-red-500', value: 'text-red-600' },
  good: { dot: 'bg-emerald-500', bar: 'bg-emerald-500', value: 'text-emerald-700' },
};

const money = (v: number) => `$${Math.round(v).toLocaleString()}`;

/** Baseline → disrupted → recovered, drawn from the same KPIs the tables show. */
export function PlanJourney({ phases, className }: { phases: JourneyPhase[]; className?: string }) {
  return (
    <div
      className={cn('grid items-stretch gap-2 md:grid-cols-[1fr_auto_1fr_auto_1fr]', className)}
      role="list"
      aria-label="Plan journey"
    >
      {phases.map((phase, index) => {
        const tone = TONE[phase.tone ?? 'neutral'];
        const kpis = phase.kpis;
        return (
          <React.Fragment key={phase.key}>
            <div
              role="listitem"
              className={cn(
                'relative overflow-hidden rounded-xl border p-4',
                kpis
                  ? 'border-slate-900/[0.07] bg-white'
                  : 'border-dashed border-slate-300/80 bg-slate-50/50',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-slate-400">
                  {phase.label}
                </span>
                <span className={cn('h-1.5 w-1.5 rounded-full', kpis ? tone.dot : 'bg-slate-300')} />
              </div>

              {kpis ? (
                <>
                  <div className="mt-2 flex items-baseline gap-1.5">
                    <span className={cn('text-[1.6rem] font-semibold leading-none tracking-[-0.02em] tabular', tone.value)}>
                      {(kpis.fulfillment_rate * 100).toFixed(1)}%
                    </span>
                    <span className="text-[10.5px] text-slate-400">fulfilled</span>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-900/[0.06]">
                    <div
                      className={cn('h-full origin-left rounded-full', tone.bar)}
                      style={{ width: `${Math.max(0, Math.min(1, kpis.fulfillment_rate)) * 100}%` }}
                    />
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2">
                    <div>
                      <dt className="text-[9.5px] uppercase tracking-[0.12em] text-slate-400">unmet</dt>
                      <dd className="mt-0.5 text-[12px] font-medium tabular text-slate-700">
                        {Math.round(kpis.unmet).toLocaleString()}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[9.5px] uppercase tracking-[0.12em] text-slate-400">cost</dt>
                      <dd className="mt-0.5 text-[12px] font-medium tabular text-slate-700">
                        {money(kpis.total_cost)}
                      </dd>
                    </div>
                  </dl>
                </>
              ) : (
                <div className="mt-3 flex min-h-[62px] items-center text-[12px] leading-relaxed text-slate-400">
                  {phase.pending ?? 'Not run yet.'}
                </div>
              )}
            </div>

            {index < phases.length - 1 ? (
              <div className="hidden items-center justify-center px-0.5 text-slate-300 md:flex" aria-hidden>
                <ArrowRight className="h-4 w-4" />
              </div>
            ) : null}
          </React.Fragment>
        );
      })}
    </div>
  );
}
