import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../lib/utils';

export type StatTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const TONES: Record<
  StatTone,
  { chip: string; value: string; bar: string; glow: string }
> = {
  neutral: {
    chip: 'border-slate-900/[0.06] bg-slate-50 text-slate-500',
    value: 'text-slate-900',
    bar: 'bg-slate-800',
    glow: 'from-slate-900/[0.04]',
  },
  success: {
    chip: 'border-emerald-600/15 bg-emerald-50 text-emerald-600',
    value: 'text-slate-900',
    bar: 'bg-emerald-500',
    glow: 'from-emerald-500/[0.08]',
  },
  warning: {
    chip: 'border-amber-600/20 bg-amber-50 text-amber-600',
    value: 'text-slate-900',
    bar: 'bg-amber-500',
    glow: 'from-amber-500/[0.08]',
  },
  danger: {
    chip: 'border-red-600/15 bg-red-50 text-red-600',
    value: 'text-red-600',
    bar: 'bg-red-500',
    glow: 'from-red-500/[0.07]',
  },
  info: {
    chip: 'border-sky-600/15 bg-sky-50 text-sky-600',
    value: 'text-slate-900',
    bar: 'bg-sky-500',
    glow: 'from-sky-500/[0.07]',
  },
};

type StatProps = {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: LucideIcon;
  tone?: StatTone;
  bar?: number;
  className?: string;
};

/** A compact KPI tile: label, icon, large number, context line, optional meter. */
export function Stat({ label, value, sub, icon: Icon, tone = 'neutral', bar, className }: StatProps) {
  const t = TONES[tone];
  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-2xl border border-slate-900/[0.07] bg-white p-4 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-900/[0.12] hover:shadow-lift',
        className,
      )}
    >
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100',
          t.glow,
        )}
      />
      <div className="relative flex items-start justify-between gap-2">
        <span className="font-mono text-[9.5px] font-medium uppercase leading-4 tracking-[0.16em] text-slate-400">
          {label}
        </span>
        {Icon ? (
          <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border', t.chip)}>
            <Icon className="h-3.5 w-3.5" />
          </span>
        ) : null}
      </div>
      <div className={cn('relative mt-2 text-[1.35rem] font-semibold leading-none tracking-[-0.02em] tabular', t.value)}>
        {value}
      </div>
      {sub ? <div className="relative mt-1.5 text-[11px] leading-4 text-slate-500">{sub}</div> : null}
      {bar !== undefined ? (
        <div className="relative mt-3 h-1 overflow-hidden rounded-full bg-slate-900/[0.06]">
          <div
            className={cn('h-full origin-left rounded-full transition-[width] duration-700', t.bar)}
            style={{ width: `${Math.max(0, Math.min(1, bar)) * 100}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
