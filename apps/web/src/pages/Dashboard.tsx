import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
} from 'recharts';
import {
  Package,
  FileText,
  TrendingUp,
  AlertTriangle,
  DollarSign,
  Gauge,
  Zap,
  Clock,
  ArrowRight,
  ArrowUpRight,
  Database,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { PageHeader } from '../components/PageHeader';
import { Stat } from '../components/Stat';
import { EmptyState } from '../components/EmptyState';
import { PlanJourney } from '../components/PlanJourney';
import { ChartTooltip } from '../components/ChartTooltip';
import { health, getPlan, listPlans, listScenarios } from '../lib/api';
import { disruptionLabel, scenarioTitle, solverStatusTone } from '../lib/utils';
import { useAppStore } from '../stores/appStore';

export default function Dashboard() {
  const { planId, setPlanId } = useAppStore();

  const { data: h } = useQuery({ queryKey: ['health'], queryFn: health, retry: false });
  const { data: plansData } = useQuery({ queryKey: ['plans'], queryFn: () => listPlans(25) });
  const { data: scenarioData } = useQuery({ queryKey: ['scenarios'], queryFn: () => listScenarios(10) });

  const baselines = (plansData?.plans ?? []).filter((p) => p.type === 'baseline');
  const activePlanId = planId ?? baselines[0]?.id ?? null;

  // Keep the store in sync so downstream pages have a baseline context
  React.useEffect(() => {
    if (!planId && baselines.length) setPlanId(baselines[0].id);
  }, [planId, baselines, setPlanId]);

  const { data: plan, isFetching: planLoading } = useQuery({
    queryKey: ['plan', activePlanId],
    queryFn: () => getPlan(activePlanId!),
    enabled: !!activePlanId,
  });

  const kpis = plan?.kpis;
  const scenarios = scenarioData?.scenarios ?? [];
  const latest = scenarios[0];

  const utilizationData = kpis
    ? [
        { name: 'Warehouse', value: Math.round(kpis.wh_utilization * 100) },
        { name: 'Route', value: Math.round(kpis.route_utilization * 100) },
        { name: 'Fulfillment', value: Math.round(kpis.fulfillment_rate * 100) },
      ]
    : [];

  const pieData = kpis
    ? [
        { name: 'Fulfilled', value: Math.round(kpis.fulfilled) },
        { name: 'Unmet', value: Math.round(kpis.unmet) },
      ]
    : [];

  const hasPlan = !!kpis;

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Operations · baseline health"
        title="Operations Dashboard"
        description="Baseline network health, fulfillment and capacity — recalculated from the active plan."
        actions={
          hasPlan ? (
            <>
              <Button variant="outline" size="sm" asChild>
                <Link to="/planner">Open planner</Link>
              </Button>
              <Button size="sm" asChild>
                <Link to="/disruption">
                  <Zap className="h-3.5 w-3.5" />
                  Simulate disruption
                </Link>
              </Button>
            </>
          ) : null
        }
        meta={
          plan ? (
            <Badge variant={solverStatusTone(plan.solver_status, plan.kpis?.unmet)}>
              Plan {plan.id.slice(0, 8)} · {plan.solver}
              {plan.solver_status ? ` · ${plan.solver_status}` : ''}
            </Badge>
          ) : h ? (
            <Badge variant="outline">Engine {h.solver}</Badge>
          ) : null
        }
      />

      {!hasPlan ? (
        <EmptyState
          icon={Package}
          title="No baseline plan yet"
          description="Load the sample dataset, generate a baseline allocation, then simulate a disruption and recover from it."
          actions={
            <>
              <Button asChild>
                <Link to="/datasets">
                  Load datasets <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/planner">Go to Planner</Link>
              </Button>
            </>
          }
        />
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 xl:grid-cols-6">
            <Stat
              label="Total inventory"
              value={Math.round(kpis!.total_inventory).toLocaleString()}
              sub="units on hand"
              icon={Package}
              tone="neutral"
            />
            <Stat
              label="Total demand"
              value={Math.round(kpis!.total_demand).toLocaleString()}
              sub="units requested"
              icon={FileText}
              tone="info"
            />
            <Stat
              label="Fulfillment"
              value={`${(kpis!.fulfillment_rate * 100).toFixed(1)}%`}
              sub={`${Math.round(kpis!.fulfilled).toLocaleString()} fulfilled`}
              icon={TrendingUp}
              tone="success"
              bar={kpis!.fulfillment_rate}
            />
            <Stat
              label="Unmet demand"
              value={Math.round(kpis!.unmet).toLocaleString()}
              sub="units short"
              icon={AlertTriangle}
              tone={kpis!.unmet > 0.001 ? 'danger' : 'success'}
              bar={kpis!.total_demand ? kpis!.unmet / kpis!.total_demand : 0}
            />
            <Stat
              label="Total cost"
              value={`$${Math.round(kpis!.total_cost).toLocaleString()}`}
              sub="allocation cost"
              icon={DollarSign}
              tone="warning"
            />
            <Stat
              label="Risk score"
              value={kpis!.risk_score.toFixed(1)}
              sub={`${kpis!.at_risk_destinations} at-risk dest.`}
              icon={Gauge}
              tone={kpis!.risk_score >= 40 ? 'danger' : kpis!.risk_score >= 20 ? 'warning' : 'success'}
              bar={kpis!.risk_score / 100}
            />
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
            <Card className="min-w-0 overflow-hidden">
              <CardHeader className="flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle>Plan journey</CardTitle>
                  <CardDescription>
                    {latest
                      ? 'Baseline, disruption and recovery from the most recent scenario.'
                      : 'Baseline only — break it to see the disruption and recovery legs.'}
                  </CardDescription>
                </div>
                <Link
                  to="/compare"
                  className="inline-flex shrink-0 items-center gap-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-slate-400 transition-colors hover:text-slate-900"
                >
                  Compare <ArrowUpRight className="h-3 w-3" />
                </Link>
              </CardHeader>
              <CardContent>
                <PlanJourney
                  phases={[
                    {
                      key: 'baseline',
                      label: 'Baseline',
                      tone: 'neutral',
                      kpis: latest?.kpis.baseline ?? kpis ?? null,
                    },
                    {
                      key: 'disrupted',
                      label: 'Disrupted',
                      tone: 'bad',
                      kpis: latest?.kpis.disrupted ?? null,
                      pending: 'No disruption simulated yet.',
                    },
                    {
                      key: 'recovered',
                      label: 'Recovered',
                      tone: 'good',
                      kpis: latest?.kpis.recovered ?? null,
                      pending: 'Recovery has not run yet.',
                    },
                  ]}
                />
                {latest ? (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-900/[0.06] pt-3">
                    <span className="text-[11.5px] text-slate-500">
                      Latest scenario · {scenarioTitle(latest)} · {disruptionLabel(latest.disruption)}
                    </span>
                    <Badge variant={latest.status === 'recovered' ? 'success' : 'warning'}>{latest.status}</Badge>
                  </div>
                ) : (
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-900/[0.06] pt-3">
                    <span className="text-[11.5px] text-slate-500">This plan has not been stress-tested.</span>
                    <Link
                      to="/disruption"
                      className="inline-flex items-center gap-1 text-[11.5px] font-medium text-slate-900 underline decoration-slate-300 underline-offset-4 hover:decoration-slate-900"
                    >
                      Open the Disruption Lab <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Capacity &amp; fulfillment</CardTitle>
                <CardDescription>Percent utilization from the active plan</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-60">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={utilizationData} margin={{ top: 10, right: 8, bottom: 0, left: -18 }} barCategoryGap={30}>
                      <defs>
                        <linearGradient id="dashboardBar" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#0f172a" />
                          <stop offset="100%" stopColor="#334155" />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke="#e9ecf0" strokeDasharray="3 6" />
                      <XAxis
                        dataKey="name"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 11, fill: '#64748b' }}
                        dy={6}
                      />
                      <YAxis
                        domain={[0, 100]}
                        ticks={[0, 25, 50, 75, 100]}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 10, fill: '#94a3b8' }}
                        tickFormatter={(v: number) => `${v}%`}
                      />
                      <Tooltip
                        cursor={{ fill: 'rgba(15,23,42,0.03)' }}
                        content={<ChartTooltip valueFormatter={(v) => `${Math.round(v)}%`} />}
                      />
                      <Bar
                        dataKey="value"
                        name="Utilization"
                        fill="url(#dashboardBar)"
                        radius={[7, 7, 2, 2]}
                        maxBarSize={54}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-4 xl:grid-cols-[0.82fr_1.18fr]">
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Fulfillment mix</CardTitle>
                <CardDescription>Fulfilled vs unmet units</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="relative h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        innerRadius={62}
                        outerRadius={88}
                        dataKey="value"
                        paddingAngle={pieData.every((p) => p.value > 0) ? 2 : 0}
                        cornerRadius={6}
                        startAngle={90}
                        endAngle={-270}
                        stroke="none"
                      >
                        <Cell fill="#10b981" />
                        <Cell fill="#ef4444" />
                      </Pie>
                      <Tooltip content={<ChartTooltip valueFormatter={(v) => `${Math.round(v).toLocaleString()} u`} />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <div className="text-2xl font-semibold tracking-tight tabular text-slate-900">
                      {(kpis!.fulfillment_rate * 100).toFixed(1)}%
                    </div>
                    <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-slate-400">
                      fulfilled
                    </div>
                  </div>
                </div>
                <div className="mt-1 flex flex-wrap items-center justify-center gap-5 text-[11px] text-slate-500">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Fulfilled <strong className="font-medium tabular text-slate-800">{Math.round(kpis!.fulfilled).toLocaleString()}</strong>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                    Unmet <strong className="font-medium tabular text-slate-800">{Math.round(kpis!.unmet).toLocaleString()}</strong>
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-900/[0.06] pt-3 text-[11px] text-slate-500">
                  <span>
                    Warehouse utilization{' '}
                    <strong className="font-medium tabular text-slate-800">{(kpis!.wh_utilization * 100).toFixed(0)}%</strong>
                  </span>
                  <span>
                    Route utilization{' '}
                    <strong className="font-medium tabular text-slate-800">{(kpis!.route_utilization * 100).toFixed(0)}%</strong>
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader className="flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle>Recent scenarios</CardTitle>
                  <CardDescription>Every run is stored with its disruption config and computed results.</CardDescription>
                </div>
                <Link
                  to="/compare"
                  className="inline-flex shrink-0 items-center gap-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-slate-400 transition-colors hover:text-slate-900"
                >
                  Compare <ArrowUpRight className="h-3 w-3" />
                </Link>
              </CardHeader>
              <CardContent>
                {!scenarios.length ? (
                  <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-slate-300/80 bg-slate-50/50 p-4">
                    <p className="text-[13px] text-slate-500">No scenarios yet. Simulate a disruption to test this plan.</p>
                    <Button asChild size="sm" variant="outline">
                      <Link to="/disruption">
                        <Zap className="h-3.5 w-3.5" /> Open Disruption Lab
                      </Link>
                    </Button>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Scenario</TableHead>
                        <TableHead>Disruption</TableHead>
                        <TableHead className="text-right">Baseline</TableHead>
                        <TableHead className="text-right">Disrupted</TableHead>
                        <TableHead className="text-right">Recovered</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {scenarios.slice(0, 5).map((s) => (
                        <TableRow key={s.id}>
                          <TableCell className="font-mono text-[11px] text-slate-600" title={s.id}>
                            {scenarioTitle(s)}
                          </TableCell>
                          <TableCell className="text-[12px] text-slate-600">{disruptionLabel(s.disruption)}</TableCell>
                          <TableCell className="text-right tabular">
                            {s.kpis.baseline ? `${(s.kpis.baseline.fulfillment_rate * 100).toFixed(1)}%` : '—'}
                          </TableCell>
                          <TableCell className="text-right tabular text-red-600">
                            {s.kpis.disrupted ? `${(s.kpis.disrupted.fulfillment_rate * 100).toFixed(1)}%` : '—'}
                          </TableCell>
                          <TableCell className="text-right tabular text-emerald-700">
                            {s.kpis.recovered ? `${(s.kpis.recovered.fulfillment_rate * 100).toFixed(1)}%` : '—'}
                          </TableCell>
                          <TableCell>
                            <Badge variant={s.status === 'recovered' ? 'success' : 'warning'}>{s.status}</Badge>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-[11px] text-slate-500">
                            <Clock className="mr-1 inline h-3 w-3" />
                            {s.created_at ? new Date(s.created_at).toLocaleString() : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </section>

          <Card className="overflow-hidden">
            <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-900/[0.07] bg-slate-50 text-slate-500">
                  <Database className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-eyebrow">Active context</div>
                  <div className="mt-1 text-[13px] font-medium text-slate-900">
                    {planLoading
                      ? 'Loading plan…'
                      : `${plan!.type} · ${plan!.solver_status ?? plan!.status} · ${plan!.allocations.length} allocations`}
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-slate-500">
                    Solver {plan!.solver} ·{' '}
                    {plan!.constraints?.respect_deadlines ? 'deadlines enforced' : 'deadlines reported as KPI'}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" asChild>
                  <Link to="/planner">Open in Planner</Link>
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <Link to="/recovery">Run recovery</Link>
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <Link to="/exports">Export results</Link>
                </Button>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
