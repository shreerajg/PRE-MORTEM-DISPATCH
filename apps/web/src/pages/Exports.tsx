import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download, Eye, FileSpreadsheet, FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { PageHeader } from '../components/PageHeader';
import { ScenarioPicker } from '../components/ScenarioPicker';
import { compareScenario, exportScenario, listScenarios } from '../lib/api';
import { useAppStore } from '../stores/appStore';

const CONTENTS = [
  ['Plan blocks', 'Baseline, disrupted and recovered in one file'],
  ['Allocations', 'Every shipment exactly as computed'],
  ['Unmet demand', 'Gaps with destination, product and priority'],
  ['KPIs', 'Fulfillment, cost, utilization and risk'],
];

export default function Exports() {
  const { scenarioId, setScenarioId } = useAppStore();
  const [sid, setSid] = React.useState(scenarioId ?? '');
  const [downloading, setDownloading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);

  const { data: scenarioList } = useQuery({ queryKey: ['scenarios', 50], queryFn: () => listScenarios(50) });
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
  const b = cmp?.baseline?.kpis;
  const d = cmp?.disrupted?.kpis;
  const r = cmp?.recovered?.kpis;

  const doExport = async () => {
    setError(null);
    setDone(null);
    setDownloading(true);
    try {
      const blob = await exportScenario(sid);
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `pre-mortem-scenario-${sid.slice(0, 8)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      setDone(
        `Downloaded pre-mortem-scenario-${sid.slice(0, 8)}.csv (${Math.max(1, Math.round(blob.size / 1024))} KB)`,
      );
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Step 06 · Export"
        title="Exports"
        description="Download the scenario exactly as computed — allocations, unmet demand and KPIs for every plan in the chain."
      />

      <Card className="overflow-hidden">
        <div aria-hidden className="h-1 w-full bg-gradient-to-r from-slate-800 via-slate-600 to-slate-400" />
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-900/[0.07] bg-slate-50 text-slate-500">
              <FileSpreadsheet className="h-3.5 w-3.5" />
            </span>
            Export scenario results
          </CardTitle>
          <CardDescription>
            CSV is generated server-side from stored plan data, so it matches the dashboard exactly.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="space-y-4">
              <div>
                <ScenarioPicker
                  id="export-scenario"
                  label="Scenario"
                  value={sid}
                  scenarios={scenarios}
                  onChange={(value) => {
                    setSid(value);
                    setScenarioId(value);
                    setDone(null);
                    setError(null);
                  }}
                  emptyHint="No scenarios yet — create one in the Disruption Lab."
                />
                {!scenarios.length ? (
                  <p className="mt-1.5 text-[11px] text-amber-600">
                    No scenarios yet —{' '}
                    <Link className="underline" to="/disruption">
                      create one first
                    </Link>
                    .
                  </p>
                ) : null}
              </div>

              <Button onClick={doExport} disabled={!sid || downloading} className="w-full sm:w-auto">
                <Download className="h-4 w-4" />
                {downloading ? 'Preparing…' : 'Download CSV'}
              </Button>

              {error ? (
                <div className="flex items-start gap-2 rounded-xl border border-red-600/15 bg-red-50 p-3 text-[12.5px] text-red-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
                </div>
              ) : null}
              {done ? (
                <div className="flex items-start gap-2 rounded-xl border border-emerald-600/15 bg-emerald-50 p-3 text-[12.5px] text-emerald-800">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {done}
                </div>
              ) : null}

              <div className="grid gap-2 border-t border-slate-900/[0.06] pt-4 sm:grid-cols-2">
                {CONTENTS.map(([title, body]) => (
                  <div key={title} className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    <div>
                      <div className="text-[11.5px] font-medium text-slate-700">{title}</div>
                      <div className="text-[10.5px] leading-relaxed text-slate-500">{body}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative overflow-hidden rounded-xl border border-ink-800 bg-ink-900 p-4 text-white">
              <div
                aria-hidden
                className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-emerald-400/[0.14] blur-2xl"
              />
              <div className="relative flex items-start justify-between">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-emerald-300/80">
                  <FileText className="h-4 w-4" />
                </span>
                <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-white/40">
                  server-rendered
                </span>
              </div>
              <div className="relative mt-4 truncate font-mono text-[11.5px] text-white/80">
                {sid ? `pre-mortem-scenario-${sid.slice(0, 8)}.csv` : 'pre-mortem-scenario-xxxxxxxx.csv'}
              </div>
              <div className="relative mt-1 font-mono text-[9px] uppercase tracking-[0.14em] text-white/30">
                text/csv · UTF-8 · attachment
              </div>
              <div className="relative mt-4 space-y-1.5 border-t border-white/[0.07] pt-3 font-mono text-[9.5px] text-white/40">
                <div className="flex items-center justify-between">
                  <span>allocations</span>
                  <span className="text-white/60">{b ? 'included' : '—'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>unmet</span>
                  <span className="text-white/60">{b ? 'included' : '—'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>kpis</span>
                  <span className="text-white/60">{b ? 'included' : '—'}</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {cmp ? (
        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-slate-400" /> Export preview
              </CardTitle>
              <CardDescription>These are the exact values written to the file.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">Baseline {String(cmp.baseline?.plan_id ?? '—').slice(0, 8)}</Badge>
              {cmp.disrupted ? (
                <Badge variant="destructive">Disrupted {String(cmp.disrupted.plan_id).slice(0, 8)}</Badge>
              ) : null}
              {cmp.recovered ? (
                <Badge variant="success">Recovered {String(cmp.recovered.plan_id).slice(0, 8)}</Badge>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Metric</TableHead>
                    <TableHead className="text-right">Baseline</TableHead>
                    <TableHead className="text-right">Disrupted</TableHead>
                    <TableHead className="text-right">Recovered</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    ['Fulfillment', (k: typeof b & object) => `${(k.fulfillment_rate * 100).toFixed(1)}%`],
                    ['Fulfilled units', (k: typeof b & object) => Math.round(k.fulfilled).toLocaleString()],
                    ['Unmet units', (k: typeof b & object) => Math.round(k.unmet).toLocaleString()],
                    ['Total cost', (k: typeof b & object) => `$${Math.round(k.total_cost).toLocaleString()}`],
                    ['WH utilization', (k: typeof b & object) => `${(k.wh_utilization * 100).toFixed(0)}%`],
                    ['Route utilization', (k: typeof b & object) => `${(k.route_utilization * 100).toFixed(0)}%`],
                    ['Risk score', (k: typeof b & object) => k.risk_score.toFixed(1)],
                  ].map(([label, fmt]) => (
                    <TableRow key={String(label)}>
                      <TableCell className="font-medium text-slate-800">{String(label)}</TableCell>
                      <TableCell className="text-right tabular text-slate-600">
                        {b ? (fmt as (k: typeof b & object) => string)(b) : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular text-red-600">
                        {d ? (fmt as (k: typeof b & object) => string)(d) : '—'}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular text-emerald-700">
                        {r ? (fmt as (k: typeof b & object) => string)(r) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div>
              <div className="text-eyebrow">Trade-off</div>
              <p className="mt-1.5 rounded-xl border border-slate-900/[0.06] bg-slate-50/60 p-3 text-[12.5px] leading-relaxed text-slate-700">
                {cmp.tradeoff_narrative}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
