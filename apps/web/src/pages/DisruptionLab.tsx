import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowRight,
  Clock,
  FlaskConical,
  Info,
  ListOrdered,
  Plus,
  TrendingDown,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { PageHeader } from '../components/PageHeader';
import { Stat } from '../components/Stat';
import { ChartTooltip } from '../components/ChartTooltip';
import { causeLabel, CauseBadge } from '../components/CauseBadge';
import {
  createScenario,
  getDataset,
  listPlans,
  runSweep,
  type DisruptionRequest,
  type ImpactSummary,
  type PlanResponse,
  type UnmetDiagnosis,
} from '../lib/api';
import { solverStatusTone } from '../lib/utils';
import { useAppStore } from '../stores/appStore';

const MAX_EVENTS = 5;

type SweepConfig = { parameter: 'reduction_pct' | 'extra_days'; values: number[]; label: string; unit: string };

const SWEEP_CONFIG: Partial<Record<DisruptionType, SweepConfig>> = {
  inventory_shortage: {
    parameter: 'reduction_pct',
    values: [25, 50, 75, 100],
    label: 'Stock reduction',
    unit: '%',
  },
  route_delay: {
    parameter: 'extra_days',
    values: [2, 4, 6, 8],
    label: 'Extra transit days',
    unit: 'd',
  },
};

type DisruptionType = 'inventory_shortage' | 'route_closure' | 'route_delay' | 'supply_interruption';

const TYPE_LABELS: Record<DisruptionType, string> = {
  inventory_shortage: 'Inventory shortage — reduce stock at one warehouse × product',
  route_closure: 'Route closure — take a lane out of service',
  route_delay: 'Route delay — add transit days to a lane',
  supply_interruption: 'Supply interruption — zero out a warehouse × product',
};

const TYPE_HELP: Record<DisruptionType, string> = {
  inventory_shortage: 'Multiplies the selected warehouse × product stock by (1 − reduction).',
  route_closure: 'Sets the lane to unavailable and removes it from the re-solve.',
  route_delay: 'Adds transit days. Capacity is unchanged, so volume is preserved.',
  supply_interruption: 'Sets the selected warehouse × product stock to zero.',
};

export default function DisruptionLab() {
  const qc = useQueryClient();
  const { planId, datasetId, setScenarioId, setDisruptedPlan, setRecoveredPlan } = useAppStore();

  const { data: plansData } = useQuery({ queryKey: ['plans', 50], queryFn: () => listPlans(50) });
  const baselinePlans = React.useMemo(
    () => (plansData?.plans ?? []).filter((p) => p.type === 'baseline'),
    [plansData],
  );

  const [baselineId, setBaselineId] = React.useState(planId ?? '');
  React.useEffect(() => {
    if (planId) setBaselineId(planId);
  }, [planId]);
  React.useEffect(() => {
    if (!baselineId && baselinePlans.length) setBaselineId(baselinePlans[0].id);
  }, [baselinePlans, baselineId]);

  // Derive the dataset behind the chosen baseline plan so options are always real
  const activeBaseline = baselinePlans.find((p) => p.id === baselineId);
  const effectiveDatasetId = activeBaseline?.dataset_id ?? datasetId ?? undefined;

  const { data: dataset } = useQuery({
    queryKey: ['dataset', effectiveDatasetId],
    queryFn: () => getDataset(effectiveDatasetId!),
    enabled: !!effectiveDatasetId,
  });

  const warehouses = React.useMemo(
    () => (dataset?.meta?.warehouses ?? []).map((w) => String((w as Record<string, unknown>).id)),
    [dataset],
  );
  const products = React.useMemo(
    () => (dataset?.meta?.products ?? []).map((p) => String((p as Record<string, unknown>).id)),
    [dataset],
  );
  const routes = React.useMemo(
    () =>
      (dataset?.meta?.routes ?? []).map((r) => {
        const row = r as Record<string, unknown>;
        return {
          id: String(row.id),
          label: `${row.id} · ${row.warehouse_id}→${row.destination_id}`,
          backup: String(row.backup) === 'true',
        };
      }),
    [dataset],
  );

  const [type, setType] = React.useState<DisruptionType>('inventory_shortage');
  const [warehouseId, setWarehouseId] = React.useState('');
  const [productId, setProductId] = React.useState('');
  const [routeId, setRouteId] = React.useState('');
  const [reductionPct, setReductionPct] = React.useState('60');
  const [extraDays, setExtraDays] = React.useState('5');
  const [events, setEvents] = React.useState<DisruptionRequest[]>([]);
  const [scenarioName, setScenarioName] = React.useState('');

  // Events refer to ids from one dataset; switching baselines clears the queue.
  React.useEffect(() => {
    setEvents([]);
  }, [baselineId]);

  // Keep selections valid whenever the dataset changes
  React.useEffect(() => {
    if (warehouses.length && !warehouses.includes(warehouseId)) setWarehouseId(warehouses[0]);
  }, [warehouses, warehouseId]);
  React.useEffect(() => {
    if (products.length && !products.includes(productId)) setProductId(products[0]);
  }, [products, productId]);
  React.useEffect(() => {
    if (routes.length && !routes.some((r) => r.id === routeId)) setRouteId(routes[0].id);
  }, [routes, routeId]);

  const reductionNumber = Number(reductionPct);
  const extraNumber = Number(extraDays);
  const reductionError =
    type === 'inventory_shortage' &&
    (!Number.isFinite(reductionNumber) || reductionNumber < 0 || reductionNumber > 100)
      ? 'Enter a reduction between 0 and 100.'
      : null;
  const extraError =
    type === 'route_delay' && (!Number.isFinite(extraNumber) || extraNumber < 0 || extraNumber > 365)
      ? 'Enter 0 to 365 extra days.'
      : null;
  const configError = reductionError ?? extraError;

  const currentEvent = (): DisruptionRequest => ({
    type,
    params: buildParams(type, { warehouseId, productId, routeId, reductionPct, extraDays }),
  });

  const addEvent = () => {
    if (events.length >= MAX_EVENTS) return;
    setEvents((prev) => [...prev, currentEvent()]);
  };

  const createMut = useMutation({
    mutationFn: () => createScenario(baselineId, events.length ? events : [currentEvent()], scenarioName),
    onSuccess: (res) => {
      setScenarioId(res.scenario.id);
      setDisruptedPlan(res.disrupted_plan);
      setRecoveredPlan(null);
      qc.invalidateQueries({ queryKey: ['scenarios'] });
      qc.invalidateQueries({ queryKey: ['activity'] });
      qc.invalidateQueries({ queryKey: ['analytics'] });
    },
  });

  const sweepConfig = SWEEP_CONFIG[type];
  const sweepIsDelay = sweepConfig?.parameter === 'extra_days';
  const sweepMut = useMutation({
    mutationFn: () => runSweep(baselineId, currentEvent(), sweepConfig!.parameter, sweepConfig!.values),
  });
  const sweepWorst = sweepMut.data?.worst;
  const sweepWorstText = sweepWorst
    ? sweepIsDelay
      ? `${sweepWorst.value}${sweepConfig?.unit ?? ''} → ${Math.round(sweepWorst.at_risk_units).toLocaleString()} units late`
      : `${sweepWorst.value}${sweepConfig?.unit ?? ''} → ${(sweepWorst.fulfillment_rate * 100).toFixed(1)}% fulfilled`
    : null;

  // A sweep belongs to one configuration; editing it discards the old curve.
  React.useEffect(() => {
    sweepMut.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, baselineId, warehouseId, productId, routeId, reductionPct, extraDays]);

  const disrupted: PlanResponse | undefined = createMut.data?.disrupted_plan;
  const impact: ImpactSummary | undefined = createMut.data?.impact;

  const diagnosisByRow = React.useMemo(() => {
    const map = new Map<string, UnmetDiagnosis>();
    for (const diagnosis of disrupted?.unmet_diagnosis ?? []) {
      map.set(`${diagnosis.destination_id}|${diagnosis.product_id}`, diagnosis);
    }
    return map;
  }, [disrupted]);

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Step 03 · Break"
        title="Disruption Lab"
        description="Branch a baseline plan, mutate real planning inputs, and re-solve to measure the operational impact."
        actions={
          createMut.data ? (
            <Button asChild variant="outline" size="sm">
              <Link to="/recovery">
                Go to recovery <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          ) : null
        }
        meta={
          activeBaseline ? (
            <Badge variant="outline">
              Baseline {activeBaseline.id.slice(0, 8)} ·{' '}
              {((activeBaseline.kpis?.fulfillment_rate ?? 0) * 100).toFixed(1)}% fulfilled
            </Badge>
          ) : null
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1.42fr_0.58fr]">
        <Card className="min-w-0 overflow-hidden">
          <div aria-hidden className="h-1 w-full bg-gradient-to-r from-amber-400 via-red-500 to-rose-500" />
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-red-600/10 bg-red-50 text-red-500">
                <FlaskConical className="h-3.5 w-3.5" />
              </span>
              Configure disruption
            </CardTitle>
            <CardDescription>
              Disruptions modify planning inputs — inventory, lane availability, or transit time. Add up to five
              events; they apply in order.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="baseline-plan" className="mb-1.5 block text-[11px] font-medium text-slate-600">
                  Baseline plan
                </label>
                <Select id="baseline-plan" value={baselineId} onChange={(e) => setBaselineId(e.target.value)}>
                  <option value="">Select a baseline plan…</option>
                  {baselinePlans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id.slice(0, 8)} · {p.created_at.slice(0, 16).replace('T', ' ')} ·{' '}
                      {Math.round((p.kpis?.fulfillment_rate ?? 0) * 100)}% fulfilled
                    </option>
                  ))}
                </Select>
                {!baselinePlans.length ? (
                  <div className="mt-1.5 text-[11px] text-amber-600">
                    No baseline yet —{' '}
                    <Link className="underline" to="/planner">
                      generate one in the Planner
                    </Link>
                    .
                  </div>
                ) : null}
              </div>
              <div>
                <label htmlFor="scenario-name" className="mb-1.5 block text-[11px] font-medium text-slate-600">
                  Scenario name (optional)
                </label>
                <Input
                  id="scenario-name"
                  value={scenarioName}
                  maxLength={80}
                  placeholder="e.g. Q4 lane closure + warehouse outage"
                  onChange={(e) => setScenarioName(e.target.value)}
                />
              </div>
            </div>

            <div className="h-px bg-slate-900/[0.06]" />

            <div>
              <label htmlFor="disruption-type" className="mb-1.5 block text-[11px] font-medium text-slate-600">
                Disruption type
              </label>
              <Select id="disruption-type" value={type} onChange={(e) => setType(e.target.value as DisruptionType)}>
                {(Object.keys(TYPE_LABELS) as DisruptionType[]).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
              <div className="mt-1.5 flex items-start gap-1.5 text-[10.5px] leading-relaxed text-slate-500">
                <Info className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" />
                {TYPE_HELP[type]}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {(type === 'inventory_shortage' || type === 'supply_interruption') && (
                <>
                  <div>
                    <label htmlFor="warehouse" className="mb-1.5 block text-[11px] font-medium text-slate-600">
                      Warehouse
                    </label>
                    <Select id="warehouse" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                      {warehouses.map((w) => (
                        <option key={w} value={w}>
                          {w}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <label htmlFor="product" className="mb-1.5 block text-[11px] font-medium text-slate-600">
                      Product
                    </label>
                    <Select id="product" value={productId} onChange={(e) => setProductId(e.target.value)}>
                      {products.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </Select>
                  </div>
                </>
              )}
              {type === 'inventory_shortage' && (
                <div>
                  <label htmlFor="reduction-pct" className="mb-1.5 block text-[11px] font-medium text-slate-600">
                    Reduction (%)
                  </label>
                  <Input
                    id="reduction-pct"
                    type="number"
                    min={0}
                    max={100}
                    step="any"
                    value={reductionPct}
                    onChange={(e) => setReductionPct(e.target.value)}
                    aria-invalid={Boolean(reductionError)}
                    aria-describedby={reductionError ? 'reduction-pct-error' : undefined}
                  />
                  {reductionError ? (
                    <p id="reduction-pct-error" className="mt-1 text-[10.5px] text-red-600">
                      {reductionError}
                    </p>
                  ) : null}
                </div>
              )}
              {(type === 'route_closure' || type === 'route_delay') && (
                <div className={type === 'route_closure' ? 'md:col-span-2' : undefined}>
                  <label htmlFor="route" className="mb-1.5 block text-[11px] font-medium text-slate-600">
                    Route
                  </label>
                  <Select id="route" value={routeId} onChange={(e) => setRouteId(e.target.value)}>
                    {routes.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                        {r.backup ? ' (contingency)' : ''}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              {type === 'route_delay' && (
                <div>
                  <label htmlFor="extra-days" className="mb-1.5 block text-[11px] font-medium text-slate-600">
                    Extra transit days
                  </label>
                  <Input
                    id="extra-days"
                    type="number"
                    min={0}
                    max={365}
                    step="any"
                    value={extraDays}
                    onChange={(e) => setExtraDays(e.target.value)}
                    aria-invalid={Boolean(extraError)}
                    aria-describedby={extraError ? 'extra-days-error' : undefined}
                  />
                  {extraError ? (
                    <p id="extra-days-error" className="mt-1 text-[10.5px] text-red-600">
                      {extraError}
                    </p>
                  ) : null}
                </div>
              )}
            </div>

            {type === 'route_delay' ? (
              <p className="flex items-start gap-2 rounded-xl border border-amber-600/15 bg-amber-50/70 p-3 text-[11px] leading-relaxed text-amber-800">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Delay semantics: transit time increases and shipments can breach destination deadlines (reported as
                at-risk units). It does not remove capacity, so fulfillment may stay unchanged — that is the
                documented behaviour.
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 border-t border-slate-900/[0.06] pt-4">
              <Button
                onClick={() => createMut.mutate()}
                disabled={!baselineId || Boolean(configError) || createMut.isPending}
              >
                <Zap className="h-4 w-4" />
                {createMut.isPending ? 'Simulating…' : 'Simulate disruption'}
              </Button>
              <Button variant="outline" onClick={addEvent} disabled={events.length >= MAX_EVENTS || Boolean(configError)}>
                <Plus className="h-4 w-4" />
                Add to scenario
              </Button>
              <span className="max-w-md text-[11px] leading-relaxed text-slate-500">
                {events.length
                  ? 'Simulation runs the event list on the right.'
                  : 'Nothing added yet — the configuration above is simulated as one event. Add events to combine failures.'}
              </span>
            </div>

            {createMut.isError ? (
              <div className="rounded-xl border border-red-600/15 bg-red-50 p-3 text-[12.5px] text-red-700">
                {String((createMut.error as Error).message)}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2">
                <ListOrdered className="h-4 w-4 text-slate-400" /> Scenario queue
              </CardTitle>
              {events.length ? (
                <button
                  type="button"
                  onClick={() => setEvents([])}
                  className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-slate-400 transition-colors hover:text-slate-800"
                >
                  Clear
                </button>
              ) : null}
            </CardHeader>
            <CardContent>
              {events.length ? (
                <>
                  <div className="text-[11px] font-medium text-slate-600">
                    Combined scenario · {events.length}/{MAX_EVENTS} events
                  </div>
                  <ol className="mt-2 space-y-1.5">
                    {events.map((event, index) => (
                      <li
                        key={`${event.type}-${index}`}
                        className="group flex items-center gap-2 rounded-lg border border-slate-900/[0.07] bg-slate-50/60 px-2.5 py-1.5 text-[11px] text-slate-700"
                      >
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-white font-mono text-[9px] text-slate-400 shadow-sm">
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{describeDisruption(event)}</span>
                        <button
                          type="button"
                          onClick={() => setEvents((prev) => prev.filter((_, i) => i !== index))}
                          className="rounded-md p-0.5 text-slate-300 transition-colors hover:bg-white hover:text-slate-700"
                          aria-label={`Remove disruption ${index + 1}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </li>
                    ))}
                  </ol>
                </>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300/80 bg-slate-50/50 p-4 text-[11.5px] leading-relaxed text-slate-500">
                  Queue is empty. The single configured event will be simulated. Add events to stack failures.
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="overflow-hidden bg-ink-900 text-white">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <Activity className="h-4 w-4 text-emerald-300/80" /> Next run
              </CardTitle>
              <CardDescription className="text-white/40">
                {events.length
                  ? 'The queue above is applied in order on the next re-solve.'
                  : 'The exact input mutation that will be applied on re-solve.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.035] p-3 font-mono text-[11px] leading-relaxed text-white/70">
                {events.length
                  ? `${events.length} queued event${events.length === 1 ? '' : 's'} · applied in order`
                  : describeDisruption(currentEvent())}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="rounded-md border border-white/[0.07] bg-white/[0.03] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-white/40">
                  {events.length ? 'queued' : 'will run'}
                </span>
                <span className="rounded-md border border-white/[0.07] bg-white/[0.03] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-white/40">
                  re-solve
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {sweepConfig ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-900/[0.07] bg-slate-50 text-slate-500">
                <Activity className="h-3.5 w-3.5" />
              </span>
              Sensitivity sweep
            </CardTitle>
            <CardDescription>
              Re-solve the disruption configured above across several {sweepConfig.label.toLowerCase()} values. Every
              point is computed; nothing is stored.
              {sweepIsDelay ? ' Delays preserve volume, so the curve tracks units that miss their deadlines.' : ''}
              {events.length ? ' Queued events are not swept — a sweep tests exactly one disruption configuration.' : ''}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                onClick={() => sweepMut.mutate()}
                disabled={!baselineId || Boolean(configError) || sweepMut.isPending || events.length > 0}
                title={events.length ? 'Clear queued events to sweep a single disruption' : undefined}
              >
                {sweepMut.isPending ? 'Solving points…' : events.length ? 'Sweep a single disruption' : 'Run sensitivity sweep'}
              </Button>
              <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-slate-400">
                {sweepConfig.values.map((value) => `${value}${sweepConfig.unit}`).join(' · ')}
              </span>
            </div>

            {sweepMut.isError ? (
              <div className="rounded-xl border border-red-600/15 bg-red-50 p-3 text-[12.5px] text-red-700">
                {String((sweepMut.error as Error).message)}
              </div>
            ) : null}

            {sweepMut.data ? (
              <div className="space-y-3">
                <p className="text-[11px] text-slate-500">
                  Baseline {(sweepMut.data.baseline.fulfillment_rate * 100).toFixed(1)}% fulfilled
                  {sweepWorstText ? ` · worst case ${sweepWorstText}` : ''}
                </p>
                <div
                  className="h-56 w-full rounded-xl border border-slate-900/[0.06] bg-slate-50/30 p-2"
                  role="img"
                  aria-label={sweepIsDelay ? 'At-risk units by extra transit days' : 'Fulfillment by stock reduction'}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={sweepMut.data.points.map((point) => ({
                        ...point,
                        metric: sweepIsDelay ? point.at_risk_units : point.fulfillment_rate * 100,
                      }))}
                      margin={{ top: 12, right: 16, bottom: 0, left: 0 }}
                    >
                      <CartesianGrid vertical={false} stroke="#e9ecf0" strokeDasharray="3 6" />
                      <XAxis
                        dataKey="value"
                        tickFormatter={(value) => `${value}${sweepConfig.unit}`}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 10, fill: '#94a3b8' }}
                        dy={6}
                      />
                      <YAxis
                        domain={sweepIsDelay ? [0, 'auto'] : [0, 100]}
                        tickFormatter={(value) =>
                          sweepIsDelay ? `${Math.round(Number(value))}` : `${value}%`
                        }
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 10, fill: '#94a3b8' }}
                        width={38}
                      />
                      <Tooltip
                        content={
                          <ChartTooltip
                            valueFormatter={(value) =>
                              sweepIsDelay
                                ? `${Math.round(value).toLocaleString()} units`
                                : `${value.toFixed(1)}%`
                            }
                            labelFormatter={(label) => `${sweepConfig.label}: ${label}${sweepConfig.unit}`}
                          />
                        }
                      />
                      <Line
                        type="monotone"
                        dataKey="metric"
                        name={sweepIsDelay ? 'At risk' : 'Fulfilled'}
                        stroke="#0f766e"
                        strokeWidth={2.5}
                        dot={{ r: 3, fill: '#0f766e', strokeWidth: 2, stroke: '#fff' }}
                        activeDot={{ r: 5, strokeWidth: 0 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{sweepConfig.label}</TableHead>
                      {sweepIsDelay ? (
                        <>
                          <TableHead className="text-right">At risk</TableHead>
                          <TableHead className="text-right">Max late</TableHead>
                        </>
                      ) : (
                        <>
                          <TableHead className="text-right">Fulfilled</TableHead>
                          <TableHead className="text-right">Unmet</TableHead>
                        </>
                      )}
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead>Dominant cause</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sweepMut.data.points.map((point) => (
                      <TableRow key={point.value}>
                        <TableCell className="font-mono text-[11px]">
                          {point.value}
                          {sweepConfig.unit}
                        </TableCell>
                        {sweepIsDelay ? (
                          <>
                            <TableCell className="text-right tabular">
                              {Math.round(point.at_risk_units).toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right tabular">{Math.round(point.max_late_days)} d</TableCell>
                          </>
                        ) : (
                          <>
                            <TableCell className="text-right tabular">
                              {(point.fulfillment_rate * 100).toFixed(1)}%
                            </TableCell>
                            <TableCell className="text-right tabular">
                              {Math.round(point.unmet).toLocaleString()}
                            </TableCell>
                          </>
                        )}
                        <TableCell className="text-right tabular">
                          ${Math.round(point.total_cost).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {Object.keys(point.cause_counts).length
                              ? causeLabel(dominantCause(point.cause_counts))
                              : 'No gap'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="text-[11px] leading-relaxed text-slate-500">{sweepMut.data.note}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {disrupted && impact ? (
        <>
          <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Stat
              label="Fulfillment Δ"
              value={`${(impact.fulfillment_delta * 100).toFixed(1)}pp`}
              sub="versus baseline"
              icon={impact.fulfillment_delta < 0 ? TrendingDown : TrendingUp}
              tone={impact.fulfillment_delta < 0 ? 'danger' : 'success'}
            />
            <Stat
              label="Cost Δ"
              value={`${impact.cost_delta >= 0 ? '+' : '−'}$${Math.abs(Math.round(impact.cost_delta)).toLocaleString()}`}
              sub="versus baseline"
              icon={impact.cost_delta > 0 ? TrendingUp : TrendingDown}
              tone={impact.cost_delta > 0 ? 'warning' : 'success'}
            />
            <Stat
              label="Unmet Δ"
              value={Math.round(impact.unmet_delta).toLocaleString()}
              sub="units added shortfall"
              icon={TrendingDown}
              tone={impact.unmet_delta > 0 ? 'danger' : 'success'}
            />
            <Stat
              label="Risk score"
              value={disrupted.kpis.risk_score.toFixed(1)}
              sub={`${disrupted.kpis.at_risk_destinations} at-risk destination(s)`}
              tone={disrupted.kpis.risk_score >= 40 ? 'danger' : disrupted.kpis.risk_score >= 20 ? 'warning' : 'success'}
              bar={disrupted.kpis.risk_score / 100}
            />
          </section>

          <Card>
            <CardHeader>
              <CardTitle>What changed</CardTitle>
              <CardDescription>The difference between two computed plans, stated plainly.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-[13.5px] leading-relaxed text-slate-700">{impact.disruption_description}</p>
              <div className="flex flex-wrap gap-2">
                <Badge variant="destructive">Disrupted · {disrupted.solver}</Badge>
                <Badge variant={solverStatusTone(disrupted.solver_status, disrupted.kpis.unmet)}>
                  {disrupted.solver_status ?? disrupted.status}
                </Badge>
                <Badge variant="secondary">{(disrupted.kpis.fulfillment_rate * 100).toFixed(1)}% fulfilled</Badge>
                <Badge variant="secondary">{Math.round(disrupted.kpis.unmet).toLocaleString()} unmet</Badge>
                <Badge variant="secondary">${Math.round(disrupted.kpis.total_cost).toLocaleString()} cost</Badge>
              </div>
            </CardContent>
          </Card>

          {impact.delivery_risk && impact.at_risk_units ? (
            <Card className="border-amber-600/20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-amber-600" /> Deadline exposure
                </CardTitle>
                <CardDescription>
                  {Math.round(impact.at_risk_units).toLocaleString()} units arrive later than the destination deadline
                  {impact.max_late_days ? ` (up to ${impact.max_late_days} days late)` : ''}.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Destination</TableHead>
                      <TableHead>Route</TableHead>
                      <TableHead className="text-right">Units</TableHead>
                      <TableHead className="text-right">Transit</TableHead>
                      <TableHead className="text-right">Deadline</TableHead>
                      <TableHead className="text-right">Late by</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {impact.delivery_risk.at_risk_shipments.slice(0, 15).map((s, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-[11px] text-slate-700">{s.destination_id}</TableCell>
                        <TableCell className="font-mono text-[11px] text-slate-700">{s.route_id}</TableCell>
                        <TableCell className="text-right tabular">{Math.round(s.quantity).toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular">{s.transit_days}d</TableCell>
                        <TableCell className="text-right tabular">{s.deadline_days}d</TableCell>
                        <TableCell className="text-right font-medium tabular text-amber-700">{s.late_by_days}d</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Disrupted allocations</CardTitle>
                <CardDescription>{disrupted.allocations.length} shipment(s) after re-solve</CardDescription>
              </CardHeader>
              <CardContent className="max-h-96 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>WH</TableHead>
                      <TableHead>Dest</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Route</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {disrupted.allocations.map((a, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-[11px] text-slate-700">{a.warehouse_id}</TableCell>
                        <TableCell className="font-mono text-[11px] text-slate-700">{a.destination_id}</TableCell>
                        <TableCell className="font-mono text-[11px] text-slate-700">{a.product_id}</TableCell>
                        <TableCell className="font-mono text-[11px] text-slate-700">{a.route_id}</TableCell>
                        <TableCell className="text-right tabular">{Math.round(a.quantity).toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Unmet demand after disruption</CardTitle>
                <CardDescription>
                  {disrupted.unmet.length === 0
                    ? 'Volume fully preserved by this disruption.'
                    : `${disrupted.unmet.length} destination × product gap(s)`}
                </CardDescription>
              </CardHeader>
              <CardContent className="max-h-96 overflow-auto">
                {disrupted.unmet.length === 0 ? (
                  <div className="rounded-xl border border-emerald-600/15 bg-emerald-50 p-3 text-[12.5px] text-emerald-700">
                    All requested volume is still shipped. Check deadline exposure above for time-based impact.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Destination</TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead className="text-right">Unmet</TableHead>
                        <TableHead>Cause</TableHead>
                        <TableHead>Priority</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {disrupted.unmet.map((u, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-[11px] text-slate-700">{u.destination_id}</TableCell>
                          <TableCell className="font-mono text-[11px] text-slate-700">{u.product_id}</TableCell>
                          <TableCell className="text-right font-medium tabular text-red-600">
                            {Math.round(u.quantity).toLocaleString()}
                          </TableCell>
                          <TableCell>
                            <CauseBadge diagnosis={diagnosisByRow.get(`${u.destination_id}|${u.product_id}`)} />
                          </TableCell>
                          <TableCell>
                            <Badge variant={u.priority <= 2 ? 'destructive' : 'warning'}>P{u.priority}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}

function dominantCause(counts: Record<string, number>): string | undefined {
  const entries = Object.entries(counts);
  if (!entries.length) return undefined;
  return entries.sort((a, b) => b[1] - a[1])[0][0];
}

function describeDisruption(event: DisruptionRequest): string {
  const params = event.params as Record<string, unknown>;
  switch (event.type) {
    case 'route_closure':
      return `Close ${String(params.route_id)}`;
    case 'route_delay':
      return `Delay ${String(params.route_id)} +${String(params.extra_days)}d`;
    case 'inventory_shortage':
      return `Shortage ${String(params.warehouse_id)}/${String(params.product_id)} −${String(params.reduction_pct)}%`;
    case 'supply_interruption':
      return `Supply stop ${String(params.warehouse_id)}/${String(params.product_id)}`;
    default:
      return event.type.replace(/_/g, ' ');
  }
}

function buildParams(
  type: DisruptionType,
  f: { warehouseId: string; productId: string; routeId: string; reductionPct: string; extraDays: string },
) {
  switch (type) {
    case 'inventory_shortage':
      return { warehouse_id: f.warehouseId, product_id: f.productId, reduction_pct: Number(f.reductionPct) };
    case 'route_closure':
      return { route_id: f.routeId };
    case 'route_delay':
      return { route_id: f.routeId, extra_days: Number(f.extraDays) };
    case 'supply_interruption':
      return { warehouse_id: f.warehouseId, product_id: f.productId };
  }
}
