const BASE: string = ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_URL as string | undefined) ?? '';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type HealthResponse = {
  status: string;
  version: string;
  solver: string;
  solver_available?: boolean;
  db: string;
  db_error?: string;
};

export type ValidationIssue = {
  row?: number | null;
  field?: string | null;
  message: string;
  severity: string;
};

export type ValidationReport = {
  valid: boolean;
  issues: ValidationIssue[];
  summary: Record<string, unknown>;
};

export type DatasetPreview = Record<string, Record<string, unknown>[]>;

export type ImportDatasetResponse = {
  dataset_id: string;
  validation_report: ValidationReport;
  preview: DatasetPreview;
};

export type Dataset = {
  id: string;
  name: string;
  created_at: string;
  meta: {
    warehouses: Record<string, unknown>[];
    destinations: Record<string, unknown>[];
    products: Record<string, unknown>[];
    routes: Record<string, unknown>[];
    inventory: Record<string, unknown>[];
    demand: Record<string, unknown>[];
    validation_report?: ValidationReport;
    [k: string]: unknown;
  };
};

export type ListDatasetsResponse = {
  datasets: Dataset[];
};

export type KPISnapshot = {
  total_inventory: number;
  total_demand: number;
  fulfilled: number;
  fulfillment_rate: number;
  unmet: number;
  total_cost: number;
  wh_utilization: number;
  route_utilization: number;
  at_risk_destinations: number;
  risk_score: number;
  risk_breakdown: Record<string, unknown>;
};

export type AllocationItem = {
  warehouse_id: string;
  destination_id: string;
  product_id: string;
  route_id: string;
  quantity: number;
};

export type UnmetDemand = {
  destination_id: string;
  product_id: string;
  quantity: number;
  priority: number;
};

export type UnmetDiagnosis = {
  destination_id: string;
  product_id: string;
  quantity: number;
  priority: number;
  cause: string;
  summary: string;
  explanation: string;
  evidence: Record<string, unknown>;
};

export type SweepPoint = {
  value: number;
  fulfillment_rate: number;
  unmet: number;
  total_cost: number;
  risk_score: number;
  at_risk_units: number;
  max_late_days: number;
  cause_counts: Record<string, number>;
  unmet_rows: number;
};

export type SweepResponse = {
  baseline_plan_id: string;
  parameter: string;
  disruption: DisruptionRequest;
  respect_deadlines: boolean;
  solver: string;
  baseline: { fulfillment_rate: number; unmet: number; total_cost: number };
  points: SweepPoint[];
  worst: SweepPoint | null;
  note: string;
};

export type PlanResponse = {
  id: string;
  dataset_id: string;
  type: string;
  status: string;
  solver: string;
  solver_status?: string | null;
  created_at: string;
  allocations: AllocationItem[];
  unmet: UnmetDemand[];
  kpis: KPISnapshot;
  diagnostics?: Record<string, unknown>;
  utilization?: Record<string, unknown>;
  constraints?: { respect_deadlines?: boolean };
  unmet_diagnosis?: UnmetDiagnosis[];
};

export type DisruptionRequest = {
  type: string;
  params: Record<string, unknown>;
};

/** A scenario may combine several disruptions; single events keep the bare shape. */
export type CompoundDisruption = { type: 'compound'; events: DisruptionRequest[] };
export type StoredDisruption = DisruptionRequest | CompoundDisruption;

export type ImpactSummary = {
  fulfillment_delta: number;
  cost_delta: number;
  unmet_delta: number;
  at_risk_units?: number;
  at_risk_delta?: number;
  max_late_days?: number;
  delivery_risk?: DeliveryRisk;
  disruption_description: string;
};

export type DeliveryRisk = {
  at_risk_units: number;
  at_risk_destinations: string[];
  at_risk_shipments: {
    destination_id: string;
    route_id: string;
    quantity: number;
    transit_days: number;
    deadline_days: number;
    late_by_days: number;
  }[];
  max_late_days: number;
  definition: string;
};

export type RecoveryAction = {
  type: string;
  explanation: string;
  warehouse_id?: string;
  destination_id?: string;
  product_id?: string;
  route_id?: string;
  quantity_delta?: number;
  activated_contingency_lane?: boolean;
  cost_per_unit?: number;
  details?: unknown;
};

export type ScenarioSummary = {
  id: string;
  name?: string | null;
  status: string;
  created_at: string;
  baseline_plan_id: string;
  disrupted_plan_id: string | null;
  recovered_plan_id: string | null;
  disruption: StoredDisruption;
  kpis: {
    baseline: KPISnapshot | null;
    disrupted: KPISnapshot | null;
    recovered: KPISnapshot | null;
  };
};

export type PlanSummary = {
  id: string;
  dataset_id: string;
  type: string;
  status: string;
  solver: string;
  solver_status?: string | null;
  created_at: string;
  kpis: KPISnapshot;
  constraints?: { respect_deadlines?: boolean };
  allocation_count: number;
  unmet_count: number;
};

export type ScenarioCreateResponse = {
  scenario: {
    id: string;
    name?: string | null;
    baseline_plan_id: string;
    disruption: StoredDisruption;
    disrupted_plan_id: string;
    status: string;
    created_at: string;
  };
  disrupted_plan: PlanResponse;
  impact: ImpactSummary;
};

export type ScenarioDetail = {
  scenario: {
    id: string;
    name?: string | null;
    baseline_plan_id: string;
    disrupted_plan_id: string | null;
    recovered_plan_id: string | null;
    disruption: StoredDisruption;
    status: string;
    created_at: string;
  };
  baseline_plan: (PlanResponse & { data?: unknown }) | null;
  disrupted_plan: (PlanResponse & { data?: unknown; id?: string }) | null;
  recovered_plan: (PlanResponse & { data?: unknown; id?: string }) | null;
};

export type RecoverResponse = {
  recovered_plan: PlanResponse;
  recovery_actions: RecoveryAction[];
  residual_unmet: UnmetDemand[];
  residual_diagnosis?: UnmetDiagnosis[];
};

export type CompareResponse = {
  baseline: { plan_id: string; kpis: KPISnapshot | null; plan: unknown; solver_status?: string | null };
  disrupted: { plan_id: string; kpis: KPISnapshot | null; plan: unknown; solver_status?: string | null } | null;
  recovered: { plan_id: string; kpis: KPISnapshot | null; plan: unknown; solver_status?: string | null } | null;
  deltas: Record<string, { fulfillment_delta: number; cost_delta: number; unmet_delta: number }>;
  delivery_risk?: {
    baseline: DeliveryRisk | null;
    disrupted: DeliveryRisk | null;
    recovered: DeliveryRisk | null;
  };
  tradeoff_narrative: string;
};

export type ForecastResponse = {
  destination_id: string;
  product_id: string;
  horizon: number;
  model: string;
  forecast: { period: number; quantity: number }[] | number[] | Record<string, unknown>[];
  history_used: Record<string, unknown>[];
  fallback?: boolean;
  reason?: string | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REQUEST_TIMEOUT_MS = 20_000;

/** API failures keep their status, machine code and server request id. */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly requestId?: string;

  constructor(message: string, opts: { status: number; code?: string; requestId?: string }) {
    const reference = opts.requestId ? ` (ref ${opts.requestId})` : '';
    super(`${message}${reference}`);
    this.name = 'ApiError';
    this.status = opts.status;
    this.code = opts.code;
    this.requestId = opts.requestId;
  }
}

async function fetchWithTimeout(
  path: string,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url(path), { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError(
        `The API did not respond within ${Math.round(timeoutMs / 1000)} seconds. Check that the server is running.`,
        { status: 0, code: 'timeout' },
      );
    }
    throw new ApiError('Cannot reach the API. Check your connection and that the server is running.', {
      status: 0,
      code: 'network_error',
    });
  } finally {
    clearTimeout(timer);
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    let code: string | undefined;
    let requestId = res.headers.get('X-Request-ID') ?? undefined;
    const text = await res.text();
    try {
      const body = JSON.parse(text) as {
        detail?: string;
        message?: string;
        code?: string;
        request_id?: string;
      };
      message = body.detail ?? body.message ?? message;
      if (typeof body.code === 'string') code = body.code;
      if (typeof body.request_id === 'string') requestId = body.request_id;
    } catch {
      if (text) message = text;
    }
    throw new ApiError(message, { status: res.status, code, requestId });
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  const res = await fetchWithTimeout(path, init, timeoutMs);
  return handle<T>(res);
}

function url(path: string) {
  return `${BASE}${path}`;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
export async function health(): Promise<HealthResponse> {
  return request<HealthResponse>('/api/v1/health');
}

export async function listDatasets(): Promise<ListDatasetsResponse> {
  return request<ListDatasetsResponse>('/api/v1/datasets/');
}

export async function importDataset(formData: FormData): Promise<ImportDatasetResponse> {
  return request<ImportDatasetResponse>('/api/v1/datasets/import', {
    method: 'POST',
    body: formData,
  });
}

export async function loadSampleDataset(): Promise<ImportDatasetResponse & { name: string }> {
  return request<ImportDatasetResponse & { name: string }>('/api/v1/datasets/sample', {
    method: 'POST',
  });
}

export async function listScenarios(limit = 25): Promise<{ scenarios: ScenarioSummary[]; total: number }> {
  return request<{ scenarios: ScenarioSummary[]; total: number }>(`/api/v1/scenarios/?limit=${limit}`);
}

export async function listPlans(limit = 25): Promise<{ plans: PlanSummary[]; total: number }> {
  return request<{ plans: PlanSummary[]; total: number }>(`/api/v1/plans/?limit=${limit}`);
}

export async function getDataset(id: string): Promise<Dataset> {
  return request<Dataset>(`/api/v1/datasets/${id}`);
}

export async function createPlan(
  datasetId: string,
  solver?: string,
  respectDeadlines = false,
): Promise<PlanResponse> {
  const body: Record<string, unknown> = {
    dataset_id: datasetId,
    respect_deadlines: respectDeadlines,
  };
  if (solver) body.solver = solver;
  return request<PlanResponse>('/api/v1/plans/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function getPlan(id: string): Promise<PlanResponse> {
  return request<PlanResponse>(`/api/v1/plans/${id}`);
}

export async function createScenario(
  baselinePlanId: string,
  disruptions: DisruptionRequest[],
  name?: string,
): Promise<ScenarioCreateResponse> {
  const body: Record<string, unknown> = { baseline_plan_id: baselinePlanId, disruptions };
  if (name?.trim()) body.name = name.trim();
  return request<ScenarioCreateResponse>('/api/v1/scenarios/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function renameScenario(id: string, name: string): Promise<void> {
  await request(`/api/v1/scenarios/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export async function deleteScenario(
  id: string,
): Promise<{ deleted: boolean; deleted_plan_ids: string[] }> {
  return request(`/api/v1/scenarios/${id}`, { method: 'DELETE' });
}

export async function runSweep(
  baselinePlanId: string,
  disruption: DisruptionRequest,
  parameter: string,
  values: number[],
): Promise<SweepResponse> {
  return request<SweepResponse>('/api/v1/scenarios/sweep', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseline_plan_id: baselinePlanId,
      disruption,
      parameter,
      values,
    }),
  });
}

export async function getScenario(id: string): Promise<ScenarioDetail> {
  return request<ScenarioDetail>(`/api/v1/scenarios/${id}`);
}

export async function recoverScenario(id: string): Promise<RecoverResponse> {
  return request<RecoverResponse>(`/api/v1/scenarios/${id}/recover`, { method: 'POST' });
}

export async function compareScenario(id: string): Promise<CompareResponse> {
  return request<CompareResponse>(`/api/v1/scenarios/${id}/compare`);
}

export async function exportScenario(id: string): Promise<Blob> {
  // Try server-side export first
  const res = await fetchWithTimeout(`/api/v1/scenarios/${id}/export`);
  if (res.ok) return await res.blob();
  // Fallback: generate CSV client-side from compare endpoint
  const cmp = await compareScenario(id);
  const rows: string[][] = [];
  rows.push(['Pre-Mortem Dispatch — Scenario Export', id]);
  rows.push([]);
  const plans: Array<{ label: string; kpis: KPISnapshot | null | undefined }> = [
    { label: 'baseline', kpis: cmp.baseline?.kpis },
    { label: 'disrupted', kpis: cmp.disrupted?.kpis ?? null },
    { label: 'recovered', kpis: cmp.recovered?.kpis ?? null },
  ];
  rows.push(['plan', 'metric', 'value']);
  for (const p of plans) {
    if (!p.kpis) continue;
    for (const [k, v] of Object.entries(p.kpis)) {
      rows.push([p.label, k, typeof v === 'object' ? JSON.stringify(v) : String(v)]);
    }
  }
  rows.push([]);
  rows.push(['narrative', cmp.tradeoff_narrative]);
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  return new Blob([csv], { type: 'text/csv' });
}

export async function forecast(params: {
  destination_id: string;
  product_id: string;
  horizon?: number;
}): Promise<ForecastResponse> {
  const q = new URLSearchParams({
    destination_id: params.destination_id,
    product_id: params.product_id,
    horizon: String(params.horizon ?? 4),
  });
  return request<ForecastResponse>(`/api/v1/forecast?${q.toString()}`);
}
