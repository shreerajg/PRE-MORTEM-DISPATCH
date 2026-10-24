import * as React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Activity,
  AlertTriangle,
  Boxes,
  Calculator,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  GitCompare,
  HeartPulse,
  Shield,
  ShieldAlert,
  Truck,
  Zap,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { health } from '../lib/api';

/* ------------------------------------------------------------------ */
/* Small building blocks                                               */
/* ------------------------------------------------------------------ */

function Mono({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <span className={`font-mono text-[11px] uppercase tracking-[0.18em] ${className}`}>{children}</span>;
}

function StatusPill() {
  const { data, isError } = useQuery({ queryKey: ['health'], queryFn: health, retry: false, refetchInterval: 20000 });
  const ok = !isError && data?.status === 'ok';
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 backdrop-blur">
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-400' : 'bg-amber-400'}`} />
      <Mono className="text-white/60">
        {isError ? 'engine offline' : ok ? `engine live · ${data?.solver}` : 'connecting'}
      </Mono>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Network diagram — the product's whole thesis in one graphic         */
/* ------------------------------------------------------------------ */

const WAREHOUSES = [
  { id: 'WH-01', label: 'Central', y: 46 },
  { id: 'WH-02', label: 'East', y: 130 },
  { id: 'WH-03', label: 'West', y: 214 },
  { id: 'WH-04', label: 'South', y: 298 },
];

const DESTS = [
  { id: 'DST-01', label: 'Metro General', y: 28, priority: 1 },
  { id: 'DST-02', label: 'City DC', y: 66, priority: 2 },
  { id: 'DST-03', label: 'Clinic North', y: 104, priority: 1 },
  { id: 'DST-04', label: 'Urban Hub', y: 142, priority: 3 },
  { id: 'DST-05', label: 'Coastal Med', y: 180, priority: 1 },
  { id: 'DST-06', label: 'Inland', y: 218, priority: 2 },
  { id: 'DST-07', label: 'Mountain', y: 256, priority: 4 },
  { id: 'DST-08', label: 'South Dock', y: 294, priority: 3 },
];

function NetworkDiagram() {
  return (
    <div className="relative">
      <div className="pointer-events-none absolute -inset-10 rounded-full bg-[radial-gradient(closest-side,rgba(16,185,129,0.10),transparent)]" />
      <svg viewBox="0 0 560 340" className="relative w-full" role="img" aria-label="Distribution network with one closed lane and one contingency lane">
        <defs>
          <linearGradient id="laneOk" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(255,255,255,0.28)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.10)" />
          </linearGradient>
          <linearGradient id="laneDead" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(248,113,113,0.85)" />
            <stop offset="100%" stopColor="rgba(248,113,113,0.25)" />
          </linearGradient>
        </defs>

        {/* primary lanes */}
        {[
          [46, 66], [46, 218], [130, 28], [130, 180],
          [214, 104], [214, 256], [298, 142], [298, 294],
          [130, 66], [46, 28], [298, 66], [214, 142],
        ].map(([wy, dy], i) => (
          <path
            key={`lane-${i}`}
            d={`M 92 ${wy} C 200 ${wy}, 300 ${dy}, 452 ${dy}`}
            fill="none"
            stroke="url(#laneOk)"
            strokeWidth="1"
          />
        ))}

        {/* the closed lane — the disruption */}
        <path
          d="M 92 130 C 200 130, 300 28, 452 28"
          fill="none"
          stroke="url(#laneDead)"
          strokeWidth="1.6"
          strokeDasharray="5 4"
          className="animate-pulse-line"
        />
        <circle cx="272" cy="74" r="3.5" fill="#f87171" />
        <circle cx="272" cy="74" r="9" fill="none" stroke="rgba(248,113,113,0.35)" strokeWidth="1" className="animate-ping-slow" />

        {/* the contingency lane that saves it */}
        <path
          d="M 92 214 C 200 214, 300 28, 452 28"
          fill="none"
          stroke="rgba(52,211,153,0.75)"
          strokeWidth="1.6"
          strokeDasharray="3 5"
        />
        <circle cx="300" cy="120" r="2.6" fill="#34d399" />

        {/* warehouses */}
        {WAREHOUSES.map((w) => (
          <g key={w.id}>
            <rect x="56" y={w.y - 11} width="36" height="22" rx="4" fill="#0f1115" stroke="rgba(255,255,255,0.18)" />
            <text x="74" y={w.y + 4} textAnchor="middle" fill="rgba(255,255,255,0.85)" fontSize="8" fontFamily="ui-monospace, monospace">
              {w.id.slice(3)}
            </text>
            <text x="16" y={w.y + 3} fill="rgba(255,255,255,0.35)" fontSize="7.5" fontFamily="ui-monospace, monospace">
              WH-{w.id.slice(3)}
            </text>
          </g>
        ))}

        {/* destinations */}
        {DESTS.map((d) => (
          <g key={d.id}>
            <circle cx="452" cy={d.y} r="4" fill={d.priority === 1 ? '#f87171' : 'rgba(255,255,255,0.45)'} />
            <text x="466" y={d.y + 3} fill="rgba(255,255,255,0.42)" fontSize="7.5" fontFamily="ui-monospace, monospace">
              {d.label}
            </text>
          </g>
        ))}
      </svg>

      {/* legend */}
      <div className="mt-2 flex flex-wrap items-center gap-4">
        {[
          ['bg-white/30', 'active lane'],
          ['bg-red-400', 'closed lane'],
          ['bg-emerald-400', 'contingency lane'],
        ].map(([dot, label]) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
            <Mono className="text-white/35">{label}</Mono>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

const CAPABILITIES = [
  {
    icon: Database,
    title: 'Validated ingestion',
    body: 'Six CSVs, schema and type checks, duplicate detection, referential integrity. Invalid rows are reported — never silently dropped.',
    metric: '0 silent drops',
  },
  {
    icon: Calculator,
    title: 'Constrained allocation',
    body: 'Inventory, lane capacity, lane availability, product eligibility and destination priority, solved as an optimisation — not a spreadsheet heuristic.',
    metric: '5 constraint classes',
  },
  {
    icon: Zap,
    title: 'Four disruption types',
    body: 'Stock shortages, supply interruption, lane closure and transit delay. Each mutates real planning inputs and re-solves from scratch.',
    metric: 'real input mutation',
  },
  {
    icon: ShieldAlert,
    title: 'Impact analysis',
    body: 'Unmet demand, affected destinations, cost delta, deadline exposure and a documented 0–100 risk score with a full component breakdown.',
    metric: 'documented weights',
  },
  {
    icon: HeartPulse,
    title: 'Constraint-checked recovery',
    body: 'Contingency lanes activate at premium cost to buy back demand. Every proposed shipment is verified against inventory and capacity.',
    metric: '+$3,410 → +10.1pp',
  },
  {
    icon: GitCompare,
    title: 'Comparable, exportable',
    body: 'Baseline, disrupted and recovered side by side with server-computed deltas. CSV export is generated from stored plan data.',
    metric: 'export == screen',
  },
];

const WORKFLOW = [
  { n: '01', title: 'Load', body: 'Bundled network or your own CSVs', icon: Boxes },
  { n: '02', title: 'Plan', body: 'Baseline allocation, every unit accounted for', icon: Calculator },
  { n: '03', title: 'Break', body: 'Inject a disruption into real inputs', icon: Zap },
  { n: '04', title: 'Measure', body: 'Impact, risk and deadline exposure', icon: Activity },
  { n: '05', title: 'Recover', body: 'Contingency capacity, constraint-checked', icon: HeartPulse },
  { n: '06', title: 'Decide', body: 'Compare, explain, export', icon: FileSpreadsheet },
];

const LIMITS = [
  'Greedy is feasible and priority-respecting — not proven optimal. Every plan states its solver and status.',
  'A route delay raises deadline exposure; it does not delete capacity. That semantics is printed in the UI.',
  'Forecasting is a labelled moving average. No trained model, no invented accuracy, no confidence theatre.',
  'No auth, no roles, no multi-tenancy. Single-operator demo by design.',
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-[#08090b] text-white antialiased">
      {/* ---------------- nav ---------------- */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/[0.06] bg-[#08090b]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-[#08090b]">
              <Shield className="h-4 w-4" />
            </span>
            <span className="text-sm font-semibold tracking-tight">Pre-Mortem Dispatch</span>
          </Link>
          <nav className="hidden items-center gap-7 md:flex">
            {[
              ['How it works', '#workflow'],
              ['Capabilities', '#capabilities'],
              ['The maths', '#maths'],
              ['Limits', '#limits'],
            ].map(([label, href]) => (
              <a key={href} href={href} className="text-[13px] text-white/50 transition-colors hover:text-white">
                {label}
              </a>
            ))}
          </nav>
          <Link
            to="/dashboard"
            className="group inline-flex items-center gap-2 rounded-lg bg-white px-3.5 py-2 text-[13px] font-medium text-[#08090b] transition-transform hover:-translate-y-px"
          >
            Open console
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </header>

      {/* ---------------- hero ---------------- */}
      <section className="relative overflow-hidden pt-32 pb-20">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(16,185,129,0.10),transparent)]" />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.14]"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.5) 1px, transparent 1px)',
            backgroundSize: '64px 64px',
            maskImage: 'radial-gradient(70% 60% at 50% 30%, black, transparent)',
            WebkitMaskImage: 'radial-gradient(70% 60% at 50% 30%, black, transparent)',
          }}
        />

        <div className="relative mx-auto max-w-6xl px-6">
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill />
            <Mono className="text-white/30">TRIWIZATHON 2026 · Distribution Intelligence</Mono>
          </div>

          <div className="mt-8 grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <h1 className="text-[2.6rem] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-6xl">
                Know what breaks
                <br />
                <span className="bg-gradient-to-r from-white via-white to-white/40 bg-clip-text text-transparent">
                  before it breaks.
                </span>
              </h1>
              <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-white/55">
                A distribution plan is a promise. Pre-Mortem Dispatch stress-tests that promise: build the baseline,
                inject a real disruption, measure the damage, and price the recovery — with every number computed,
                never narrated.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link
                  to="/dashboard"
                  className="group inline-flex items-center gap-2 rounded-lg bg-white px-5 py-3 text-sm font-medium text-[#08090b] transition-transform hover:-translate-y-px"
                >
                  Run the workflow
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
                <a
                  href="#workflow"
                  className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-5 py-3 text-sm text-white/80 transition-colors hover:border-white/30 hover:text-white"
                >
                  See the six steps
                </a>
              </div>

              <p className="mt-6 flex items-center gap-2 text-[12px] text-white/35">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400/80" />
                Bundled dataset · no API key · runs fully offline
              </p>
            </div>

            <div className="relative">
              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 shadow-[0_0_80px_-20px_rgba(16,185,129,0.25)]">
                <div className="mb-4 flex items-center justify-between">
                  <Mono className="text-white/40">network · sample</Mono>
                  <Mono className="text-red-400/80">1 lane closed</Mono>
                </div>
                <NetworkDiagram />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- live numbers ---------------- */}
      <section className="border-y border-white/[0.06] bg-white/[0.015]">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <div className="grid gap-6 sm:grid-cols-3 lg:grid-cols-4">
            {[
              ['Baseline fulfilled', '100.0%', 'text-white', '0 unmet · $24,240'],
              ['Lane RT-03 closed', '89.9%', 'text-red-400', '500 unmet · −$1,620'],
              ['Recovery', '100.0%', 'text-emerald-400', '0 unmet · $26,030'],
              ['Cost of resilience', '+$3,410', 'text-amber-300', 'buys back 10.1 points'],
            ].map(([label, value, tone, sub]) => (
              <div key={label}>
                <Mono className="text-white/35">{label}</Mono>
                <div className={`mt-2 text-3xl font-semibold tracking-tight tabular-nums ${tone}`}>{value}</div>
                <div className="mt-1 font-mono text-[11px] text-white/30">{sub}</div>
              </div>
            ))}
          </div>
          <p className="mt-6 border-t border-white/[0.06] pt-4 text-[12px] text-white/30">
            Real computed output from the bundled network — not an illustration of one.
          </p>
        </div>
      </section>

      {/* ---------------- the three acts ---------------- */}
      <section className="mx-auto max-w-6xl px-6 py-24">
        <Mono className="text-white/35">the question this answers</Mono>
        <h2 className="mt-4 max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          “If this plan fails, what is affected, what can be recovered, what will it cost, and what should we do next?”
        </h2>

        <div className="mt-14 grid gap-px overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.06] md:grid-cols-3">
          {[
            {
              step: 'Plan',
              icon: Calculator,
              accent: 'text-white',
              body: 'A constrained allocation you can defend line by line: which warehouse ships which product to which destination, on which lane, at what cost.',
              points: ['Inventory ≤ stock', 'Shipments ≤ lane capacity', 'Priority-ordered demand'],
            },
            {
              step: 'Break',
              icon: AlertTriangle,
              accent: 'text-red-400',
              body: 'Choose a disruption and the engine rewrites the planning inputs, then solves again. The impact is the gap between two real plans.',
              points: ['Stock shortage', 'Supply interruption', 'Lane closure / delay'],
            },
            {
              step: 'Recover',
              icon: Truck,
              accent: 'text-emerald-400',
              body: 'Contingency capacity and priority ordering re-plan under the damaged conditions — and tell you exactly what is still short.',
              points: ['Contingency lanes', 'Per-shipment diffs', 'Residual demand, stated'],
            },
          ].map(({ step, icon: Icon, accent, body, points }) => (
            <div key={step} className="group relative bg-[#08090b] p-8 transition-colors hover:bg-white/[0.025]">
              <div className="flex items-center gap-2">
                <Icon className={`h-4 w-4 ${accent}`} />
                <Mono className="text-white/45">{step}</Mono>
              </div>
              <p className="mt-4 text-[13.5px] leading-relaxed text-white/55">{body}</p>
              <ul className="mt-5 space-y-1.5">
                {points.map((p) => (
                  <li key={p} className="flex items-center gap-2 font-mono text-[11px] text-white/35">
                    <span className="h-px w-3 bg-white/20" />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- capabilities ---------------- */}
      <section id="capabilities" className="border-y border-white/[0.06] bg-white/[0.015]">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <Mono className="text-white/35">capabilities</Mono>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Built for operators, not demos</h2>
            </div>
            <p className="max-w-sm text-[13px] leading-relaxed text-white/40">
              Every module exists because the workflow needs it. Nothing here is a placeholder waiting for a backend.
            </p>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map(({ icon: Icon, title, body, metric }) => (
              <div
                key={title}
                className="group rounded-xl border border-white/[0.07] bg-[#0b0c0f] p-6 transition-all hover:-translate-y-0.5 hover:border-white/15"
              >
                <div className="flex items-center justify-between">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04]">
                    <Icon className="h-4 w-4 text-white/70" />
                  </span>
                  <Mono className="text-white/25">{metric}</Mono>
                </div>
                <h3 className="mt-4 text-[15px] font-medium">{title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-white/45">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- workflow ---------------- */}
      <section id="workflow" className="mx-auto max-w-6xl px-6 py-24">
        <Mono className="text-white/35">workflow</Mono>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Six steps, one unbroken path</h2>
        <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-white/45">
          A judge can complete this without touching source code or a terminal. Each step persists its result, so the
          next one never re-derives what came before.
        </p>

        <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {WORKFLOW.map(({ n, title, body, icon: Icon }) => (
            <div key={n} className="relative rounded-xl border border-white/[0.07] bg-[#0b0c0f] p-5">
              <div className="flex items-start justify-between">
                <Icon className="h-4 w-4 text-white/40" />
                <span className="font-mono text-[11px] text-white/20">{n}</span>
              </div>
              <h3 className="mt-4 text-[14px] font-medium">{title}</h3>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/40">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- the maths ---------------- */}
      <section id="maths" className="border-y border-white/[0.06] bg-white/[0.015]">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-24 lg:grid-cols-2">
          <div>
            <Mono className="text-white/35">the model</Mono>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Feasibility is not a feeling
            </h2>
            <p className="mt-4 text-[14px] leading-relaxed text-white/50">
              Allocation is a constrained decision problem, so it is written as one. The objective minimises transport
              cost against a per-unit unmet penalty weighted by destination priority — fulfilling critical demand always
              beats saving freight.
            </p>
            <p className="mt-4 text-[14px] leading-relaxed text-white/50">
              The solver returns an explicit status. A feasible plan satisfies every modelled constraint; it is{' '}
              <span className="text-white">not</span> automatically called optimal, and the UI never implies otherwise.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {['inventory', 'lane capacity', 'lane availability', 'product eligibility', 'priority'].map((c) => (
                <span key={c} className="rounded-md border border-white/10 px-2 py-1 font-mono text-[10.5px] text-white/45">
                  {c}
                </span>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#0b0c0f]">
            <div className="flex items-center gap-1.5 border-b border-white/[0.06] px-4 py-2.5">
              <span className="h-2 w-2 rounded-full bg-white/15" />
              <span className="h-2 w-2 rounded-full bg-white/15" />
              <span className="h-2 w-2 rounded-full bg-white/15" />
              <Mono className="ml-2 text-white/25">optimisation.py</Mono>
            </div>
            <pre className="overflow-x-auto p-5 font-mono text-[11.5px] leading-relaxed text-white/60">
              <span className="text-white/25"># decision variable</span>
              {'\n'}
              <span className="text-emerald-300/90">x</span>[r, p]  <span className="text-white/30">≥ 0</span>
              {'    # units shipped on lane r for product p\n\n'}
              <span className="text-white/25"># hard constraints</span>
              {'\n'}Σ<span className="text-white/40">_r</span> x[r, p] ≤ <span className="text-sky-300/80">inventory</span>[w(r), p]
              {'\n'}Σ<span className="text-white/40">_p</span> x[r, p] ≤ <span className="text-sky-300/80">capacity</span>[r]
              {'\n'}Σ<span className="text-white/40">_r</span> x[r, p] + u[d, p] = <span className="text-sky-300/80">demand</span>[d, p]
              {'\n'}
              <span className="text-white/25"># unavailable lane  ⇒  x = 0</span>
              {'\n\n'}
              <span className="text-white/25"># objective</span>
              {'\n'}min  Σ cost[r]·x[r, p]
              {'\n'}   + Σ 1000 · (6 − priority(d)) · u[d, p]   <span className="text-white/25"># $5,000–$1,000/unit</span>
            </pre>
          </div>
        </div>
      </section>

      {/* ---------------- honest limits ---------------- */}
      <section id="limits" className="mx-auto max-w-6xl px-6 py-24">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <Mono className="text-white/35">what it is not</Mono>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              A model, not a crystal ball
            </h2>
            <p className="mt-4 text-[14px] leading-relaxed text-white/50">
              Credibility comes from stating the boundaries. These are enforced in the code and printed in the UI — they
              are not disclaimers added afterwards.
            </p>
          </div>
          <ul className="space-y-3">
            {LIMITS.map((limit) => (
              <li
                key={limit}
                className="flex items-start gap-3 rounded-xl border border-white/[0.07] bg-[#0b0c0f] p-5 text-[13px] leading-relaxed text-white/50"
              >
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400/70" />
                {limit}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ---------------- final CTA ---------------- */}
      <section className="relative overflow-hidden border-t border-white/[0.06]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_100%_at_50%_100%,rgba(16,185,129,0.12),transparent)]" />
        <div className="relative mx-auto max-w-6xl px-6 py-24 text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-5xl">Break it on purpose.</h2>
          <p className="mx-auto mt-4 max-w-xl text-[14.5px] leading-relaxed text-white/50">
            Load the sample network, close a lane, and watch the recovery price itself. Four clicks, all computed.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link
              to="/dashboard"
              className="group inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-sm font-medium text-[#08090b] transition-transform hover:-translate-y-px"
            >
              Open the console
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              to="/datasets"
              className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-6 py-3 text-sm text-white/80 transition-colors hover:border-white/30 hover:text-white"
            >
              Load the sample dataset
            </Link>
          </div>
        </div>
      </section>

      {/* ---------------- footer ---------------- */}
      <footer className="border-t border-white/[0.06]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8">
          <div className="flex items-center gap-2.5">
            <span className="flex h-6 w-6 items-center justify-center rounded bg-white/10">
              <Shield className="h-3 w-3 text-white/70" />
            </span>
            <span className="text-[12.5px] text-white/40">Pre-Mortem Dispatch</span>
          </div>
          <div className="flex flex-wrap items-center gap-5 font-mono text-[11px] text-white/25">
            <span>TRIWIZATHON 2026</span>
            <span>Distribution Intelligence</span>
            <Link to="/dashboard" className="transition-colors hover:text-white/50">
              Console
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
