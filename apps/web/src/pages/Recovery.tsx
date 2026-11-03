import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  CheckCircle2,
  HeartPulse,
  Pencil,
  RefreshCw,
  Route,
  Trash2,
  Wrench,
  Zap,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Select } from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { PageHeader } from '../components/PageHeader';
import { PlanJourney } from '../components/PlanJourney';
import { CauseBadge } from '../components/CauseBadge';
import {
  compareScenario,
  deleteScenario,
  getScenario,
  listScenarios,
  recoverScenario,
  renameScenario,
  type KPISnapshot,
  type RecoveryAction,
  type ScenarioSummary,
  type UnmetDemand,
  type UnmetDiagnosis,
} from '../lib/api';
import { cn, disruptionLabel, scenarioTitle } from '../lib/utils';
import { useAppStore } from '../stores/appStore';

const ACTION_META: Record<string, { icon: React.ElementType; chip: string; label: string }> = {
  activate_contingency_lane: {
    icon: Route,
    chip: 'border-amber-600/15 bg-amber-50 text-amber-600',
    label: 'Contingency lane',
  },
  reallocate: {
    icon: ArrowLeftRight,
    chip: 'border-sky-600/15 bg-sky-50 text-sky-600',
    label: 'Reallocation',
  },
  residual_unmet: {
    icon: AlertTriangle,
    chip: 'border-red-600/15 bg-red-50 text-red-600',
    label: 'Residual gap',
  },
  fully_recovered: {
    icon: CheckCircle2,
    chip: 'border-emerald-600/15 bg-emerald-50 text-emerald-600',
    label: 'Recovered',
  },
};

export default function Recovery() {
  const qc = useQueryClient();
  const { scenarioId, setScenarioId, setRecoveredPlan } = useAppStore();
  const [sid, setSid] = React.useState(scenarioId ?? '');

  const { data: scenarioList } = useQuery({ queryKey: ['scenarios'], queryFn: () => listScenarios(50) });
  const scenarios = scenarioList?.scenarios ?? [];

  React.useEffect(() => {
    if (scenarioId) setSid(scenarioId);
  }, [scenarioId]);
  React.useEffect(() => {
    if (!sid && scenarios.length) setSid(scenarios[0].id);
  }, [scenarios, sid]);

  const compareQuery = useQuery({
    queryKey: ['compare', sid],
    queryFn: () => compareScenario(sid),
    enabled: !!sid,
  });

  // Persisted recovery result, so the action list survives a page reload
  const scenarioQuery = useQuery({
    queryKey: ['scenario', sid],
    queryFn: () => getScenario(sid),
    enabled: !!sid,
  });

  const recoverMut = useMutation({
    mutationFn: () => recoverScenario(sid),
    onSuccess: (res) => {
      setRecoveredPlan(res.recovered_plan);
      setScenarioId(sid);
      qc.invalidateQueries({ queryKey: ['scenarios'] });
      qc.invalidateQueries({ queryKey: ['compare', sid] });
      qc.invalidateQueries({ queryKey: ['activity'] });
      qc.invalidateQueries({ queryKey: ['analytics'] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteScenario(sid),
    onSuccess: () => {
      setSid('');
      setScenarioId(null);
      setRecoveredPlan(null);
      qc.invalidateQueries({ queryKey: ['scenarios'] });
      qc.invalidateQueries({ queryKey: ['activity'] });
      qc.invalidateQueries({ queryKey: ['analytics'] });
    },
  });

  const renameMut = useMutation({
    mutationFn: (name: string) => renameScenario(sid, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scenarios'] });
      qc.invalidateQueries({ queryKey: ['activity'] });
    },
  });

  const onRename = () => {
    if (!sid) return;
    const current = scenarios.find((s) => s.id === sid)?.name ?? '';
    const next = window.prompt('Rename scenario', current);
    if (next?.trim()) renameMut.mutate(next.trim());
  };

  const onDelete = () => {
    if (!sid) return;
    const confirmed = window.confirm(
      'Delete this scenario and its disrupted/recovered plans? The baseline plan is kept.',
    );
    if (confirmed) deleteMut.mutate();
  };

  const active = scenarios.find((s) => s.id === sid) as ScenarioSummary | undefined;
  const cmp = compareQuery.data;
  const baselineK: KPISnapshot | null | undefined = cmp?.baseline?.kpis;
  const disruptedK: KPISnapshot | null | undefined = cmp?.disrupted?.kpis;
  const recoveredK: KPISnapshot | null | undefined = cmp?.recovered?.kpis;

  const actions: RecoveryAction[] = React.useMemo(() => {
    if (recoverMut.data?.recovery_actions?.length) return recoverMut.data.recovery_actions;
    const persisted = scenarioQuery.data?.recovered_plan as unknown as
      | { data?: { diagnostics?: { recovery_actions?: RecoveryAction[] } } }
      | null
      | undefined;
    return persisted?.data?.diagnostics?.recovery_actions ?? [];
  }, [recoverMut.data, scenarioQuery.data]);

  const residual: UnmetDemand[] = React.useMemo(() => {
    if (recoverMut.data) return recoverMut.data.residual_unmet;
    const persisted = scenarioQuery.data?.recovered_plan as unknown as
      | { data?: { unmet?: UnmetDemand[] } }
      | null
      | undefined;
    return persisted?.data?.unmet ?? [];
  }, [recoverMut.data, scenarioQuery.data]);

  const residualDiagnosis = React.useMemo(() => {
    const diagnoses =
      recoverMut.data?.residual_diagnosis ??
      (scenarioQuery.data?.recovered_plan as unknown as
        | { data?: { unmet_diagnosis?: UnmetDiagnosis[] } }
        | null
        | undefined)?.data?.unmet_diagnosis ??
      [];
    const map = new Map<string, UnmetDiagnosis>();
    for (const diagnosis of diagnoses) {
      map.set(`${diagnosis.destination_id}|${diagnosis.product_id}`, diagnosis);
    }
    return map;
  }, [recoverMut.data, scenarioQuery.data]);

  const costOfRecovery =
    recoveredK && disruptedK ? recoveredK.total_cost - disruptedK.total_cost : null;
  const residualUnits = residual.reduce((sum, row) => sum + row.quantity, 0);

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Step 04 · Recover"
        title="Recovery Center"
        description="Re-plan the disrupted network using contingency lanes and priority ordering, then inspect what is still short."
        actions={
          recoveredK ? (
            <Button asChild variant="outline" size="sm">
              <Link to="/compare">
                Compare plans <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          ) : null
        }
      />

      <Card className="overflow-hidden">
        <div aria-hidden className="h-1 w-full bg-gradient-to-r from-sky-500 via-teal-500 to-emerald-500" />
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-emerald-600/15 bg-emerald-50 text-emerald-600">
              <HeartPulse className="h-3.5 w-3.5" />
            </span>
            Run recovery
          </CardTitle>
          <CardDescription>Select a disrupted scenario. Recovery activates contingency lanes at premium cost.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="md:col-span-2">
              <label htmlFor="recovery-scenario" className="mb-1.5 block text-[11px] font-medium text-slate-600">
                Scenario
              </label>
              <Select id="recovery-scenario" value={sid} onChange={(e) => setSid(e.target.value)}>
                <option value="">Select a scenario…</option>
                {scenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {scenarioTitle(s)} · {disruptionLabel(s.disruption)} · {s.status} ·{' '}
                    {s.created_at.slice(0, 16).replace('T', ' ')}
                  </option>
                ))}
              </Select>
              {!scenarios.length ? (
                <div className="mt-1.5 text-[11px] text-amber-600">
                  No scenarios yet —{' '}
                  <Link className="underline" to="/disruption">
                    create one in the Disruption Lab
                  </Link>
                  .
                </div>
              ) : null}
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={() => recoverMut.mutate()} disabled={!sid || recoverMut.isPending} className="flex-1">
                {recoverMut.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
                {recoverMut.isPending ? 'Re-planning…' : recoveredK ? 'Re-run recovery' : 'Run recovery'}
              </Button>
              <Button
                variant="outline"
                onClick={onRename}
                disabled={!sid || renameMut.isPending}
                aria-label="Rename scenario"
                title="Rename this scenario"
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                onClick={onDelete}
                disabled={!sid || deleteMut.isPending}
                aria-label="Delete scenario"
                title="Delete this scenario and its plans (baseline kept)"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {active ? (
            <div className="rounded-xl border border-slate-900/[0.07] bg-slate-50/60 p-3 text-[11.5px]">
              <div className="font-medium text-slate-800">
                Scenario {scenarioTitle(active)} — {disruptionLabel(active.disruption)}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <Badge variant="secondary">Baseline {active.baseline_plan_id.slice(0, 8)}</Badge>
                {active.disrupted_plan_id ? (
                  <Badge variant="destructive">Disrupted {active.disrupted_plan_id.slice(0, 8)}</Badge>
                ) : null}
                {active.recovered_plan_id ? (
                  <Badge variant="success">Recovered {active.recovered_plan_id.slice(0, 8)}</Badge>
                ) : null}
              </div>
            </div>
          ) : null}

          {compareQuery.isError ? (
            <div className="rounded-xl border border-red-600/15 bg-red-50 p-3 text-[12.5px] text-red-700">
              {String((compareQuery.error as Error).message)}
            </div>
          ) : null}
          {recoverMut.isError ? (
            <div className="rounded-xl border border-red-600/15 bg-red-50 p-3 text-[12.5px] text-red-700">
              {String((recoverMut.error as Error).message)}
            </div>
          ) : null}
          {deleteMut.isError ? (
            <div className="rounded-xl border border-red-600/15 bg-red-50 p-3 text-[12.5px] text-red-700">
              {String((deleteMut.error as Error).message)}
            </div>
          ) : null}
          {renameMut.isError ? (
            <div className="rounded-xl border border-red-600/15 bg-red-50 p-3 text-[12.5px] text-red-700">
              {String((renameMut.error as Error).message)}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {baselineK && disruptedK ? (
        <Card>
          <CardHeader>
            <CardTitle>Recovery journey</CardTitle>
            <CardDescription>Each phase is a stored, computed plan — not a restatement of the last one.</CardDescription>
          </CardHeader>
          <CardContent>
            <PlanJourney
              phases={[
                { key: 'baseline', label: 'Baseline', tone: 'neutral', kpis: baselineK },
                { key: 'disrupted', label: 'Disrupted', tone: 'bad', kpis: disruptedK },
                {
                  key: 'recovered',
                  label: 'Recovered',
                  tone: 'good',
                  kpis: recoveredK ?? null,
                  pending: 'Recovery has not run yet.',
                },
              ]}
            />

            <div className="mt-4 grid gap-3 border-t border-slate-900/[0.06] pt-4 sm:grid-cols-3">
              <div>
                <div className="text-eyebrow">Cost of recovery</div>
                <div
                  className={cn(
                    'mt-1 text-lg font-semibold tabular',
                    costOfRecovery === null
                      ? 'text-slate-400'
                      : costOfRecovery > 0
                        ? 'text-amber-700'
                        : 'text-emerald-700',
                  )}
                >
                  {costOfRecovery === null
                    ? '—'
                    : `${costOfRecovery >= 0 ? '+' : '−'}$${Math.abs(Math.round(costOfRecovery)).toLocaleString()}`}
                </div>
                <div className="mt-0.5 text-[10.5px] text-slate-500">
                  {recoveredK ? `total $${Math.round(recoveredK.total_cost).toLocaleString()}` : 'run recovery to price it'}
                </div>
              </div>
              <div>
                <div className="text-eyebrow">Residual shortfall</div>
                <div
                  className={cn(
                    'mt-1 text-lg font-semibold tabular',
                    residualUnits > 0 ? 'text-red-600' : 'text-slate-900',
                  )}
                >
                  {recoveredK ? Math.round(residualUnits).toLocaleString() : '—'}
                </div>
                <div className="mt-0.5 text-[10.5px] text-slate-500">
                  {recoveredK
                    ? residualUnits > 0
                      ? 'units still unserved'
                      : 'every unit covered'
                    : 'not computed yet'}
                </div>
              </div>
              <div>
                <div className="text-eyebrow">Status</div>
                <div className="mt-1.5">
                  <Badge variant={recoveredK ? (residualUnits > 0 ? 'warning' : 'success') : 'secondary'}>
                    {recoveredK ? (residualUnits > 0 ? 'partially recovered' : 'fully recovered') : 'awaiting run'}
                  </Badge>
                </div>
                <div className="mt-1 text-[10.5px] text-slate-500">
                  {recoveredK ? 'constraint-checked plan' : 'no recovery result stored'}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {actions.length ? (
        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Wrench className="h-4 w-4 text-slate-400" /> Recovery actions
              </CardTitle>
              <CardDescription>
                Each action is a computed allocation change, already checked against constraints.
              </CardDescription>
            </div>
            <Badge variant="secondary">{actions.length} actions</Badge>
          </CardHeader>
          <CardContent>
            <ol className="divide-y divide-slate-900/[0.05]">
              {actions.map((a, i) => {
                const meta = ACTION_META[a.type] ?? {
                  icon: Zap,
                  chip: 'border-slate-900/[0.07] bg-slate-50 text-slate-500',
                  label: a.type.replace(/_/g, ' '),
                };
                const Icon = meta.icon;
                return (
                  <li key={i} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                    <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border', meta.chip)}>
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant={
                            a.type === 'activate_contingency_lane'
                              ? 'warning'
                              : a.type === 'residual_unmet'
                                ? 'destructive'
                                : a.type === 'fully_recovered'
                                  ? 'success'
                                  : 'secondary'
                          }
                        >
                          {a.type.replace(/_/g, ' ')}
                        </Badge>
                        <span className="text-[10.5px] text-slate-400">{meta.label}</span>
                        <span className="ml-auto flex items-center gap-3 font-mono text-[10.5px] text-slate-500">
                          {a.quantity_delta !== undefined ? (
                            <span className="tabular">
                              {a.quantity_delta > 0 ? '+' : ''}
                              {Math.round(a.quantity_delta)} u
                            </span>
                          ) : null}
                          {a.cost_per_unit !== undefined ? (
                            <span className="tabular">${a.cost_per_unit.toFixed(2)}/u</span>
                          ) : null}
                        </span>
                      </div>
                      <p className="mt-1 text-[12px] leading-relaxed text-slate-600">{a.explanation}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {residual.length ? (
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              )}
              Residual unmet demand
            </CardTitle>
            <CardDescription>
              {recoveredK
                ? residual.length
                  ? 'Not recoverable with available inventory and lane capacity — reported rather than hidden.'
                  : 'Every requested unit is covered after recovery.'
                : 'Run recovery to compute residual gaps.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="max-h-96 overflow-auto">
            {!recoveredK ? (
              <div className="py-8 text-center text-[13px] text-slate-500">No recovery run yet.</div>
            ) : residual.length === 0 ? (
              <div className="rounded-xl border border-emerald-600/15 bg-emerald-50 p-3 text-[12.5px] text-emerald-800">
                All demand fulfilled. No constraint is binding after recovery.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Destination</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Short</TableHead>
                    <TableHead>Cause</TableHead>
                    <TableHead>Priority</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {residual.map((u, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-[11px] text-slate-700">{u.destination_id}</TableCell>
                      <TableCell className="font-mono text-[11px] text-slate-700">{u.product_id}</TableCell>
                      <TableCell className="text-right font-medium tabular text-red-600">
                        {Math.round(u.quantity).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <CauseBadge diagnosis={residualDiagnosis.get(`${u.destination_id}|${u.product_id}`)} />
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

        <Card className="overflow-hidden border-emerald-600/15">
          <div aria-hidden className="h-1 w-full bg-gradient-to-r from-emerald-500 to-teal-500" />
          <CardHeader>
            <CardTitle>Trade-off explanation</CardTitle>
            <CardDescription>Computed from the three plans — not an invented narrative.</CardDescription>
          </CardHeader>
          <CardContent>
            {cmp?.tradeoff_narrative ? (
              <blockquote className="relative rounded-xl border border-emerald-600/10 bg-emerald-50/40 p-4 text-[13px] leading-relaxed text-slate-700">
                <span aria-hidden className="absolute right-3 top-1 font-serif text-3xl leading-none text-emerald-600/20">
                  &rdquo;
                </span>
                {cmp.tradeoff_narrative}
              </blockquote>
            ) : (
              <p className="py-8 text-center text-[13px] text-slate-500">
                Select a scenario to see the computed trade-off.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
