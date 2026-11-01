import * as React from 'react';

type PayloadItem = {
  name?: string | number;
  value?: string | number;
  color?: string;
  dataKey?: string | number;
};

type ChartTooltipProps = {
  active?: boolean;
  payload?: PayloadItem[];
  label?: string | number;
  valueFormatter?: (value: number) => string;
  labelFormatter?: (label: string | number) => string;
};

/** Consistent tooltip for every Recharts surface in the console. */
export function ChartTooltip({ active, payload, label, valueFormatter, labelFormatter }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-[120px] rounded-xl border border-slate-900/10 bg-white/95 px-3 py-2 shadow-lift backdrop-blur">
      {label !== undefined ? (
        <div className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-slate-400">
          {labelFormatter ? labelFormatter(label) : label}
        </div>
      ) : null}
      <div className="space-y-1">
        {payload.map((item, index) => {
          const numeric = typeof item.value === 'number' ? item.value : Number(item.value ?? 0);
          const formatted = valueFormatter ? valueFormatter(numeric) : numeric.toLocaleString();
          return (
            <div key={`${item.name ?? index}`} className="flex items-center gap-2 text-[11.5px]">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: item.color ?? '#0f172a' }}
              />
              <span className="text-slate-500">{item.name}</span>
              <span className="ml-auto pl-2 font-medium tabular text-slate-900">{formatted}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
