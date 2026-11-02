import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  FileCheck,
  FileUp,
  Info,
  Layers,
  RefreshCw,
  Upload,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { PageHeader } from '../components/PageHeader';
import {
  listDatasets,
  importDataset,
  loadSampleDataset,
  getDataset,
  type Dataset,
  type ImportDatasetResponse,
  type ValidationReport,
} from '../lib/api';
import { cn } from '../lib/utils';
import { useAppStore } from '../stores/appStore';

const TABLES = ['warehouses', 'destinations', 'products', 'routes', 'inventory', 'demand'] as const;

const TEMPLATES: Record<string, string> = {
  warehouses: 'id,name,region,lat,lng\nWH-01,Central Hub,Midwest,41.88,-87.62',
  destinations: 'id,name,priority,region,deadline_days\nDST-01,Metro General Hospital,1,Northeast,5',
  products: 'id,name,unit,weight_kg\nPRD-A,Industrial Sensor,units,2.5',
  routes:
    'id,warehouse_id,destination_id,capacity,cost_per_unit,time_days,available,product_ids,backup\nRT-01,WH-01,DST-01,600,4.5,2,true,,false',
  inventory: 'warehouse_id,product_id,quantity\nWH-01,PRD-A,800',
  demand: 'destination_id,product_id,quantity\nDST-01,PRD-A,300',
};

const SAMPLE_FACTS = [
  ['04', 'warehouses'],
  ['08', 'destinations'],
  ['03', 'products'],
  ['20', 'lanes'],
] as const;

export default function Datasets() {
  const qc = useQueryClient();
  const { datasetId, setDatasetId, setPlanId } = useAppStore();
  const [files, setFiles] = React.useState<Record<string, File | null>>(() =>
    Object.fromEntries(TABLES.map((t) => [t, null])),
  );
  const [lastImport, setLastImport] = React.useState<ImportDatasetResponse | null>(null);

  const { data: listData, isFetching: listLoading } = useQuery({
    queryKey: ['datasets'],
    queryFn: listDatasets,
  });

  // Restore the planning context when a workspace already has datasets.
  React.useEffect(() => {
    if (!datasetId && listData?.datasets?.length) setDatasetId(listData.datasets[0].id);
  }, [datasetId, listData, setDatasetId]);

  const selectedDatasetQuery = useQuery({
    queryKey: ['dataset', datasetId],
    queryFn: () => getDataset(datasetId!),
    enabled: !!datasetId,
  });

  const onImported = (res: ImportDatasetResponse) => {
    setLastImport(res);
    setDatasetId(res.dataset_id);
    setPlanId(null);
    qc.invalidateQueries({ queryKey: ['datasets'] });
  };

  const uploadMut = useMutation({ mutationFn: (fd: FormData) => importDataset(fd), onSuccess: onImported });
  const sampleMut = useMutation({ mutationFn: loadSampleDataset, onSuccess: onImported });

  const busy = uploadMut.isPending || sampleMut.isPending;
  const error = uploadMut.error ?? sampleMut.error;

  const canUpload = TABLES.every((t) => files[t]);

  const doUpload = () => {
    const fd = new FormData();
    for (const t of TABLES) if (files[t]) fd.append(t, files[t]!);
    uploadMut.mutate(fd);
  };

  const validation: ValidationReport | undefined =
    lastImport?.validation_report ??
    (selectedDatasetQuery.data?.meta?.validation_report as ValidationReport | undefined);

  const preview: Record<string, Record<string, unknown>[]> | null = lastImport?.preview
    ? lastImport.preview
    : selectedDatasetQuery.data
      ? extractPreview(selectedDatasetQuery.data)
      : null;

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Step 01 · Load"
        title="Datasets"
        description="Load the bundled network or upload six CSVs. Every import is validated before planning."
        meta={
          datasetId ? (
            <Badge variant="success" className="gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Active {datasetId.slice(0, 8)}
            </Badge>
          ) : (
            <Badge variant="outline">No dataset selected</Badge>
          )
        }
      />

      <Card className="overflow-hidden">
        <div className="grid lg:grid-cols-[1.15fr_0.85fr]">
          <div className="p-5">
            <div className="text-eyebrow">Bundled · deterministic</div>
            <h3 className="mt-1.5 flex items-center gap-2 text-[15px] font-semibold tracking-tight text-slate-900">
              <Database className="h-4 w-4 text-slate-400" /> Bundled sample network
            </h3>
            <p className="mt-1.5 max-w-lg text-[12.5px] leading-relaxed text-slate-500">
              4 warehouses · 8 destinations · 3 products · 20 lanes (12 primary, 8 contingency). No external keys
              required.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Button onClick={() => sampleMut.mutate()} disabled={busy}>
                {sampleMut.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                Load sample dataset
              </Button>
              <Button variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ['datasets'] })} disabled={listLoading}>
                {listLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
                Refresh list
              </Button>
              {datasetId ? <Badge variant="secondary">Active: {datasetId.slice(0, 8)}</Badge> : null}
            </div>
          </div>

          <div className="relative overflow-hidden bg-ink-900 p-5 text-white">
            <div
              aria-hidden
              className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-emerald-400/[0.14] blur-3xl"
            />
            <div className="relative flex items-center justify-between">
              <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/35">Network shape</span>
              <span className="flex h-6 w-6 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.04] text-emerald-300/80">
                <Layers className="h-3 w-3" />
              </span>
            </div>
            <div className="relative mt-4 grid grid-cols-2 gap-4">
              {SAMPLE_FACTS.map(([value, label]) => (
                <div key={label}>
                  <div className="text-2xl font-semibold tracking-tight tabular text-white">{value}</div>
                  <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-white/35">{label}</div>
                </div>
              ))}
            </div>
            <div className="relative mt-5 border-t border-white/[0.07] pt-3 font-mono text-[9px] uppercase tracking-[0.14em] text-white/30">
              12 primary · 8 contingency lanes
            </div>
          </div>
        </div>
      </Card>

      {error ? (
        <Card className="border-red-600/15 bg-red-50">
          <CardContent className="p-4 text-[12.5px] text-red-800">{String((error as Error).message)}</CardContent>
        </Card>
      ) : null}
      {lastImport && !error ? (
        <Card className="border-emerald-600/15 bg-emerald-50">
          <CardContent className="flex items-center gap-2 p-4 text-[12.5px] text-emerald-800">
            <CheckCircle2 className="h-4 w-4" /> Dataset imported — {lastImport.dataset_id.slice(0, 8)} · proceed to the
            Planner.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid items-start gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <Card className="min-w-0">
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-900/[0.07] bg-slate-50 text-slate-500">
                  <Upload className="h-3.5 w-3.5" />
                </span>
                Upload your own CSVs
              </CardTitle>
              <CardDescription>Six files required. Columns must match the templates exactly.</CardDescription>
            </div>
            <Badge variant={canUpload ? 'success' : 'secondary'}>
              {TABLES.filter((t) => files[t]).length} / 6
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {TABLES.map((t) => (
                <div
                  key={t}
                  className={cn(
                    'rounded-xl border p-3 transition-colors',
                    files[t] ? 'border-emerald-600/25 bg-emerald-50/30' : 'border-slate-900/[0.07] bg-slate-50/40',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">{t}</span>
                    {files[t] ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <span className="font-mono text-[8.5px] uppercase tracking-[0.1em] text-slate-400">required</span>
                    )}
                  </div>

                  <label
                    className={cn(
                      'mt-2 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed px-2.5 py-2 text-[10.5px] transition-colors',
                      files[t]
                        ? 'border-emerald-600/25 bg-white text-slate-700'
                        : 'border-slate-300 bg-white text-slate-500 hover:border-emerald-500/50 hover:text-slate-800',
                    )}
                  >
                    <input
                      type="file"
                      accept=".csv"
                      className="sr-only"
                      onChange={(e) => setFiles((prev) => ({ ...prev, [t]: e.target.files?.[0] ?? null }))}
                    />
                    <FileUp className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{files[t]?.name ?? 'Choose CSV'}</span>
                  </label>

                  <button
                    type="button"
                    onClick={() => {
                      const blob = new Blob([TEMPLATES[t]], { type: 'text/csv' });
                      const href = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = href;
                      a.download = `${t}.template.csv`;
                      a.click();
                      URL.revokeObjectURL(href);
                    }}
                    className="mt-2 inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.1em] text-slate-400 transition-colors hover:text-slate-800"
                  >
                    <Download className="h-2.5 w-2.5" /> Download template
                  </button>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-slate-900/[0.06] pt-4">
              <Button onClick={doUpload} disabled={!canUpload || busy}>
                {uploadMut.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Validate &amp; import
              </Button>
              <span className="text-[11px] text-slate-500">
                {canUpload ? 'All six files selected.' : `${TABLES.filter((t) => !files[t]).length} file(s) still required.`}
              </span>
            </div>
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-4">
          {validation ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {validation.valid ? (
                    <FileCheck className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                  )}
                  Validation report
                  <Badge variant={validation.valid ? 'success' : 'warning'}>
                    {validation.valid ? 'Valid' : 'Has issues'}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  {validation.issues.length} issue(s) detected. Invalid rows are reported, never silently dropped.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {validation.issues.length === 0 ? (
                  <div className="rounded-xl border border-emerald-600/15 bg-emerald-50 p-3 text-[12.5px] leading-relaxed text-emerald-800">
                    No issues — schema, types, references and duplicates all check out.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Severity</TableHead>
                        <TableHead>Field</TableHead>
                        <TableHead>Row</TableHead>
                        <TableHead>Message</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {validation.issues.map((iss, i) => (
                        <TableRow key={i}>
                          <TableCell>
                            <Badge
                              variant={
                                iss.severity === 'error'
                                  ? 'destructive'
                                  : iss.severity === 'warning'
                                    ? 'warning'
                                    : 'secondary'
                              }
                            >
                              {iss.severity}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-[10.5px]">{iss.field ?? '—'}</TableCell>
                          <TableCell className="tabular">{iss.row ?? '—'}</TableCell>
                          <TableCell className="max-w-md text-[11.5px]">{iss.message}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card className="border-dashed border-slate-300/80 bg-white/70">
              <CardContent className="flex items-start gap-2 p-5 text-[12.5px] leading-relaxed text-slate-500">
                <Info className="mt-0.5 h-4 w-4 shrink-0" /> Import or select a dataset to see its validation report.
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Import checklist</CardTitle>
              <CardDescription>What the validator enforces before a plan can be solved.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2.5">
                {[
                  ['Six CSVs, exact names', 'warehouses, destinations, products, routes, inventory, demand.'],
                  ['Referential integrity', 'Ids in routes, inventory and demand must resolve.'],
                  ['Types and duplicates', 'Numeric fields parse; duplicate keys are reported.'],
                  ['Contingency lanes', 'backup=true lanes stay dormant until recovery.'],
                ].map(([title, body]) => (
                  <li key={title} className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    <div>
                      <div className="text-[11.5px] font-medium text-slate-700">{title}</div>
                      <div className="mt-0.5 text-[10.5px] leading-relaxed text-slate-500">{body}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>Datasets in this workspace</CardTitle>
            <CardDescription>Select one to make it the active planning context.</CardDescription>
          </div>
          <Badge variant="secondary">{listData?.datasets?.length ?? 0} datasets</Badge>
        </CardHeader>
        <CardContent>
          {!listData?.datasets?.length ? (
            <div className="py-6 text-center text-[13px] text-slate-500">
              No datasets yet — load the sample to begin.
            </div>
          ) : (
            <div className="max-h-[26rem] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="text-right">Warehouses</TableHead>
                    <TableHead className="text-right">Lanes</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listData.datasets.map((ds) => (
                    <TableRow key={ds.id} className={ds.id === datasetId ? 'bg-emerald-50/30' : undefined}>
                      <TableCell>
                        <div className="text-[12px] font-medium text-slate-800">{ds.name}</div>
                        <div className="font-mono text-[9.5px] text-slate-400">{ds.id.slice(0, 12)}…</div>
                      </TableCell>
                      <TableCell className="text-right tabular text-slate-600">
                        {ds.counts?.warehouses ?? 0}
                      </TableCell>
                      <TableCell className="text-right tabular text-slate-600">
                        {ds.counts?.routes ?? 0}
                      </TableCell>
                      <TableCell className="text-[10.5px] text-slate-500">
                        {ds.created_at ? new Date(ds.created_at).toLocaleDateString() : '—'}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant={ds.id === datasetId ? 'default' : 'outline'}
                          onClick={() => {
                            setDatasetId(ds.id);
                            setPlanId(null);
                            setLastImport(null);
                          }}
                        >
                          {ds.id === datasetId ? 'Active' : 'Use'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {preview ? (
        <Card>
          <CardHeader>
            <CardTitle>Data preview</CardTitle>
            <CardDescription>First five rows of each table in the active dataset.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {TABLES.map((t) => {
              const rows = preview[t] ?? [];
              if (!rows.length) return null;
              const cols = Object.keys(rows[0] ?? {});
              return (
                <div key={t}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-slate-500">{t}</span>
                    <span className="text-[10.5px] text-slate-400">· {rows.length} shown</span>
                  </div>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {cols.map((c) => (
                            <TableHead key={c}>{c}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.slice(0, 5).map((r, i) => (
                          <TableRow key={i}>
                            {cols.map((c) => (
                              <TableCell key={c} className="whitespace-nowrap font-mono text-[10.5px] text-slate-600">
                                {String(r[c] ?? '—')}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function extractPreview(ds: Dataset): Record<string, Record<string, unknown>[]> {
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const t of TABLES) {
    const arr = (ds.meta as Record<string, unknown>)[t];
    out[t] = Array.isArray(arr) ? (arr as Record<string, unknown>[]).slice(0, 5) : [];
  }
  return out;
}
