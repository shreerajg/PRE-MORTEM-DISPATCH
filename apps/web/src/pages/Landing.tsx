import * as React from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Boxes,
  Calculator,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  GitCompare,
  HeartPulse,
  RotateCcw,
  Shield,
  ShieldAlert,
  Truck,
  Zap,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { health } from '../lib/api';
import { Reveal, useCountUp, usePrefersReducedMotion, useSpotlight } from '../lib/motion';

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

function Mono({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <span className={`font-mono text-[11px] uppercase tracking-[0.18em] ${className}`}>{children}</span>;
}

function StatusPill() {
  const { data, isError } = useQuery({ queryKey: ['health'], queryFn: health, retry: false, refetchInterval: 20000 });
  const ok = !isError && data?.status === 'ok';
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 backdrop-blur">
      <span className={`relative flex h-1.5 w-1.5 ${ok ? 'pulse-ring' : ''}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-400' : 'bg-amber-400'}`} />
      </span>
      <Mono className="text-white/60">
        {isError ? 'engine offline' : ok ? `engine live · ${data?.solver}` : 'connecting'}
      </Mono>
    </div>
  );
}

/** Thin gradient bar tracking page scroll. */
function ScrollProgress() {
  const [progress, setProgress] = React.useState(0);
  React.useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        setProgress(max > 0 ? Math.min(1, window.scrollY / max) : 0);
        raf = 0;
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="fixed inset-x-0 top-0 z-[60] h-[2px] bg-white/5">
      <div
        className="h-full bg-gradient-to-r from-emerald-400 via-teal-300 to-sky-400"
        style={{ width: `${progress * 100}%`, transition: 'width 80ms linear' }}
      />
    </div>
  );
}

/** Word-by-word entrance for the headline. */
function Words({ text, startDelay = 0, className = '' }: { text: string; startDelay?: number; className?: string }) {
  const reduced = usePrefersReducedMotion();
  return (
    <span className={className}>
      {text.split(' ').map((word, i) => (
        <span
          key={`${word}-${i}`}
          className={reduced ? '' : 'animate-word'}
          style={reduced ? undefined : { animationDelay: `${startDelay + i * 70}ms` }}
        >
          {word}
          {i < text.split(' ').length - 1 ? ' ' : ''}
        </span>
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Interactive network demo — visitors can break the plan themselves   */
/* ------------------------------------------------------------------ */

type Phase = 'baseline' | 'disrupted' | 'recovered';

const PHASES: Record<Phase, { label: string; fulfillment: number; unmet: number; cost: number; note: string }> = {
  baseline: { label: 'Baseline', fulfillment: 100, unmet: 0, cost: 24240, note: 'All demand covered on primary lanes.' },
  disrupted: { label: 'Lane closed', fulfillment: 89.9, unmet: 500, cost: 22620, note: 'RT-03 is out. 500 units of DST-01 demand are unserved.' },
  recovered: { label: 'Recovered', fulfillment: 100, unmet: 0, cost: 26030, note: 'Contingency lane RT-13 absorbs the gap at premium cost.' },
};

const WAREHOUSES = [
  { id: 'WH-01', y: 46 },
  { id: 'WH-02', y: 130 },
  { id: 'WH-03', y: 214 },
  { id: 'WH-04', y: 298 },
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

const ACTIVE_LANES: [number, number][] = [
  [46, 66], [46, 218], [130, 180],
  [214, 104], [214, 256], [298, 142], [298, 294],
  [130, 66], [46, 28], [298, 66], [214, 142],
];

function demoLanePath(wy: number, dy: number) {
  return `M 92 ${wy} C 200 ${wy}, 300 ${dy}, 452 ${dy}`;
}

function NetworkDiagram({ phase }: { phase: Phase }) {
  const closed = phase !== 'baseline';
  const recovered = phase === 'recovered';
  const short = phase === 'disrupted';

  return (
    <svg
      viewBox="0 0 560 340"
      className="w-full"
      role="img"
      aria-label={`Distribution network in the ${phase} state`}
    >
      <defs>
        <linearGradient id="laneOk" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(255,255,255,0.30)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0.08)" />
        </linearGradient>
        <linearGradient id="laneDead" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(248,113,113,0.9)" />
          <stop offset="100%" stopColor="rgba(248,113,113,0.2)" />
        </linearGradient>
        <linearGradient id="laneSave" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(52,211,153,0.95)" />
          <stop offset="100%" stopColor="rgba(52,211,153,0.35)" />
        </linearGradient>
        <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* ambient lanes */}
      {ACTIVE_LANES.map(([wy, dy], i) => (
        <path
          key={`lane-${i}`}
          d={demoLanePath(wy, dy)}
          fill="none"
          stroke="url(#laneOk)"
          strokeWidth="1"
          style={{ transition: 'opacity 500ms ease' }}
        />
      ))}

      {/* the lane we close */}
      <path
        d={demoLanePath(130, 28)}
        fill="none"
        stroke={closed ? 'url(#laneDead)' : 'rgba(255,255,255,0.42)'}
        strokeWidth={closed ? 1.8 : 1.2}
        strokeDasharray={closed ? '5 4' : undefined}
        className={closed ? 'animate-pulse-line-fast' : undefined}
        style={{ transition: 'stroke 400ms ease' }}
      />

      {/* contingency lane */}
      <path
        d={demoLanePath(214, 28)}
        fill="none"
        stroke={recovered ? 'url(#laneSave)' : 'rgba(52,211,153,0.22)'}
        strokeWidth={recovered ? 2 : 1.1}
        strokeDasharray="3 5"
        className={recovered ? 'animate-pulse-line' : undefined}
        style={{ transition: 'stroke 500ms ease, stroke-width 400ms ease' }}
      />

      {/* fault marker */}
      {closed && (
        <g filter="url(#softGlow)">
          <circle cx="272" cy="74" r="3.6" fill="#f87171" />
          <circle cx="272" cy="74" r="9" fill="none" stroke="rgba(248,113,113,0.4)" strokeWidth="1" className="animate-ping-slow" />
        </g>
      )}

      {/* recovery marker */}
      {recovered && (
        <g filter="url(#softGlow)">
          <circle cx="300" cy="150" r="3.2" fill="#34d399" />
          <circle cx="300" cy="150" r="9" fill="none" stroke="rgba(52,211,153,0.4)" strokeWidth="1" className="animate-ping-slow" />
        </g>
      )}

      {/* warehouses */}
      {WAREHOUSES.map((w) => (
        <g key={w.id}>
          <rect x="56" y={w.y - 11} width="36" height="22" rx="4" fill="#0b0c0f" stroke="rgba(255,255,255,0.18)" />
          <text x="74" y={w.y + 3.5} textAnchor="middle" fill="rgba(255,255,255,0.85)" fontSize="8" fontFamily="ui-monospace, monospace">
            {w.id.slice(3)}
          </text>
          <text x="14" y={w.y + 3} fill="rgba(255,255,255,0.32)" fontSize="7.5" fontFamily="ui-monospace, monospace">
            {w.id}
          </text>
        </g>
      ))}

      {/* destinations */}
      {DESTS.map((d) => {
        const isShort = short && d.id === 'DST-01';
        const fill = isShort ? '#f87171' : d.priority === 1 ? 'rgba(248,113,113,0.85)' : 'rgba(255,255,255,0.45)';
        return (
          <g key={d.id}>
            {isShort && <circle cx="452" cy={d.y} r="8" fill="none" stroke="rgba(248,113,113,0.45)" strokeWidth="1" className="animate-ping-slow" />}
            <circle cx="452" cy={d.y} r={isShort ? 5 : 4} fill={fill} style={{ transition: 'r 300ms ease' }} />
            <text x="466" y={d.y + 3} fill={isShort ? 'rgba(248,113,113,0.95)' : 'rgba(255,255,255,0.40)'} fontSize="7.5" fontFamily="ui-monospace, monospace">
              {d.label}
            </text>
            {isShort && (
              <text x="466" y={d.y + 13} fill="rgba(248,113,113,0.75)" fontSize="7" fontFamily="ui-monospace, monospace">
                −500 units
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function InteractiveDemo() {
  const [phase, setPhase] = React.useState<Phase>('baseline');
  const data = PHASES[phase];

  const fulfill = useCountUp(data.fulfillment, 700);
  const unmet = useCountUp(data.unmet, 700);
  const cost = useCountUp(data.cost, 700);

  const order: Phase[] = ['baseline', 'disrupted', 'recovered'];

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.045] to-white/[0.01] p-5 shadow-[0_0_100px_-30px_rgba(16,185,129,0.35)] backdrop-blur">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Mono className="text-white/40">live model · try it</Mono>
        <div className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${phase === 'disrupted' ? 'bg-red-400' : 'bg-emerald-400'}`} />
          <Mono className={phase === 'disrupted' ? 'text-red-300/80' : 'text-emerald-300/80'}>
            {phase === 'disrupted' ? '1 lane closed' : phase === 'recovered' ? 'recovery active' : 'all lanes open'}
          </Mono>
        </div>
      </div>

      <NetworkDiagram phase={phase} />

      {/* controls */}
      <div className="mt-4 grid grid-cols-3 gap-1 rounded-lg border border-white/10 bg-black/30 p-1">
        {order.map((p) => {
          const active = phase === p;
          return (
            <button
              key={p}
              type="button"
              aria-pressed={active}
              onClick={() => setPhase(p)}
              className={`rounded-md px-2 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] transition-colors ${
                active ? 'bg-white text-[#08090b]' : 'text-white/45 hover:text-white/80'
              }`}
            >
              {PHASES[p].label}
            </button>
          );
        })}
      </div>

      {/* animated readouts */}
      <div className="mt-4 grid grid-cols-3 gap-3 border-t border-white/[0.07] pt-4">
        <div>
          <Mono className="text-white/35">fulfilled</Mono>
          <div
            className={`mt-1 text-xl font-semibold tabular-nums transition-colors ${
              phase === 'disrupted' ? 'text-red-400' : phase === 'recovered' ? 'text-emerald-400' : 'text-white'
            }`}
          >
            <span ref={fulfill.ref}>{fulfill.value.toFixed(1)}%</span>
          </div>
        </div>
        <div>
          <Mono className="text-white/35">unmet</Mono>
          <div className="mt-1 text-xl font-semibold tabular-nums text-white/80">
            <span ref={unmet.ref}>{Math.round(unmet.value).toLocaleString()}</span>
          </div>
        </div>
        <div>
          <Mono className="text-white/35">cost</Mono>
          <div className="mt-1 text-xl font-semibold tabular-nums text-white/80">
            <span ref={cost.ref}>${Math.round(cost.value).toLocaleString()}</span>
          </div>
        </div>
      </div>

      <p className="mt-3 min-h-[32px] text-[12px] leading-relaxed text-white/45">{data.note}</p>

      {phase !== 'baseline' && (
        <button
          type="button"
          onClick={() => setPhase('baseline')}
          className="mt-1 inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-white/35 transition-colors hover:text-white/70"
        >
          <RotateCcw className="h-3 w-3" /> reset
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Content                                                             */
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

const MARQUEE = [
  'inventory ≤ stock',
  'lane capacity',
  'priority-ordered demand',
  'referential integrity',
  'contingency lanes',
  'deadline exposure',
  'deterministic re-solve',
  'risk score 0–100',
  'residual demand, stated',
  'export == screen',
  'no API key required',
  'runs offline',
];

/* ------------------------------------------------------------------ */

function CapabilityCard({ item, index }: { item: (typeof CAPABILITIES)[number]; index: number }) {
  const ref = useSpotlight<HTMLDivElement>();
  const Icon = item.icon;
  return (
    <Reveal delay={index * 70}>
      <div
        ref={ref}
        className="spotlight group h-full rounded-xl border border-white/[0.07] bg-[#0b0c0f] p-6 transition-all duration-300 hover:-translate-y-1 hover:border-white/20"
      >
        <div className="flex items-center justify-between">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] transition-colors group-hover:border-emerald-400/30 group-hover:bg-emerald-400/5">
            <Icon className="h-4 w-4 text-white/70 transition-colors group-hover:text-emerald-300" />
          </span>
          <Mono className="text-white/25">{item.metric}</Mono>
        </div>
        <h3 className="mt-4 text-[15px] font-medium">{item.title}</h3>
        <p className="mt-2 text-[13px] leading-relaxed text-white/45">{item.body}</p>
      </div>
    </Reveal>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-[#08090b] text-white antialiased">
      <ScrollProgress />

      {/* ---------------- nav ---------------- */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/[0.06] bg-[#08090b]/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link to="/" className="group flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-[#08090b] transition-transform duration-300 group-hover:rotate-[-8deg]">
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
              <a
                key={href}
                href={href}
                className="group relative text-[13px] text-white/50 transition-colors hover:text-white"
              >
                {label}
                <span className="absolute -bottom-1 left-0 h-px w-0 bg-white/60 transition-all duration-300 group-hover:w-full" />
              </a>
            ))}
          </nav>
          <Link
            to="/dashboard"
            className="group inline-flex items-center gap-2 rounded-lg bg-white px-3.5 py-2 text-[13px] font-medium text-[#08090b] transition-all hover:-translate-y-px hover:shadow-[0_8px_30px_-8px_rgba(255,255,255,0.5)]"
          >
            Open console
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </header>

      {/* ---------------- hero ---------------- */}
      <section className="grain relative overflow-hidden pt-32 pb-24">
        {/* aurora */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="animate-aurora absolute -left-40 top-[-10%] h-[38rem] w-[38rem] rounded-full bg-emerald-500/[0.16] blur-[120px]" />
          <div
            className="animate-aurora absolute -right-32 top-[10%] h-[32rem] w-[32rem] rounded-full bg-sky-500/[0.13] blur-[120px]"
            style={{ animationDelay: '-8s' }}
          />
          <div
            className="animate-aurora absolute left-1/3 top-[45%] h-[26rem] w-[26rem] rounded-full bg-teal-400/[0.10] blur-[110px]"
            style={{ animationDelay: '-15s' }}
          />
        </div>

        {/* grid */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.15]"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(255,255,255,0.45) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.45) 1px, transparent 1px)',
            backgroundSize: '64px 64px',
            maskImage: 'radial-gradient(72% 55% at 50% 32%, black, transparent)',
            WebkitMaskImage: 'radial-gradient(72% 55% at 50% 32%, black, transparent)',
          }}
        />

        <div className="relative mx-auto max-w-6xl px-6">
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill />
            <Mono className="text-white/30">TRIWIZATHON 2026 · Distribution Intelligence</Mono>
          </div>

          <div className="mt-8 grid items-start gap-14 lg:grid-cols-[1.02fr_0.98fr]">
            <div className="lg:pt-6">
              <h1 className="text-[2.6rem] font-semibold leading-[1.03] tracking-[-0.035em] sm:text-6xl">
                <Words text="Know what breaks" />
                <br />
                <span className="bg-gradient-to-r from-white via-white to-white/35 bg-clip-text text-transparent">
                  <Words text="before it breaks." startDelay={260} />
                </span>
              </h1>

              <Reveal delay={520}>
                <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-white/55">
                  A distribution plan is a promise. Pre-Mortem Dispatch stress-tests that promise: build the baseline,
                  inject a real disruption, measure the damage, and price the recovery — with every number computed,
                  never narrated.
                </p>
              </Reveal>

              <Reveal delay={620}>
                <div className="mt-8 flex flex-wrap items-center gap-3">
                  <Link
                    to="/dashboard"
                    className="group inline-flex items-center gap-2 rounded-lg bg-white px-5 py-3 text-sm font-medium text-[#08090b] transition-all hover:-translate-y-0.5 hover:shadow-[0_16px_40px_-12px_rgba(255,255,255,0.55)]"
                  >
                    Run the workflow
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </Link>
                  <a
                    href="#demo"
                    className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-5 py-3 text-sm text-white/80 transition-all hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/[0.04] hover:text-white"
                  >
                    See the six steps
                  </a>
                </div>
              </Reveal>

              <Reveal delay={720}>
                <p className="mt-6 flex items-center gap-2 text-[12px] text-white/35">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400/80" />
                  Bundled dataset · no API key · runs fully offline
                </p>
              </Reveal>
            </div>

            <Reveal delay={300} y={26}>
              <div className="relative">
                <InteractiveDemo />
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ---------------- marquee ---------------- */}
      <section className="relative overflow-hidden border-y border-white/[0.06] bg-white/[0.015] py-4">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-[#08090b] to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-[#08090b] to-transparent" />
        <div className="animate-marquee flex w-max gap-8">
          {[...MARQUEE, ...MARQUEE].map((item, i) => (
            <span key={i} className="flex shrink-0 items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-white/25">
              <span className="h-1 w-1 rounded-full bg-emerald-400/40" />
              {item}
            </span>
          ))}
        </div>
      </section>

      {/* ---------------- the question ---------------- */}
      <section id="demo" className="mx-auto max-w-6xl px-6 py-24">
        <Reveal>
          <Mono className="text-white/35">the question this answers</Mono>
          <h2 className="mt-4 max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            “If this plan fails, what is affected, what can be recovered, what will it cost, and what should we do
            next?”
          </h2>
        </Reveal>

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
          ].map(({ step, icon: Icon, accent, body, points }, i) => (
            <Reveal key={step} delay={i * 90}>
              <div className="group relative h-full bg-[#08090b] p-8 transition-colors duration-300 hover:bg-white/[0.03]">
                <div className="flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${accent} transition-transform duration-300 group-hover:scale-110`} />
                  <Mono className="text-white/45">{step}</Mono>
                </div>
                <p className="mt-4 text-[13.5px] leading-relaxed text-white/55">{body}</p>
                <ul className="mt-5 space-y-1.5">
                  {points.map((p) => (
                    <li key={p} className="flex items-center gap-2 font-mono text-[11px] text-white/35">
                      <span className="h-px w-3 bg-white/20 transition-all duration-300 group-hover:w-5 group-hover:bg-emerald-400/50" />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---------------- capabilities ---------------- */}
      <section id="capabilities" className="border-y border-white/[0.06] bg-white/[0.015]">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <Reveal>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <Mono className="text-white/35">capabilities</Mono>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Built for operators, not demos</h2>
              </div>
              <p className="max-w-sm text-[13px] leading-relaxed text-white/40">
                Every module exists because the workflow needs it. Nothing here is a placeholder waiting for a backend.
              </p>
            </div>
          </Reveal>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map((item, i) => (
              <CapabilityCard key={item.title} item={item} index={i} />
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- workflow ---------------- */}
      <section id="workflow" className="mx-auto max-w-6xl px-6 py-24">
        <Reveal>
          <Mono className="text-white/35">workflow</Mono>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Six steps, one unbroken path</h2>
          <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-white/45">
            A judge can complete this without touching source code or a terminal. Each step persists its result, so the
            next one never re-derives what came before.
          </p>
        </Reveal>

        <div className="relative mt-12">
          <div className="pointer-events-none absolute left-0 right-0 top-[52px] hidden h-px bg-gradient-to-r from-transparent via-white/12 to-transparent lg:block" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {WORKFLOW.map(({ n, title, body, icon: Icon }, i) => (
              <Reveal key={n} delay={i * 60}>
                <div className="group relative h-full rounded-xl border border-white/[0.07] bg-[#0b0c0f] p-5 transition-all duration-300 hover:-translate-y-1 hover:border-white/20">
                  <div className="flex items-start justify-between">
                    <Icon className="h-4 w-4 text-white/40 transition-colors duration-300 group-hover:text-emerald-300" />
                    <span className="font-mono text-[11px] text-white/20 transition-colors group-hover:text-white/40">{n}</span>
                  </div>
                  <h3 className="mt-4 text-[14px] font-medium">{title}</h3>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/40">{body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- the maths ---------------- */}
      <section id="maths" className="border-y border-white/[0.06] bg-white/[0.015]">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-24 lg:grid-cols-2">
          <Reveal>
            <div>
              <Mono className="text-white/35">the model</Mono>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Feasibility is not a feeling</h2>
              <p className="mt-4 text-[14px] leading-relaxed text-white/50">
                Allocation is a constrained decision problem, so it is written as one. The objective minimises transport
                cost against a per-unit unmet penalty weighted by destination priority — fulfilling critical demand
                always beats saving freight.
              </p>
              <p className="mt-4 text-[14px] leading-relaxed text-white/50">
                The solver returns an explicit status. A feasible plan satisfies every modelled constraint; it is{' '}
                <span className="text-white">not</span> automatically called optimal, and the UI never implies otherwise.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                {['inventory', 'lane capacity', 'lane availability', 'product eligibility', 'priority'].map((c) => (
                  <span
                    key={c}
                    className="rounded-md border border-white/10 px-2 py-1 font-mono text-[10.5px] text-white/45 transition-colors hover:border-emerald-400/30 hover:text-emerald-200/70"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
          </Reveal>

          <Reveal delay={140}>
            <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#0b0c0f] shadow-[0_0_80px_-40px_rgba(56,189,248,0.5)]">
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
          </Reveal>
        </div>
      </section>

      {/* ---------------- limits ---------------- */}
      <section id="limits" className="mx-auto max-w-6xl px-6 py-24">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <Reveal>
            <div>
              <Mono className="text-white/35">what it is not</Mono>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">A model, not a crystal ball</h2>
              <p className="mt-4 text-[14px] leading-relaxed text-white/50">
                Credibility comes from stating the boundaries. These are enforced in the code and printed in the UI —
                they are not disclaimers added afterwards.
              </p>
            </div>
          </Reveal>
          <ul className="space-y-3">
            {LIMITS.map((limit, i) => (
              <Reveal as="li" key={limit} delay={i * 80}>
                <div className="flex items-start gap-3 rounded-xl border border-white/[0.07] bg-[#0b0c0f] p-5 text-[13px] leading-relaxed text-white/50 transition-colors hover:border-amber-400/20">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400/70" />
                  {limit}
                </div>
              </Reveal>
            ))}
          </ul>
        </div>
      </section>

      {/* ---------------- final CTA ---------------- */}
      <section className="grain relative overflow-hidden border-t border-white/[0.06]">
        <div className="pointer-events-none absolute inset-0">
          <div className="animate-aurora absolute left-1/2 top-full h-[34rem] w-[52rem] -translate-x-1/2 rounded-full bg-emerald-500/[0.14] blur-[130px]" />
        </div>
        <div className="relative mx-auto max-w-6xl px-6 py-24 text-center">
          <Reveal>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-5xl">Break it on purpose.</h2>
            <p className="mx-auto mt-4 max-w-xl text-[14.5px] leading-relaxed text-white/50">
              Load the sample network, close a lane, and watch the recovery price itself. Four clicks, all computed.
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <Link
                to="/dashboard"
                className="group inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-sm font-medium text-[#08090b] transition-all hover:-translate-y-0.5 hover:shadow-[0_16px_50px_-12px_rgba(255,255,255,0.6)]"
              >
                Open the console
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
              <Link
                to="/datasets"
                className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-6 py-3 text-sm text-white/80 transition-all hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/[0.04] hover:text-white"
              >
                Load the sample dataset
              </Link>
            </div>
          </Reveal>
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
