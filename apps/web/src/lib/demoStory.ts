/**
 * The narrative shown on the landing page is a fixed run of the bundled sample
 * dataset. Keep every displayed figure here so the UI cannot drift from the
 * backend behaviour it claims to demonstrate.
 *
 * Source run (greedy solver, sample data): baseline → close RT-03 → recover.
 * `apps/api/tests/test_contract.py::test_landing_demo_story_matches_computed_run`
 * recomputes this run and asserts these values.
 */

export type DemoPhase = 'baseline' | 'disrupted' | 'recovered';

export const DEMO_LANES = {
  closed: 'RT-03',
  contingency: ['RT-13', 'RT-16', 'RT-19'],
} as const;

export const DEMO_NETWORK = {
  warehouses: 4,
  destinations: 8,
  lanes: 20,
  shipments: 27,
} as const;

const DISRUPTED_UNITS = 500;

export const DEMO_STORY: Record<
  DemoPhase,
  { label: string; fulfillment: number; unmet: number; cost: number; risk: number; note: string }
> = {
  baseline: {
    label: 'Baseline',
    fulfillment: 100,
    unmet: 0,
    cost: 24240,
    risk: 16.64,
    note: 'All demand covered on primary lanes.',
  },
  disrupted: {
    label: 'Lane closed',
    fulfillment: 89.9,
    unmet: DISRUPTED_UNITS,
    cost: 22620,
    risk: 25.65,
    note: `${DEMO_LANES.closed} out. ${DISRUPTED_UNITS} units of DST-01 unserved.`,
  },
  recovered: {
    label: 'Recovered',
    fulfillment: 100,
    unmet: 0,
    cost: 26030,
    risk: 11.95,
    note: `Contingency lane ${DEMO_LANES.contingency[0]} absorbs the gap.`,
  },
};

export const DEMO_EXTRA_COST = DEMO_STORY.recovered.cost - DEMO_STORY.disrupted.cost;

export const DEMO_RECOVERY_GAIN_PP = Number(
  (DEMO_STORY.recovered.fulfillment - DEMO_STORY.disrupted.fulfillment).toFixed(1),
);
