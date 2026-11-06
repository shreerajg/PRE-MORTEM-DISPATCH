import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  Database,
  Gauge,
  History,
  Layers,
  Pencil,
  RefreshCw,
  TrendingUp,
  Trash2,
  Wrench,
  Zap,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { PageHeader } from '../components/PageHeader';
import { Stat } from '../components/Stat';
import { EmptyState } from '../components/EmptyState';
import { ChartTooltip } from '../components/ChartTooltip';
import {
  getAnalytics,
  listActivity,
  type ActivityEvent,
  type AnalyticsByType,
} from '../lib/api';
import { cn } from '../lib/utils';

const ACTIVITY_LABELS: Record<string, string> = {
  'dataset.created': 'Dataset loaded',
  'dataset.renamed': 'Dataset renamed',
  'dataset.deleted': 'Dataset deleted',
  'plan.created': 'Baseline solved',
  'plan.deleted': 'Plan deleted',
  'scenario.created': 'Disruption simulated',
  'scenario.recovered': 'Recovery run',
  'scenario.renamed': 'Scenario renamed',
  'scenario.deleted': 'Scenario deleted',
};

const ACTIVITY_ICONS: Record<string, { icon: React.ElementType; className: string }> = {
  'dataset.created': { icon: Database, className: 'border-sky-600/15 bg-sky-50 text-sky-600' },
  'dataset.renamed': { icon: Pencil, className: 'border-sky-600/15 bg-sky-50 text-sky-600' },
  'dataset.deleted': { icon: Trash2, className: 'border-red-600/15 bg-red-50 text-red-600' },
  'plan.created': { icon: Layers, className: 'border-slate-900/[0.07] bg-slate-50 text-slate-500' },
  'plan.deleted': { icon: Trash2, className: 'border-red-600/15 bg-red-50 text-red-600' },
  'scenario.created': { icon: Zap, className: 'border-amber-600/20 bg-amber-50 text-amber-600' },
  'scenario.recovered': { icon: Wrench, className: 'border-emerald-600/15 bg-emerald-50 text-emerald-600' },
  'scenario.renamed': { icon: Pencil, className: 'border-sky-600/15 bg-sky-50 text-sky-600' },
  'scenario.deleted': { icon: Trash2, className: 'border-red-600/15 bg-red-50 text-red-600' },
};

function typeLabel(type: string): string {
  if (type === 'compound') return 'combined';
  return type.replace(/_/g, ' ');
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, (Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function activityDetail(event: ActivityEvent): string | null {
  const detail = event.detail ?? {};
  const parts: string[] = [];
  if (typeof detail.name === 'string' && detail.name.trim()) parts.push(detail.name);
  if (typeof detail.deleted_plans === 'number') parts.push(`${detail.deleted_plans} plans`);
  if (typeof detail.deleted_scenarios === 'number') parts.push(`${detail.deleted_scenarios} scenarios`);
  if (typeof detail.unmet === 'number') parts.push(`${Math.round(detail.unmet)} unmet`);
  if (typeof detail.fulfillment_rate === 'number') {
    parts.push(`${(detail.fulfillment_rate * 100).toFixed(1)}% fulfilled`);
  }
  if (typeof detail.residual_units === 'number') {
    parts.push(`${Math.round(detail.residual_units)} residual`);
  }
  return parts.length ? parts.join(' · ') : null;
}

function pct(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined ? '—' : `${(value * 100).toFixed(digits)}%`;
}

function money(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `$${Math.round(value).toLocaleString()}`;
}

function signed(value: number | null | undefined, suffix: string): string {
  if (value === null || value === undefined) return '—';
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}${suffix}`;
}

export default function Insights() {
  const analytics = useQuery({
    queryKey: ['analytics'],
    queryFn: () => getAnalytics(50),
    retry: false,
  });
  const activity = useQuery({
    queryKey: ['activity'],
    queryFn: () => listActivity(12),
    retry: false,
  });

  const data = analytics.data;
  const summary = data?.summary;
  const trend = data?.trend ?? [];
  const byType = data?.by_type ?? [];

  const chartData = trend.map((item, index) => ({
    index: index + 1,
    label: item.name?.trim() || item.id.slice(0, 8),
    Baseline: item.baseline_fulfillment === null ? null : +(item.baseline_fulfillment * 100).toFixed(1),
    Disrupted: item.disrupted_fulfillment === null ? null : +(item.disrupted_fulfillment * 100).toFixed(1),
    Recovered: item.recovered_fulfillment === null ? null : +(item.recovered_fulfillment * 100).toFixed(1),
  }));

  const typeData = byType.map((row: AnalyticsByType) => ({
    ...row,
    label: typeLabel(row.type),
  }));

  const refresh = () => {
    analytics.refetch();
    activity.refetch();
  };

  if (analytics.isLoading) {
    return (
      <div className="space-y-7" aria-busy="true" aria-label="Loading workspace insights">
        <PageHeader
          eyebrow="Analysis · workspace history"
          title="Insights"
          description="Loading stored scenario history from the API."
        />
        <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="h-28 animate-pulse rounded-2xl border border-slate-900/[0.05] bg-white" />
          ))}
        </section>
        <section className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
          <div className="h-96 animate-pulse rounded-2xl border border-slate-900/[0.05] bg-white" />
          <div className="h-96 animate-pulse rounded-2xl border border-slate-900/[0.05] bg-white" />
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Analysis · workspace history"
        title="Insights"
        description="Every stored scenario, aggregated server-side: trend, disruption mix, recovery economics and the audit trail."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={refresh} disabled={analytics.isFetching || activity.isFetching}>
              <RefreshCw className={cn('h-3.5 w-3.5', (analytics.isFetching || activity.isFetching) && 'animate-spin')} />
              Refresh
            </Button>
            <Button size="sm" asChild>
              <Link to="/disruption">
                <Zap className="h-3.5 w-3.5" />
                Simulate disruption
              </Link>
            </Button>
          </>
        }
        meta={
          data ? (
            <>
              <Badge variant="outline">{data.total_scenarios} scenario(s) stored</Badge>
              <Badge variant="secondary">Read-only projection</Badge>
            </>
          ) : null
        }
      />

      {analytics.isError ? (
        <Card className="border-red-600/15 bg-red-50">
          <CardContent className="p-4 text-[12.5px] text-red-700">
            {String((analytics.error as Error).message)}
          </CardContent>
        </Card>
      ) : null}

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat
          label="Scenarios analysed"
          value={data?.scenarios_analyzed ?? '—'}
          sub={data ? `${summary?.recovered ?? 0} recovered` : 'loading history'}
          icon={History}
          tone="info"
        />
        <Stat
          label="Avg disrupted"
          value={pct(summary?.avg_disrupted_fulfillment)}
          sub="fulfilment after break"
          icon={Gauge}
          tone="warning"
          bar={summary?.avg_disrupted_fulfillment ?? undefined}
        />
        <Stat
          label="Avg recovery cost"
          value={money(summary?.avg_recovery_cost)}
          sub={data ? `${summary?.open_gap_scenarios ?? 0} scenario(s) still short` : 'price of contingency'}
          icon={TrendingUp}
          tone="neutral"
        />
        <Stat
          label="Avg restoration"
          value={signed(summary?.avg_restored_pp, 'pp')}
          sub="per recovered scenario"
          icon={CheckCircle2}
          tone="success"
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Fulfilment across scenarios</CardTitle>
            <CardDescription>Oldest → newest. Recovered is null until a recovery run exists.</CardDescription>
          </CardHeader>
          <CardContent>
            {trend.length === 0 ? (
              <EmptyState
                icon={TrendingUp}
                title="No scenarios to analyse yet"
                description="Simulate a disruption, optionally recover it, and this chart fills with computed history."
                actions={
                  <Button asChild>
                    <Link to="/disruption">
                      Open the Disruption Lab <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                }
                className="border-0 bg-transparent py-8"
              />
            ) : (
              <>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: -14 }}>
                      <CartesianGrid vertical={false} stroke="#e9ecf0" strokeDasharray="3 6" />
                      <XAxis
                        dataKey="index"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 9.5, fill: '#94a3b8' }}
                        tickFormatter={(value: number) => chartData[value - 1]?.label.slice(0, 9) ?? ''}
                        interval={Math.max(0, Math.ceil(chartData.length / 6) - 1)}
                      />
                      <YAxis
                        domain={[0, 100]}
                        ticks={[0, 25, 50, 75, 100]}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 10, fill: '#94a3b8' }}
                        tickFormatter={(value: number) => `${value}%`}
                      />
                      <Tooltip
                        content={
                          <ChartTooltip
                            valueFormatter={(value) => `${value.toFixed(1)}%`}
                            labelFormatter={(label) => {
                              const point = chartData[Number(label) - 1];
                              return point ? `${point.label} · scenario ${label}` : `Scenario ${label}`;
                            }}
                          />
                        }
                      />
                      <Line
                        type="monotone"
                        dataKey="Baseline"
                        stroke="#94a3b8"
                        strokeWidth={1.5}
                        strokeDasharray="4 4"
                        dot={false}
                      />
                      <Line type="monotone" dataKey="Disrupted" stroke="#ef4444" strokeWidth={2.2} dot={{ r: 2.5 }} />
                      <Line type="monotone" dataKey="Recovered" stroke="#10b981" strokeWidth={2.2} dot={{ r: 2.5 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-center gap-4 text-[10.5px] text-slate-500">
                  {[
                    ['Baseline', '#94a3b8'],
                    ['Disrupted', '#ef4444'],
                    ['Recovered', '#10b981'],
                  ].map(([label, color]) => (
                    <span key={label} className="inline-flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
                      {label}
                    </span>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Disruption mix</CardTitle>
            <CardDescription>Stored scenarios by disruption type.</CardDescription>
          </CardHeader>
          <CardContent>
            {typeData.length === 0 ? (
              <p className="py-10 text-center text-[12.5px] text-slate-500">No disruption history yet.</p>
            ) : (
              <>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={typeData} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 4 }}>
                      <CartesianGrid horizontal={false} stroke="#e9ecf0" strokeDasharray="3 6" />
                      <XAxis type="number" allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 9.5, fill: '#94a3b8' }} />
                      <YAxis
                        type="category"
                        dataKey="label"
                        width={92}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 10, fill: '#64748b' }}
                      />
                      <Tooltip
                        cursor={{ fill: 'rgba(15,23,42,0.03)' }}
                        content={<ChartTooltip valueFormatter={(value) => `${Math.round(value)} scenario(s)`} />}
                      />
                      <Bar dataKey="count" name="Scenarios" fill="#0f766e" radius={[0, 5, 5, 0]} maxBarSize={20} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <ul className="mt-2 space-y-1.5 border-t border-slate-900/[0.06] pt-2">
                  {typeData.slice(0, 4).map((row) => (
                    <li key={row.type} className="flex items-center justify-between text-[10.5px]">
                      <span className="text-slate-500">{row.label}</span>
                      <span className="tabular text-slate-600">
                        {row.avg_fulfillment_drop_pp === null
                          ? '—'
                          : `${row.avg_fulfillment_drop_pp.toFixed(1)}pp drop`}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <History className="h-4 w-4 text-slate-400" /> Workspace activity
            </CardTitle>
            <CardDescription>Audit trail of stored mutations — not page views or analysis runs.</CardDescription>
          </div>
          <Badge variant="secondary">{activity.data?.total ?? 0} events</Badge>
        </CardHeader>
        <CardContent>
          {activity.isError ? (
            <p className="text-[12.5px] text-red-700">{String((activity.error as Error).message)}</p>
          ) : !activity.data?.events?.length ? (
            <p className="py-6 text-center text-[12.5px] text-slate-500">
              No activity yet — load a dataset or solve a baseline.
            </p>
          ) : (
            <ol className="divide-y divide-slate-900/[0.05]">
              {activity.data.events.map((event) => {
                const meta = ACTIVITY_ICONS[event.action] ?? {
                  icon: History,
                  className: 'border-slate-900/[0.07] bg-slate-50 text-slate-500',
                };
                const Icon = meta.icon;
                const detail = activityDetail(event);
                return (
                  <li key={event.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border', meta.className)}>
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="text-[12px] font-medium text-slate-800">
                          {ACTIVITY_LABELS[event.action] ?? event.action.replace(/[._]/g, ' ')}
                        </span>
                        {event.entity_id ? (
                          <span className="font-mono text-[9.5px] text-slate-400">
                            {event.entity_type} {event.entity_id.slice(0, 8)}
                          </span>
                        ) : null}
                      </div>
                      {detail ? <p className="mt-0.5 truncate text-[11px] text-slate-500">{detail}</p> : null}
                    </div>
                    <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.1em] text-slate-400">
                      {relativeTime(event.at)}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
