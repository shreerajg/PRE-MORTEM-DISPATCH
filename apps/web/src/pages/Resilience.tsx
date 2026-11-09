import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Gauge,
  GitBranch,
  Package,
  Route as RouteIcon,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { Select } from '../components/ui/select';
import { Stat } from '../components/Stat';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { getPlanResilience, listPlans, type ResilienceVulnerability } from '../lib/api';
import { cn } from '../lib/utils';
import { useAppStore } from '../stores/appStore';

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const units = (value: number) => Math.round(value).toLocaleString();

const SEVERITY_TONE: Record<string, 'destructive' | 'warning' | 'secondary'> = {
  critical: 'destructive',
  high: 'destructive',
  medium: 'warning',
  low: 'secondary',
};

const KIND_LABEL: Record<string, string> = {
  no_primary_lane: 'No ordinary lane',
  single_source: 'Single source',
  no_contingency: 'No contingency',
  lane_bottleneck: 'Lane bottleneck',
  inventory_concentration: 'Inventory concentration',
  deadline_exposure: 'Deadline exposure',
  deadline_margin: 'Deadline margin',
};

function vulnerabilityLabel(vulnerability: ResilienceVulnerability) {
  return KIND_LABEL[vulnerability.kind] ?? vulnerability.kind.replace(/_/g, ' ');
}

function gradeTone(score: number) {
  if (score >= 80) return 'success' as const;
  if (score >= 65) return 'outline' as const;
  if (score >= 45) return 'warning' as const;
  return 'destructive' as const;
}

export default function Resilience() {
  const { planId, setPlanId } = useAppStore();
  const [requestedPlanId, setRequestedPlanId] = React.useState('');

  const { data: plansData } = useQuery({ queryKey: ['plans', 50], queryFn: () => listPlans(50) });
  const baselines = React.useMemo(
    () => (plansData?.plans ?? []).filter((plan) => plan.type === 'baseline'),
    [plansData],
  );

  React.useEffect(() => {
    if (!planId && baselines.length) setPlanId(baselines[0].id);
  }, [baselines, planId, setPlanId]);

  const activePlanId = planId && baselines.some((plan) => plan.id === planId)
    ? planId
    : baselines[0]?.id ?? '';

  React.useEffect(() => {
    setRequestedPlanId(activePlanId);
  }, [activePlanId]);

  const activePlan = baselines.find((plan) => plan.id === activePlanId) ?? null;
  const { data: resilience, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['plan-resilience', requestedPlanId],
    queryFn: () => getPlanResilience(requestedPlanId),
    enabled: !!requestedPlanId,
    staleTime: 30_000,
    retry: false,
  });

  const score = resilience?.score ?? null;

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Pre-mortem · readiness"
        title="Network Resilience"
        description="Find the dependencies that will turn one failure into a service outage before simulating it."
        actions={
          resilience ? (
            <>
              <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
                <Activity className={cn('h-4 w-4', isFetching && 'animate-spin')} />
                Re-assess
              </Button>
              <Button size="sm" asChild>
                <Link to="/disruption">
                  Stress-test it <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </>
          ) : null
        }
        meta={
          activePlan ? (
            <Badge variant="outline">
              Plan {activePlan.id.slice(0, 8)} · {activePlan.solver}
              {activePlan.solver_status ? ` · ${activePlan.solver_status}` : ''}
            </Badge>
          ) : null
        }
      />

      {!baselines.length ? (
        <EmptyState
          icon={ShieldCheck}
          title="No baseline to assess"
          description="Load a network and generate a baseline. Resilience is calculated from the real lanes, stock and delivery promises."
          actions={
            <>
              <Button asChild>
                <Link to="/datasets">Load a dataset</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/planner">Open the Planner</Link>
              </Button>
            </>
          }
        />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-slate-400" /> Select a baseline
              </CardTitle>
              <CardDescription>
                The assessment is ephemeral and uses the stored planning policy of the selected baseline.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <div>
                <label htmlFor="resilience-plan" className="mb-1.5 block text-[11px] font-medium text-slate-600">
                  Baseline plan
                </label>
                <Select
                  id="resilience-plan"
                  value={requestedPlanId}
                  onChange={(event) => {
                    setRequestedPlanId(event.target.value);
                    setPlanId(event.target.value);
                  }}
                >
                  {baselines.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.id.slice(0, 8)} · {plan.created_at.slice(0, 16).replace('T', ' ')} ·{' '}
                      {pct(plan.kpis?.fulfillment_rate ?? 0)} fulfilled
                    </option>
                  ))}
                </Select>
              </div>
              {resilience ? (
                <div className="text-[11px] leading-relaxed text-slate-500">
                  <span className="font-medium text-slate-700">{resilience.metrics.eligible_primary_routes}</span>{' '}
                  ordinary lanes ·{' '}
                  <span className="font-medium text-slate-700">{resilience.metrics.contingency_routes}</span> backup
                  lanes ·{' '}
                  {resilience.constraints?.respect_deadlines ? 'deadline-enforced' : 'deadlines reported as KPI'}
                </div>
              ) : null}
            </CardContent>
          </Card>

          {error ? (
            <Card className="border-red-600/15">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-red-700">
                  <AlertCircle className="h-4 w-4" /> Resilience could not be computed
                </CardTitle>
              </CardHeader>
              <CardContent className="text-[12.5px] leading-relaxed text-red-700">
                {String((error as Error).message)}
              </CardContent>
            </Card>
          ) : null}

          {isLoading && !resilience ? (
            <Card aria-busy="true">
              <CardContent className="py-14 text-center text-[13px] text-slate-500">
                Mapping lane, inventory and deadline dependencies…
              </CardContent>
            </Card>
          ) : null}

          {resilience ? (
            <>
              <Card className="overflow-hidden">
                <div
                  aria-hidden
                  className="h-1 w-full bg-gradient-to-r from-emerald-500 via-teal-500 to-sky-500"
                />
                <CardHeader className="flex-row items-start justify-between space-y-0">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Gauge className="h-4 w-4 text-slate-400" /> Readiness score
                    </CardTitle>
                    <CardDescription>{resilience.definition}</CardDescription>
                  </div>
                  <Badge variant={gradeTone(resilience.score)}>{resilience.grade}</Badge>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-end">
                    <div>
                      <div className="text-[3rem] font-semibold leading-none tracking-[-0.04em] tabular text-slate-900">
                        {resilience.score.toFixed(1)}
                        <span className="text-lg font-normal text-slate-400">/100</span>
                      </div>
                      <div className="mt-2 h-2 w-56 overflow-hidden rounded-full bg-slate-900/[0.06]">
                        <div
                          className={cn(
                            'h-full rounded-full transition-[width] duration-700',
                            resilience.score >= 80
                              ? 'bg-emerald-500'
                              : resilience.score >= 65
                                ? 'bg-sky-500'
                                : resilience.score >= 45
                                  ? 'bg-amber-500'
                                  : 'bg-red-500',
                          )}
                          style={{ width: `${resilience.score}%` }}
                        />
                      </div>
                    </div>
                    <p className="max-w-xl text-[12.5px] leading-relaxed text-slate-500">
                      This is not a disruption result. It measures how much redundancy the plan has before a lane,
                      warehouse or transit failure is simulated.
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                    {resilience.score_components.map((component) => (
                      <div
                        key={component.key}
                        className="rounded-xl border border-slate-900/[0.07] bg-slate-50/55 p-3.5"
                      >
                        <div className="text-eyebrow">{component.label}</div>
                        <div className="mt-1.5 text-lg font-semibold tabular text-slate-900">
                          {component.points.toFixed(1)}
                          <span className="ml-1 text-[11px] font-normal text-slate-400">/ {component.weight}</span>
                        </div>
                        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-slate-900/[0.06]">
                          <div
                            className="h-full origin-left rounded-full bg-slate-800"
                            style={{ width: `${component.rate * 100}%` }}
                          />
                        </div>
                        <div className="mt-1.5 text-[10.5px] text-slate-500">{pct(component.rate)} of demand</div>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-3 border-t border-slate-900/[0.06] pt-5 xl:grid-cols-4">
                    <Stat
                      label="Redundant lanes"
                      value={units(resilience.metrics.redundant_lane_units)}
                      sub="units with an ordinary alternate"
                      icon={GitBranch}
                      tone="success"
                    />
                    <Stat
                      label="Backup coverage"
                      value={units(resilience.metrics.contingency_covered_units)}
                      sub="units with a contingency lane"
                      icon={RouteIcon}
                      tone="info"
                    />
                    <Stat
                      label="Capacity headroom"
                      value={pct(resilience.metrics.capacity_headroom_rate)}
                      sub="ordinary lane spare capacity"
                      icon={Activity}
                      tone={resilience.metrics.capacity_headroom_rate < 0.25 ? 'warning' : 'neutral'}
                      bar={resilience.metrics.capacity_headroom_rate}
                    />
                    <Stat
                      label="Dependencies"
                      value={String(resilience.metrics.vulnerabilities)}
                      sub="ranked by criticality and exposure"
                      icon={Package}
                      tone={resilience.metrics.vulnerabilities > 3 ? 'warning' : 'neutral'}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex-row items-start justify-between space-y-0">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-600" /> What is likely to break first
                    </CardTitle>
                    <CardDescription>
                      Ranked by affected units and destination priority, not by page order.
                    </CardDescription>
                  </div>
                  <Badge variant="secondary">{resilience.vulnerabilities.length} shown</Badge>
                </CardHeader>
                <CardContent>
                  {!resilience.vulnerabilities.length ? (
                    <div className="rounded-xl border border-emerald-600/15 bg-emerald-50 p-4 text-[12.5px] text-emerald-800">
                      No structural dependency reached the reporting threshold. Stress-test it anyway: redundancy in
                      the data is not proof of recovery.
                    </div>
                  ) : (
                    <ol className="divide-y divide-slate-900/[0.05]">
                      {resilience.vulnerabilities.map((vulnerability, index) => (
                        <li
                          key={`${vulnerability.kind}-${vulnerability.title}-${index}`}
                          className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_150px]"
                        >
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant={SEVERITY_TONE[vulnerability.severity] ?? 'secondary'}>
                                {vulnerability.severity}
                              </Badge>
                              <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-slate-400">
                                {vulnerabilityLabel(vulnerability)}
                              </span>
                            </div>
                            <div className="mt-2 text-[13px] font-medium text-slate-900">{vulnerability.title}</div>
                            <p className="mt-1 text-[12px] leading-relaxed text-slate-600">{vulnerability.detail}</p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {vulnerability.route_ids.slice(0, 5).map((route) => (
                                <span
                                  key={route}
                                  className="rounded-md border border-slate-900/[0.07] bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-600"
                                >
                                  {route}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div className="sm:text-right">
                            <div className="text-[9.5px] uppercase tracking-[0.14em] text-slate-400">Exposure</div>
                            <div className="mt-1 text-lg font-semibold tabular text-slate-900">
                              {units(vulnerability.affected_units)}
                            </div>
                            <div className="text-[10.5px] text-slate-500">priority P{vulnerability.priority}</div>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Manufacturing actions this assessment supports</CardTitle>
                  <CardDescription>
                    Strategic recommendations identify where to spend on redundancy; the Disruption Lab tests how
                    much damage a chosen action prevents.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2">
                  {resilience.recommendations.map((recommendation) => (
                    <div
                      key={`${recommendation.kind}-${recommendation.title}`}
                      className="rounded-xl border border-slate-900/[0.07] bg-slate-50/55 p-4"
                    >
                      <div className="text-[13px] font-semibold text-slate-900">{recommendation.title}</div>
                      <p className="mt-1.5 text-[12px] leading-relaxed text-slate-600">{recommendation.detail}</p>
                      {recommendation.affected_units !== null ? (
                        <div className="mt-2 font-mono text-[10.5px] text-slate-500">
                          {units(recommendation.affected_units)} units exposed
                        </div>
                      ) : null}
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Consumer service lens</CardTitle>
                  <CardDescription>
                    Create a disruption to convert these structural exposures into units that would be unavailable or
                    late at each destination.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Next step</TableHead>
                        <TableHead>Why it matters</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-medium text-slate-800">Close a high-dependency lane</TableCell>
                        <TableCell className="text-[12px] text-slate-600">
                          Converts single-source exposure into an observable service gap.
                        </TableCell>
                        <TableCell className="text-right">
                          <Button asChild size="sm" variant="outline">
                            <Link to="/disruption">Open Disruption Lab</Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-medium text-slate-800">Review recovery options</TableCell>
                        <TableCell className="text-[12px] text-slate-600">
                          Compare backup activation against the damage the disruption would cause.
                        </TableCell>
                        <TableCell className="text-right">
                          <Button asChild size="sm" variant="outline">
                            <Link to="/recovery">Open Recovery</Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <p className="text-[11px] leading-relaxed text-slate-500">{resilience.note}</p>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
