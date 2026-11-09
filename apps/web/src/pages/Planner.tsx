import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Calculator,
  CheckCircle2,
  Clock3,
  Info,
  Play,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { ConfirmDialog } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { notify } from '../components/ui/toast';
import { Select } from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { PageHeader } from '../components/PageHeader';
import { Stat } from '../components/Stat';
import { EmptyState } from '../components/EmptyState';
import { CauseBadge } from '../components/CauseBadge';
import { listDatasets, createPlan, getPlan, getDataset, listPlans, deletePlan, type PlanSummary, type UnmetDiagnosis } from '../lib/api';
import { cn, solverStatusTone } from '../lib/utils';
import { useAppStore } from '../stores/appStore';

const CONSTRAINTS = ['Inventory', 'Lane capacity', 'Availability', 'Eligibility', 'Priority'];

export default function Planner() {
  const qc = useQueryClient();
  const { datasetId, setDatasetId, planId, setPlanId, setBaselinePlan } = useAppStore();
  const [solver, setSolver] = React.useState<string>('');
  const [respectDeadlines, setRespectDeadlines] = React.useState(false);
  const [planToDelete, setPlanToDelete] = React.useState<PlanSummary | null>(null);

  const { data: datasets } = useQuery({ queryKey: ['datasets'], queryFn: listDatasets });
  const { data: plansData } = useQuery({ queryKey: ['plans', 25], queryFn: () => listPlans(25) });

  const { data: dataset } = useQuery({
    queryKey: ['dataset', datasetId],
    queryFn: () => getDataset(datasetId!),
    enabled: !!datasetId,
  });

  // Auto-pick the newest dataset so the page is usable immediately after import
  React.useEffect(() => {
    if (!datasetId && datasets?.datasets?.length) setDatasetId(datasets.datasets[0].id);
  }, [datasets, datasetId, setDatasetId]);

  const baselines = (plansData?.plans ?? []).filter((p) => p.type === 'baseline');
  const activePlanId = planId ?? baselines[0]?.id ?? null;
  const [planSearch, setPlanSearch] = React.useState('');
  const planFilter = planSearch.trim().toLowerCase();
  const filteredBaselines = planFilter
    ? baselines.filter((p) =>
        [p.id, p.solver, p.solver_status ?? '', p.constraints?.respect_deadlines ? 'enforced' : 'kpi only']
          .join(' ')
          .toLowerCase()
          .includes(planFilter),
      )
    : baselines;

  React.useEffect(() => {
    if (!planId && baselines.length) setPlanId(baselines[0].id);
  }, [planId, baselines, setPlanId]);

  const planQuery = useQuery({
    queryKey: ['plan', activePlanId],
    queryFn: () => getPlan(activePlanId!),
    enabled: !!activePlanId,
  });

  const createMut = useMutation({
    mutationFn: () => createPlan(datasetId!, solver || undefined, respectDeadlines),
    onSuccess: (res) => {
      setPlanId(res.id);
      setBaselinePlan(res);
      notify(
        'Baseline solved',
        `${res.allocations.length} allocations · ${(res.kpis.fulfillment_rate * 100).toFixed(1)}% fulfilled`,
        'success',
      );
      qc.invalidateQueries({ queryKey: ['plans'] });
      qc.invalidateQueries({ queryKey: ['activity'] });
      qc.invalidateQueries({ queryKey: ['analytics'] });
    },
    onError: (err) => notify('Baseline failed', String((err as Error).message), 'danger'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deletePlan(id),
    onSuccess: (res) => {
      setPlanToDelete(null);
      if (res.plan_id === planId) setPlanId(null);
      notify('Plan deleted', `${res.plan_id.slice(0, 8)} removed from the workspace.`, 'success');
      qc.invalidateQueries({ queryKey: ['plans'] });
      qc.invalidateQueries({ queryKey: ['activity'] });
      qc.invalidateQueries({ queryKey: ['analytics'] });
    },
    onError: (err) => notify('Delete blocked', String((err as Error).message), 'warning'),
  });

  const onDeletePlan = (p: PlanSummary) => setPlanToDelete(p);

  const plan = planQuery.data;
  const kpis = plan?.kpis;
  const solverStatus = plan?.solver_status ?? null;
  const solverBadge = solverStatusTone(solverStatus, kpis?.unmet);

  const diagnosisByRow = React.useMemo(() => {
    const map = new Map<string, UnmetDiagnosis>();
    for (const diagnosis of plan?.unmet_diagnosis ?? []) {
      map.set(`${diagnosis.destination_id}|${diagnosis.product_id}`, diagnosis);
    }
    return map;
  }, [plan]);

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Step 02 · Solve"
        title="Baseline Planner"
        description="Solve a constrained allocation for the active dataset, then review every shipment and gap."
        actions={
          kpis ? (
            <>
              <Button asChild variant="outline" size="sm">
                <Link to="/resilience">
                  Assess resilience <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to="/disruption">
                  Simulate a disruption <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </>
          ) : null
        }
        meta={dataset ? <Badge variant="outline">{dataset.name}</Badge> : null}
      />

      <Card className="overflow-hidden">
        <div aria-hidden className="h-1 w-full bg-gradient-to-r from-emerald-500 via-teal-500 to-sky-500" />
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-900/[0.07] bg-slate-50 text-slate-500">
              <Calculator className="h-3.5 w-3.5" />
            </span>
            Generate baseline
          </CardTitle>
          <CardDescription>
            Constraints enforced: warehouse inventory, route capacity, lane availability, product eligibility,
            destination priority — plus deadlines when enabled.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-[11px] font-medium text-slate-600">Dataset</label>
              <Select value={datasetId ?? ''} onChange={(e) => setDatasetId(e.target.value || null)}>
                <option value="">Select dataset</option>
                {datasets?.datasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} — {d.id.slice(0, 8)}
                  </option>
                ))}
              </Select>
              {dataset ? (
                <div className="mt-1.5 flex flex-wrap gap-x-2 text-[10.5px] text-slate-500">
                  <span>{dataset.meta.warehouses?.length ?? 0} warehouses</span>
                  <span className="text-slate-300">·</span>
                  <span>{dataset.meta.destinations?.length ?? 0} destinations</span>
                  <span className="text-slate-300">·</span>
                  <span>{dataset.meta.routes?.length ?? 0} lanes</span>
                </div>
              ) : null}
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-medium text-slate-600">Solver</label>
              <Select value={solver} onChange={(e) => setSolver(e.target.value)}>
                <option value="">Auto (server default)</option>
                <option value="greedy">Greedy baseline</option>
                <option value="ortools">OR-Tools (if installed)</option>
              </Select>
              <div className="mt-1.5 text-[10.5px] text-slate-500">The engine reports whether it proved optimality.</div>
            </div>
            <div className="flex items-end">
              <Button onClick={() => createMut.mutate()} disabled={!datasetId || createMut.isPending} className="w-full">
                <Play className="h-4 w-4" />
                {createMut.isPending ? 'Solving…' : 'Generate baseline'}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {CONSTRAINTS.map((constraint) => (
              <span
                key={constraint}
                className="rounded-md border border-slate-900/[0.07] bg-slate-50 px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.1em] text-slate-500"
              >
                {constraint}
              </span>
            ))}
            <span
              className={cn(
                'rounded-md px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.1em]',
                respectDeadlines
                  ? 'border border-emerald-600/15 bg-emerald-50 text-emerald-700'
                  : 'border border-slate-900/[0.07] bg-slate-50 text-slate-400',
              )}
            >
              Deadlines {respectDeadlines ? 'enforced' : 'KPI only'}
            </span>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-900/[0.07] bg-slate-50/60 p-3.5 text-[12px] text-slate-600 transition-colors hover:border-slate-300">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-emerald-600"
              checked={respectDeadlines}
              onChange={(e) => setRespectDeadlines(e.target.checked)}
            />
            <span>
              <span className="block font-medium text-slate-800">Enforce destination deadlines</span>
              <span className="mt-0.5 block leading-relaxed text-slate-500">
                Only lanes that arrive by the destination deadline may be used. Off by default — deadlines are
                reported as a KPI.
              </span>
            </span>
            <Clock3 className="ml-auto hidden h-4 w-4 shrink-0 text-slate-400 sm:block" />
          </label>

          {createMut.isError ? (
            <div className="flex items-start gap-2 rounded-xl border border-red-600/15 bg-red-50 p-3 text-[12.5px] text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {String((createMut.error as Error).message)}
            </div>
          ) : null}
          {createMut.isSuccess ? (
            <div className="flex items-start gap-2 rounded-xl border border-emerald-600/15 bg-emerald-50 p-3 text-[12.5px] text-emerald-800">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Baseline plan created — {createMut.data.id.slice(0, 8)} · {createMut.data.allocations.length}{' '}
                allocations · {(createMut.data.kpis.fulfillment_rate * 100).toFixed(1)}% fulfilled · solver{' '}
                {createMut.data.solver_status ?? 'reported'}
              </span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {baselines.length > 1 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-3">
              <span>Baseline plans</span>
              <Badge variant="secondary">{filteredBaselines.length}</Badge>
            </CardTitle>
            <CardDescription>Select which solved plan to inspect and branch from.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                type="search"
                value={planSearch}
                onChange={(event) => setPlanSearch(event.target.value)}
                aria-label="Search baseline plans"
                placeholder="Search by plan id, solver or deadline policy"
                className="pl-9"
              />
            </div>
            {!filteredBaselines.length ? (
              <p className="py-6 text-center text-[13px] text-slate-500">
                No baseline plan matches “{planSearch.trim()}”.
              </p>
            ) : (
            <div className="max-h-[22rem] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Plan</TableHead>
                    <TableHead>Solver</TableHead>
                    <TableHead>Deadlines</TableHead>
                    <TableHead className="text-right">Fulfillment</TableHead>
                    <TableHead className="text-right">Unmet</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredBaselines.map((p) => (
                    <TableRow key={p.id} className={p.id === activePlanId ? 'bg-emerald-50/30' : undefined}>
                      <TableCell className="font-mono text-[11px]">{p.id.slice(0, 8)}</TableCell>
                      <TableCell className="text-[11.5px] text-slate-600">
                        {p.solver}
                        {p.solver_status ? ` · ${p.solver_status}` : ''}
                      </TableCell>
                      <TableCell className="text-[11.5px] text-slate-600">
                        {p.constraints?.respect_deadlines ? 'Enforced' : 'KPI only'}
                      </TableCell>
                      <TableCell className="text-right tabular">{((p.kpis?.fulfillment_rate ?? 0) * 100).toFixed(1)}%</TableCell>
                      <TableCell className="text-right tabular">{Math.round(p.kpis?.unmet ?? 0)}</TableCell>
                      <TableCell className="text-right tabular">${Math.round(p.kpis?.total_cost ?? 0).toLocaleString()}</TableCell>
                      <TableCell className="text-[11px] text-slate-500">{p.created_at.slice(0, 16).replace('T', ' ')}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant={p.id === activePlanId ? 'default' : 'outline'} onClick={() => setPlanId(p.id)}>
                            {p.id === activePlanId ? 'Active' : 'Inspect'}
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-slate-500 hover:text-red-600"
                            aria-label={`Delete plan ${p.id.slice(0, 8)}`}
                            title="Delete this baseline plan"
                            onClick={() => onDeletePlan(p)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {!plan ? (
        <EmptyState
          icon={Sparkles}
          title="No plan selected"
          description="Generate a baseline to see allocations, gaps, risk components and solver diagnostics."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={solverBadge}>{solverStatus ?? plan.status}</Badge>
            <Badge variant="outline">Solver: {plan.solver}</Badge>
            <Badge variant="outline">
              Deadlines: {plan.constraints?.respect_deadlines ? 'enforced' : 'KPI only'}
            </Badge>
            <Badge variant="secondary">{plan.id.slice(0, 12)}…</Badge>
            <span className="text-[11px] text-slate-500">{new Date(plan.created_at).toLocaleString()}</span>
          </div>

          {kpis ? (
            <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Stat label="Inventory" value={Math.round(kpis.total_inventory).toLocaleString()} sub="units on hand" />
              <Stat label="Demand" value={Math.round(kpis.total_demand).toLocaleString()} sub="units requested" />
              <Stat
                label="Fulfilled"
                value={Math.round(kpis.fulfilled).toLocaleString()}
                sub="units shipped"
                tone="success"
              />
              <Stat
                label="Unmet"
                value={Math.round(kpis.unmet).toLocaleString()}
                sub="units short"
                tone={kpis.unmet > 0.001 ? 'danger' : 'success'}
              />
              <Stat
                label="Fulfillment"
                value={`${(kpis.fulfillment_rate * 100).toFixed(1)}%`}
                sub="of requested volume"
                tone="success"
                bar={kpis.fulfillment_rate}
              />
              <Stat
                label="Cost"
                value={`$${Math.round(kpis.total_cost).toLocaleString()}`}
                sub="allocation cost"
                tone="warning"
              />
            </section>
          ) : null}

          <Card>
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle>Allocations</CardTitle>
                <CardDescription>
                  {plan.allocations.length} shipment(s). Each row is quantity shipped from a warehouse on a specific
                  lane.
                </CardDescription>
              </div>
              <Badge variant="secondary">{plan.allocations.length} rows</Badge>
            </CardHeader>
            <CardContent className="max-h-[28rem] overflow-auto">
              {plan.allocations.length === 0 ? (
                <div className="py-6 text-center text-[13px] text-slate-500">
                  No allocation possible under current constraints.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Warehouse</TableHead>
                      <TableHead>Destination</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Route</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {plan.allocations.map((a, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-[11px] text-slate-700">{a.warehouse_id}</TableCell>
                        <TableCell className="font-mono text-[11px] text-slate-700">{a.destination_id}</TableCell>
                        <TableCell className="font-mono text-[11px] text-slate-700">{a.product_id}</TableCell>
                        <TableCell>
                          <span className="rounded-md border border-slate-900/[0.07] bg-slate-50 px-1.5 py-0.5 font-mono text-[10.5px] text-slate-600">
                            {a.route_id}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-medium tabular">{Math.round(a.quantity).toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Unmet demand</CardTitle>
              <CardDescription>Demand that constraints prevented from being fulfilled.</CardDescription>
            </CardHeader>
            <CardContent>
              {plan.unmet.length === 0 ? (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-600/15 bg-emerald-50 p-3 text-[12.5px] text-emerald-800">
                  <CheckCircle2 className="h-4 w-4" /> All demand fulfilled under the modelled constraints.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Destination</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Unmet qty</TableHead>
                      <TableHead>Cause</TableHead>
                      <TableHead>Priority</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {plan.unmet.map((u, i) => (
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

          {kpis?.risk_breakdown ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Info className="h-4 w-4 text-slate-400" /> Risk score breakdown
                </CardTitle>
                <CardDescription>
                  Documented weights: unmet rate 50, route utilization 20, at-risk destinations 15, cost per unit 15.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    ['Unmet component', kpis.risk_breakdown.unmet_component, 50, 'bg-red-500'],
                    ['Route component', kpis.risk_breakdown.route_component, 20, 'bg-slate-800'],
                    ['At-risk component', kpis.risk_breakdown.at_risk_component, 15, 'bg-amber-500'],
                    ['Cost component', kpis.risk_breakdown.cost_component, 15, 'bg-sky-500'],
                  ].map(([label, value, max, color]) => {
                    const numeric = Number(value ?? 0);
                    const cap = Number(max);
                    return (
                      <div key={String(label)} className="rounded-xl border border-slate-900/[0.07] bg-slate-50/50 p-3.5">
                        <div className="text-eyebrow">{String(label)}</div>
                        <div className="mt-1.5 text-lg font-semibold tabular text-slate-900">
                          {numeric.toFixed(1)}
                          <span className="ml-1 text-[11px] font-normal text-slate-400">/ {cap}</span>
                        </div>
                        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-slate-900/[0.06]">
                          <div
                            className={cn('h-full origin-left rounded-full', String(color))}
                            style={{ width: `${Math.max(0, Math.min(1, numeric / cap)) * 100}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 flex items-start gap-2 rounded-xl bg-slate-900/[0.03] p-3 text-[11px] leading-relaxed text-slate-500">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                  {String(kpis.risk_breakdown.description ?? '')}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {plan.diagnostics ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-slate-400" /> Solver diagnostics
                </CardTitle>
                <CardDescription>Feasibility and solver status are reported explicitly — never assumed.</CardDescription>
              </CardHeader>
              <CardContent>
                <details className="group">
                  <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg border border-slate-900/[0.07] bg-slate-50 px-2.5 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-slate-500 transition-colors hover:text-slate-800">
                    <span className="transition-transform group-open:rotate-90">▸</span>
                    Raw solver payload
                  </summary>
                  <pre className="mt-3 max-h-64 overflow-auto rounded-xl border border-white/[0.06] bg-ink-900 p-4 font-mono text-[11px] leading-relaxed text-slate-100">
                    {JSON.stringify(plan.diagnostics, null, 2)}
                  </pre>
                </details>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}

      <ConfirmDialog
        open={!!planToDelete}
        title="Delete baseline plan"
        description={
          planToDelete ? (
            <>
              Plan <strong>{planToDelete.id.slice(0, 8)}</strong> will be removed. If a scenario references it,
              the delete is rejected and the scenario remains intact.
            </>
          ) : null
        }
        confirmLabel="Delete plan"
        destructive
        busy={deleteMut.isPending}
        onConfirm={() => {
          if (planToDelete) deleteMut.mutate(planToDelete.id);
        }}
        onClose={() => setPlanToDelete(null)}
      />
    </div>
  );
}
