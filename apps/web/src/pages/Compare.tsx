import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { ArrowRight, Clock, GitCompare, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Select } from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Button } from '../components/ui/button';
import { PageHeader } from '../components/PageHeader';
import { PlanJourney } from '../components/PlanJourney';
import { ChartTooltip } from '../components/ChartTooltip';
import { compareScenario, listScenarios } from '../lib/api';
import { cn, disruptionLabel, scenarioTitle, solverStatusTone } from '../lib/utils';
import { useAppStore } from '../stores/appStore';

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const pct0 = (v: number) => `${(v * 100).toFixed(0)}%`;
const int = (v: number) => Math.round(v).toLocaleString();
const money = (v: number) => `$${Math.round(v).toLocaleString()}`;
const dec = (v: number) => v.toFixed(1);

/** Only these metrics have server-computed deltas. Everything else shows —. */
type DeltaKey = 'fulfillment_delta' | 'cost_delta' | 'unmet_delta';

type MetricRow = {
  metric: string;
  key: string;
  fmt: (v: number) => string;
  delta?: DeltaKey;
  goodWhenUp: boolean;
};

const METRICS: MetricRow[] = [
  { metric: 'Fulfillment rate', key: 'fulfillment_rate', fmt: pct, delta: 'fulfillment_delta', goodWhenUp: true },
  { metric: 'Unmet units', key: 'unmet', fmt: int, delta: 'unmet_delta', goodWhenUp: false },
  { metric: 'Total cost', key: 'total_cost', fmt: money, delta: 'cost_delta', goodWhenUp: false },
  { metric: 'Fulfilled units', key: 'fulfilled', fmt: int, goodWhenUp: true },
  { metric: 'Total inventory', key: 'total_inventory', fmt: int, goodWhenUp: true },
  { metric: 'Total demand', key: 'total_demand', fmt: int, goodWhenUp: true },
  { metric: 'Warehouse utilization', key: 'wh_utilization', fmt: pct0, goodWhenUp: false },
  { metric: 'Route utilization', key: 'route_utilization', fmt: pct0, goodWhenUp: false },
  { metric: 'Risk score', key: 'risk_score', fmt: dec, goodWhenUp: false },
];

const PHASE_COLORS = ['#94a3b8', '#ef4444', '#10b981'];

export default function Compare() {
  const { scenarioId, setScenarioId } = useAppStore();
  const [sid, setSid] = React.useState(scenarioId ?? '');

  const { data: scenarioList } = useQuery({ queryKey: ['scenarios'], queryFn: () => listScenarios(50) });
  const scenarios = scenarioList?.scenarios ?? [];

  React.useEffect(() => {
    if (scenarioId) setSid(scenarioId);
  }, [scenarioId]);
  React.useEffect(() => {
    if (!sid && scenarios.length) setSid(scenarios[0].id);
  }, [scenarios, sid]);

  const cmpQuery = useQuery({
    queryKey: ['compare', sid],
    queryFn: () => compareScenario(sid),
    enabled: !!sid,
  });

  const cmp = cmpQuery.data;
  const b = cmp?.baseline?.kpis ?? null;
  const d = cmp?.disrupted?.kpis ?? null;
  const r = cmp?.recovered?.kpis ?? null;

  const valueOf = (kpi: typeof b, key: string): number | null => {
    if (!kpi) return null;
    const raw = (kpi as unknown as Record<string, number>)[key];
    return typeof raw === 'number' ? raw : null;
  };

  const risk = cmp?.delivery_risk;

  // Small multiples: each metric keeps its own scale so nothing is dwarfed
  const chart = (title: string, key: string, suffix: string, tickFormat?: (value: number) => string) => {
    const data = [
      { name: 'Baseline', value: valueOf(b, key) ?? 0 },
      { name: 'Disrupted', value: valueOf(d, key) ?? 0 },
      { name: 'Recovered', value: valueOf(r, key) ?? 0 },
    ];
    return (
      <div className="rounded-xl border border-slate-900/[0.06] bg-slate-50/40 p-3">
        <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.16em] text-slate-400">{title}</div>
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -12 }} barCategoryGap={22}>
              <CartesianGrid vertical={false} stroke="#e9ecf0" strokeDasharray="3 6" />
              <XAxis
                dataKey="name"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                dy={5}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 9.5, fill: '#94a3b8' }}
                tickFormatter={tickFormat}
                width={44}
              />
              <Tooltip
                cursor={{ fill: 'rgba(15,23,42,0.03)' }}
                content={<ChartTooltip valueFormatter={(v) => `${Math.round(v * 100) / 100}${suffix}`} />}
              />
              <Bar dataKey="value" name={title} radius={[5, 5, 2, 2]} maxBarSize={38}>
                {data.map((entry, index) => (
                  <Cell key={entry.name} fill={PHASE_COLORS[index]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Step 05 · Compare"
        title="Compare"
        description="Absolute KPIs, computed deltas and the trade-off between plan, disruption and recovery."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/exports">
              Export this scenario <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        }
        meta={
          cmp ? (
            <>
              <Badge variant={solverStatusTone(cmp.baseline?.solver_status, cmp.baseline?.kpis?.unmet)}>
                Baseline {String(cmp.baseline?.plan_id ?? '—').slice(0, 8)}
                {cmp.baseline?.solver_status ? ` · ${cmp.baseline.solver_status}` : ''}
              </Badge>
              {cmp.disrupted ? (
                <Badge variant="destructive">
                  Disrupted {String(cmp.disrupted.plan_id).slice(0, 8)}
                  {cmp.disrupted.solver_status ? ` · ${cmp.disrupted.solver_status}` : ''}
                </Badge>
              ) : null}
              {cmp.recovered ? (
                <Badge variant={solverStatusTone(cmp.recovered.solver_status, cmp.recovered.kpis?.unmet)}>
                  Recovered {String(cmp.recovered.plan_id).slice(0, 8)}
                  {cmp.recovered.solver_status ? ` · ${cmp.recovered.solver_status}` : ''}
                </Badge>
              ) : (
                <Badge variant="outline">No recovery yet</Badge>
              )}
            </>
          ) : null
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitCompare className="h-4 w-4 text-slate-400" /> Choose scenario
          </CardTitle>
          <CardDescription>
            Comparison always includes baseline and disrupted; recovered appears once recovery has run.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <label htmlFor="compare-scenario" className="mb-1.5 block text-[11px] font-medium text-slate-600">
            Scenario
          </label>
          <Select
            id="compare-scenario"
            value={sid}
            onChange={(e) => {
              setSid(e.target.value);
              setScenarioId(e.target.value);
            }}
            className="max-w-xl"
          >
            <option value="">Select a scenario…</option>
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {scenarioTitle(s)} · {disruptionLabel(s.disruption)} · {s.status}
              </option>
            ))}
          </Select>
          {!scenarios.length ? (
            <p className="mt-2 text-[11px] text-amber-600">
              No scenarios yet —{' '}
              <Link className="underline" to="/disruption">
                create one in the Disruption Lab
              </Link>
              .
            </p>
          ) : null}
        </CardContent>
      </Card>

      {cmpQuery.isError ? (
        <Card className="border-red-600/15 bg-red-50">
          <CardContent className="p-4 text-[12.5px] text-red-700">{String((cmpQuery.error as Error).message)}</CardContent>
        </Card>
      ) : null}

      {!cmp ? (
        <Card className="border-dashed border-slate-300/80 bg-white/70">
          <CardContent className="p-10 text-center text-[13px] text-slate-500">
            Select a scenario to compare baseline, disrupted and recovered plans.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Plan journey</CardTitle>
              <CardDescription>Fulfillment and cost move together; the trade-off is the difference.</CardDescription>
            </CardHeader>
            <CardContent>
              <PlanJourney
                phases={[
                  { key: 'baseline', label: 'Baseline', tone: 'neutral', kpis: b },
                  { key: 'disrupted', label: 'Disrupted', tone: 'bad', kpis: d },
                  {
                    key: 'recovered',
                    label: 'Recovered',
                    tone: 'good',
                    kpis: r,
                    pending: 'No recovery run for this scenario.',
                  },
                ]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>KPI comparison</CardTitle>
              <CardDescription>
                Δ columns appear only for metrics with a server-computed delta (fulfillment, unmet, cost).
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Metric</TableHead>
                    <TableHead className="text-right">Baseline</TableHead>
                    <TableHead className="text-right">Disrupted</TableHead>
                    <TableHead className="text-right text-emerald-700">Recovered</TableHead>
                    <TableHead className="text-right">Δ D−B</TableHead>
                    <TableHead className="text-right">Δ R−D</TableHead>
                    <TableHead className="text-right">Δ R−B</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {METRICS.map((m) => {
                    const bv = valueOf(b, m.key);
                    const dv = valueOf(d, m.key);
                    const rv = valueOf(r, m.key);
                    const delta = (group?: { fulfillment_delta: number; cost_delta: number; unmet_delta: number }) =>
                      m.delta && group ? group[m.delta] : null;
                    return (
                      <TableRow key={m.metric}>
                        <TableCell className="font-medium text-slate-800">{m.metric}</TableCell>
                        <TableCell className="text-right tabular text-slate-600">{bv === null ? '—' : m.fmt(bv)}</TableCell>
                        <TableCell className="text-right tabular text-slate-600">{dv === null ? '—' : m.fmt(dv)}</TableCell>
                        <TableCell className="bg-emerald-50/40 text-right font-medium tabular text-slate-900">
                          {rv === null ? '—' : m.fmt(rv)}
                        </TableCell>
                        <DeltaCell value={delta(cmp.deltas?.disrupted_vs_baseline)} kind={m.delta} goodWhenUp={m.goodWhenUp} />
                        <DeltaCell value={delta(cmp.deltas?.recovered_vs_disrupted)} kind={m.delta} goodWhenUp={m.goodWhenUp} />
                        <DeltaCell value={delta(cmp.deltas?.recovered_vs_baseline)} kind={m.delta} goodWhenUp={m.goodWhenUp} />
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {risk ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-amber-600" /> Deadline exposure across plans
                </CardTitle>
                <CardDescription>
                  Units that arrive after their destination deadline. A route delay raises this without removing
                  capacity.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Plan</TableHead>
                      <TableHead className="text-right">Units late</TableHead>
                      <TableHead className="text-right">Max lateness</TableHead>
                      <TableHead>Destinations affected</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(
                      [
                        ['Baseline', risk.baseline],
                        ['Disrupted', risk.disrupted],
                        ['Recovered', risk.recovered],
                      ] as const
                    ).map(([label, rk]) => (
                      <TableRow key={label}>
                        <TableCell className="font-medium text-slate-800">{label}</TableCell>
                        <TableCell className="text-right tabular">
                          {rk ? Math.round(rk.at_risk_units).toLocaleString() : '—'}
                        </TableCell>
                        <TableCell className="text-right tabular">{rk ? `${rk.max_late_days}d` : '—'}</TableCell>
                        <TableCell className="font-mono text-[10.5px] text-slate-500">
                          {rk && rk.at_risk_destinations.length ? rk.at_risk_destinations.join(', ') : 'none'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Visual comparison</CardTitle>
              <CardDescription>Each metric uses its own scale — mixing them on one axis hides the smaller values.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-3">
                {chart('Fulfillment (%)', 'fulfillment_rate', '%', (v) => `${Math.round(v * 100)}%`)}
                {chart('Unmet units', 'unmet', '', (v) => Math.round(v).toLocaleString())}
                {chart(
                  'Cost ($)',
                  'total_cost',
                  '',
                  (v) => (v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${Math.round(v)}`),
                )}
              </div>
              <div className="mt-3 flex items-center justify-center gap-5 text-[10.5px] text-slate-500">
                {[
                  ['Baseline', PHASE_COLORS[0]],
                  ['Disrupted', PHASE_COLORS[1]],
                  ['Recovered', PHASE_COLORS[2]],
                ].map(([label, color]) => (
                  <span key={label} className="inline-flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
                    {label}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden border-ink-800 bg-ink-900 text-white">
            <div className="relative p-5">
              <div
                aria-hidden
                className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full bg-emerald-400/[0.12] blur-3xl"
              />
              <div className="relative flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.18em] text-white/40">
                <Sparkles className="h-3.5 w-3.5 text-emerald-300/80" />
                Computed narrative
              </div>
              <h3 className="relative mt-1.5 text-[15px] font-semibold tracking-tight text-white">Trade-off</h3>
              <p className="relative mt-2 max-w-3xl text-[13px] leading-relaxed text-white/65">
                {cmp.tradeoff_narrative}
              </p>
              <div className="relative mt-3 font-mono text-[9px] uppercase tracking-[0.14em] text-white/25">
                Derived from computed KPIs and residual demand
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function DeltaCell({
  value,
  kind,
  goodWhenUp,
}: {
  value: number | null;
  kind?: DeltaKey;
  goodWhenUp: boolean;
}) {
  if (!kind || value === null || value === undefined) {
    return <TableCell className="text-right text-slate-300">—</TableCell>;
  }
  if (Math.abs(value) < 1e-9) return <TableCell className="text-right text-slate-400">0</TableCell>;

  const positive = value > 0;
  const good = goodWhenUp ? positive : !positive;
  const magnitude =
    kind === 'fulfillment_delta'
      ? `${(Math.abs(value) * 100).toFixed(1)}pp`
      : kind === 'cost_delta'
        ? `$${Math.round(Math.abs(value)).toLocaleString()}`
        : Math.round(Math.abs(value)).toLocaleString();

  return (
    <TableCell className="text-right">
      <span
        className={cn(
          'inline-flex rounded-full px-2 py-0.5 text-[10.5px] font-medium tabular',
          good ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700',
        )}
      >
        {positive ? '+' : '−'}
        {magnitude}
      </span>
    </TableCell>
  );
}
