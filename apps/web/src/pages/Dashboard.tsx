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
  RefreshCw,
  ArrowRight,
  ArrowUpRight,
  Database,
  ShieldCheck,
  Route as RouteIcon,
  Boxes,
  HeartPulse,
  CheckCircle2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { PageHeader } from '../components/PageHeader';
import { Stat } from '../components/Stat';
import { PlanJourney } from '../components/PlanJourney';
import { ChartTooltip } from '../components/ChartTooltip';
import { health, getDataset, getPlan, listDatasets, listPlans, listScenarios } from '../lib/api';
import { Select } from '../components/ui/select';
import { cn, disruptionLabel, scenarioTitle, solverStatusTone } from '../lib/utils';
import { useAppStore } from '../stores/appStore';

export default function Dashboard() {
  const { planId, setPlanId, setScenarioId } = useAppStore();

  const { data: h, refetch: refreshHealth } = useQuery({ queryKey: ['health'], queryFn: health, retry: false });
  const { data: datasetsData, refetch: refreshDatasets } = useQuery({ queryKey: ['datasets'], queryFn: listDatasets });
  const { data: plansData, isLoading: plansLoading, isError: plansError, error: plansErrorDetail, refetch: refreshPlans } = useQuery({
    queryKey: ['plans', 100],
    queryFn: () => listPlans(100),
  });
  const { data: scenarioData, isError: scenariosError, refetch: refreshScenarios } = useQuery({
    queryKey: ['scenarios', 100],
    queryFn: () => listScenarios(100),
  });

  const baselines = (plansData?.plans ?? []).filter((p) => p.type === 'baseline');
  const activePlanId = (planId && baselines.some((baseline) => baseline.id === planId)
    ? planId
    : baselines[0]?.id) ?? null;

  // Keep the store in sync so downstream pages have a baseline context
  React.useEffect(() => {
    if (activePlanId && planId !== activePlanId) setPlanId(activePlanId);
  }, [activePlanId, planId, setPlanId]);

  const { data: plan, isFetching: planLoading, isError: planError, refetch: refreshPlan } = useQuery({
    queryKey: ['plan', activePlanId],
    queryFn: () => getPlan(activePlanId!),
    enabled: !!activePlanId,
  });
  const { data: dataset, isError: datasetError, refetch: refreshDataset } = useQuery({
    queryKey: ['dataset', plan?.dataset_id],
    queryFn: () => getDataset(plan!.dataset_id),
    enabled: !!plan?.dataset_id,
  });

  const kpis = plan?.kpis;
  const scenarios = scenarioData?.scenarios ?? [];
  // A scenario from another baseline must never be presented as this plan's journey.
  const baselineScenarios = scenarios.filter((scenario) => scenario.baseline_plan_id === activePlanId);
  const latest = baselineScenarios[0];

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

  const hasPlan = Boolean(plan && plan.id === activePlanId && kpis);

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Operations · baseline health"
        title="Operations Dashboard"
        description="A live, decision-ready view of service coverage, network exposure and the next operational move."
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
          <>
            {baselines.length > 1 ? (
              <label className="flex items-center gap-2 text-[11px] font-medium text-slate-600">
                <span className="sr-only">Active baseline plan</span>
                <Select
                  aria-label="Active baseline plan"
                  value={activePlanId ?? ''}
                  onChange={(event) => setPlanId(event.target.value || null)}
                  className="h-8 max-w-[18rem] text-[11px]"
                >
                  {baselines.map((baseline) => (
                    <option key={baseline.id} value={baseline.id}>
                      {baseline.id.slice(0, 8)} · {baseline.solver} · {((baseline.kpis?.fulfillment_rate ?? 0) * 100).toFixed(1)}%
                    </option>
                  ))}
                </Select>
              </label>
            ) : null}
            {plan ? (
              <Badge variant={solverStatusTone(plan.solver_status, plan.kpis?.unmet)}>
                Plan {plan.id.slice(0, 8)} · {plan.solver}
                {plan.solver_status ? ` · ${plan.solver_status}` : ''}
              </Badge>
            ) : h ? (
              <Badge variant="outline">Engine {h.solver}</Badge>
            ) : null}
          </>
        }
      />

      {plansError || planError || scenariosError || datasetError ? (
        <Card role="alert" className="border-red-600/15 bg-red-50/60">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex min-w-0 items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <p className="text-[12.5px] leading-relaxed text-red-800">
                {String((plansErrorDetail as Error | undefined)?.message ?? 'Workspace data could not be refreshed. Your saved plans are not affected.')}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={plansLoading || planLoading}
              onClick={() => {
                void Promise.all([
                  refreshHealth(),
                  refreshDatasets(),
                  refreshPlans(),
                  refreshScenarios(),
                  ...(activePlanId ? [refreshPlan()] : []),
                  ...(plan?.dataset_id ? [refreshDataset()] : []),
                ]);
              }}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', (plansLoading || planLoading) && 'animate-spin')} />
              {plansLoading || planLoading ? 'Refreshing' : 'Retry'}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {plansLoading && !plansData ? (
        <section aria-label="Loading workspace" aria-busy="true" className="space-y-4">
          <div className="h-52 animate-pulse rounded-2xl bg-ink-900/10" />
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-6">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="h-24 animate-pulse rounded-2xl border border-slate-900/[0.05] bg-white" />
            ))}
          </div>
        </section>
      ) : null}

      {hasPlan ? (
        <section
          aria-label="Network operating status"
          className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[#101b20] text-white shadow-[0_24px_70px_-30px_rgba(10,15,20,0.52)]"
        >
          <div aria-hidden className="pointer-events-none absolute inset-0 opacity-40" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px)', backgroundSize: '32px 32px', maskImage: 'linear-gradient(to right, transparent, black)' }} />
          <div aria-hidden className="pointer-events-none absolute -right-20 -top-36 h-96 w-96 rounded-full bg-emerald-400/[0.10] blur-[100px]" />
          <div className="relative grid gap-7 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_minmax(250px,0.68fr)] lg:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('inline-flex items-center gap-2 rounded-full border px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.13em]', kpis!.unmet > 0.001 ? 'border-amber-300/20 bg-amber-300/[0.08] text-amber-200' : 'border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-200')}>
                  <span className={cn('h-1.5 w-1.5 rounded-full', kpis!.unmet > 0.001 ? 'bg-amber-400' : 'bg-emerald-400')} />
                  {kpis!.unmet > 0.001 ? 'Service gaps detected' : 'Network plan ready'}
                </span>
                {plan?.solver_status ? <Badge variant={solverStatusTone(plan.solver_status, kpis!.unmet)}>{plan.solver_status}</Badge> : null}
                <span className="font-mono text-[9.5px] text-white/40">{plan!.solver} solver</span>
              </div>
              <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.19em] text-white/45">Current network fulfillment</p>
              <div className="mt-1 flex flex-wrap items-end gap-x-3 gap-y-1">
                <span className={cn('text-5xl font-semibold leading-none tracking-[-0.055em] tabular sm:text-6xl', kpis!.unmet > 0.001 ? 'text-amber-200' : 'text-white')}>
                  {(kpis!.fulfillment_rate * 100).toFixed(1)}%
                </span>
                <span className="pb-1.5 text-[12px] text-white/55">of requested units fulfilled</span>
              </div>
              <div className="mt-4 max-w-xl" role="progressbar" aria-label="Network fulfillment" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(kpis!.fulfillment_rate * 100)} aria-valuetext={`${(kpis!.fulfillment_rate * 100).toFixed(1)}% of demand fulfilled`}>
                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div className={cn('h-full rounded-full transition-[width] duration-700', kpis!.unmet > 0.001 ? 'bg-amber-400' : 'bg-emerald-400')} style={{ width: `${Math.max(0, Math.min(100, kpis!.fulfillment_rate * 100))}%` }} />
                </div>
              </div>
              <p className="mt-2.5 max-w-xl text-[12px] leading-relaxed text-white/55">
                {kpis!.unmet > 0.001
                  ? `${Math.round(kpis!.unmet).toLocaleString()} requested units remain unallocated. Review the plan or test contingency recovery.`
                  : `${Math.round(kpis!.fulfilled).toLocaleString()} units allocated across the current plan. Stress-test network dependencies before committing to delivery.`}
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button size="sm" className="bg-emerald-400 text-ink-950 shadow-none hover:bg-emerald-300" asChild>
                  <Link to={kpis!.unmet > 0.001 ? '/recovery' : '/resilience'}>
                    {kpis!.unmet > 0.001 ? <HeartPulse className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                    {kpis!.unmet > 0.001 ? 'Explore recovery' : 'Assess resilience'}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
                <Button size="sm" variant="outline" className="border-white/15 bg-white/[0.04] text-white hover:border-white/25 hover:bg-white/[0.08] hover:text-white" asChild>
                  <Link to="/disruption"><Zap className="h-3.5 w-3.5" />Stress-test the plan</Link>
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-2">
              {[
                { label: 'Destinations served', value: String(new Set(plan!.allocations.map((allocation) => allocation.destination_id)).size), icon: Boxes, note: 'with planned shipments' },
                { label: 'Routes modelled', value: String(dataset?.meta.routes?.length ?? '—'), icon: RouteIcon, note: 'available + backup' },
                { label: 'Units unfulfilled', value: Math.round(kpis!.unmet).toLocaleString(), icon: AlertTriangle, note: kpis!.unmet > 0.001 ? 'review gaps' : 'no open gaps' },
                { label: 'Units past deadline', value: Math.round(plan!.delivery_risk?.at_risk_units ?? 0).toLocaleString(), icon: Clock, note: 'baseline delivery exposure' }
              ].map(({ label, value, icon: Icon, note }) => (
                <div key={label} className="rounded-xl border border-white/[0.08] bg-white/[0.045] p-3.5 backdrop-blur-sm sm:p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[9px] uppercase tracking-[0.13em] text-white/45">{label}</span>
                    <Icon className="h-3.5 w-3.5 shrink-0 text-emerald-300/70" aria-hidden="true" />
                  </div>
                  <div className="mt-2 text-2xl font-semibold leading-none tracking-tight tabular text-white">{value}</div>
                  <div className="mt-1.5 text-[10px] text-white/40">{note}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="relative flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.08] bg-black/10 px-5 py-3 sm:px-7">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-white/50">
              <Database className="h-3 w-3 shrink-0 text-emerald-300/70" aria-hidden="true" />
              <span className="truncate font-medium text-white/75">{dataset?.name ?? 'Dataset details loading'}</span>
              {dataset ? <><span className="text-white/20">·</span><span>{dataset.meta.warehouses?.length ?? 0} warehouses</span><span className="text-white/20">·</span><span>{dataset.meta.products?.length ?? 0} products</span></> : null}
            </div>
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-white/35">Deadlines {plan!.constraints?.respect_deadlines ? 'enforced' : 'tracked as KPI'}</span>
          </div>
        </section>
      ) : null}

      {(plansLoading && !plansData) || (planLoading && activePlanId && plan?.id !== activePlanId) ? (
        <section aria-label="Loading workspace" aria-busy="true" className="space-y-4">
          <div className="h-52 animate-pulse rounded-2xl bg-ink-900/10" />
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-6">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="h-24 animate-pulse rounded-2xl border border-slate-900/[0.05] bg-white" />
            ))}
          </div>
          <div className="h-72 animate-pulse rounded-2xl border border-slate-900/[0.05] bg-white" />
        </section>
      ) : plansError || planError ? null : !hasPlan ? (
        <section aria-labelledby="workspace-start-title" className="overflow-hidden rounded-2xl border border-slate-900/[0.08] bg-white shadow-card">
          <div className="grid gap-7 p-6 sm:p-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(18rem,0.75fr)] lg:items-center">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-700/10 bg-emerald-50 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-emerald-800">
                <Database className="h-3 w-3" /> Your operations workspace
              </span>
              <h2 id="workspace-start-title" className="mt-4 max-w-xl text-2xl font-semibold leading-tight tracking-tight text-slate-900 sm:text-3xl">
                Turn your network into a plan you can trust.
              </h2>
              <p className="mt-2 max-w-lg text-[13px] leading-relaxed text-slate-500">
                {datasetsData?.datasets.length
                  ? 'Your data is ready. Solve a baseline allocation to see where demand is served, where the network is exposed, and what a disruption could cost.'
                  : 'Start with the sample network or import your own. Validate your supply, lanes and demand before making a planning decision.'}
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button asChild>
                  <Link to={datasetsData?.datasets.length ? '/planner' : '/datasets'}>
                    {datasetsData?.datasets.length ? 'Create your first plan' : 'Load or import a dataset'}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                {datasetsData?.datasets.length ? (
                  <Button asChild variant="outline"><Link to="/datasets">View your datasets</Link></Button>
                ) : null}
              </div>
            </div>
            <ol className="grid gap-2.5 sm:grid-cols-3 lg:grid-cols-1">
              {[
                { n: '01', title: 'Bring in your network', note: 'Warehouses · inventory · routes · demand', done: Boolean(datasetsData?.datasets.length) },
                { n: '02', title: 'Build a feasible plan', note: 'Every shipment and service gap explained', done: false },
                { n: '03', title: 'Stress-test & recover', note: 'Measure exposure before it reaches customers', done: false },
              ].map((step) => (
                <li key={step.n} className="flex items-start gap-3 rounded-xl border border-slate-900/[0.07] bg-paper/60 p-3.5">
                  <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg font-mono text-[9px]', step.done ? 'bg-emerald-100 text-emerald-800' : 'bg-white text-slate-400')}>
                    {step.done ? <CheckCircle2 className="h-3.5 w-3.5" /> : step.n}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[12px] font-semibold text-slate-800">{step.title}</span>
                    <span className="mt-0.5 block text-[10.5px] leading-relaxed text-slate-500">{step.note}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </section>
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
                      ? 'Baseline, disruption and recovery from a scenario built on this exact plan.'
                      : 'Baseline only — stress-test this plan to measure disruption and recovery.'}
                  </CardDescription>
                </div>
                {latest ? (
                  <Link
                    to="/compare"
                    onClick={() => setScenarioId(latest.id)}
                    className="inline-flex shrink-0 items-center gap-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-slate-400 transition-colors hover:text-slate-900"
                  >
                    Compare <ArrowUpRight className="h-3 w-3" />
                  </Link>
                ) : null}
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
                  <CardDescription>Saved disruption runs for this baseline, with restoration results when recovery has been tested.</CardDescription>
                </div>
                <Link
                  to="/compare"
                  className="inline-flex shrink-0 items-center gap-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-slate-400 transition-colors hover:text-slate-900"
                >
                  Compare <ArrowUpRight className="h-3 w-3" />
                </Link>
              </CardHeader>
              <CardContent>
                {!baselineScenarios.length ? (
                  <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-slate-300/80 bg-slate-50/50 p-4">
                    <p className="text-[13px] text-slate-500">
                      {scenarios.length
                        ? 'Saved runs belong to another baseline. Stress-test the active plan to make a like-for-like comparison.'
                        : 'No disruption runs yet. Stress-test this plan to understand the impact before operations are affected.'}
                    </p>
                    <Button asChild size="sm" variant="outline">
                      <Link to="/disruption">
                        <Zap className="h-3.5 w-3.5" /> Stress-test this plan
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
                      {baselineScenarios.slice(0, 5).map((s) => (
                        <TableRow key={s.id}>
                          <TableCell className="font-mono text-[11px] text-slate-600" title={s.id}>
                            <Link to="/compare" onClick={() => setScenarioId(s.id)} className="font-medium text-slate-800 underline decoration-slate-200 underline-offset-4 transition-colors hover:text-emerald-700 hover:decoration-emerald-500">
                              {scenarioTitle(s)}
                            </Link>
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
                  <Link to="/resilience">Assess resilience</Link>
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
