import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../lib/utils';

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
};

export function EmptyState({ icon: Icon, title, description, actions, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border border-dashed border-slate-300/80 bg-white/70 px-6 py-12 text-center',
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-40 w-80 -translate-x-1/2 rounded-full bg-emerald-400/[0.07] blur-3xl"
      />
      <div className="relative mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-card">
        <Icon className="h-5 w-5 text-slate-500" />
      </div>
      <h3 className="relative mt-4 text-[15px] font-semibold tracking-tight text-slate-900">{title}</h3>
      <p className="relative mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-slate-500">{description}</p>
      {actions ? <div className="relative mt-6 flex flex-wrap justify-center gap-2">{actions}</div> : null}
    </div>
  );
}
