import { useQuery } from '@tanstack/react-query';
import {
  listActivity,
  listDatasets,
  listPlans,
  listScenarios,
  type ActivityEvent,
  type DatasetSummary,
  type PlanSummary,
  type ScenarioSummary,
} from './api';
import { useAppStore } from '../stores/appStore';

export type PipelineStep = {
  id: string;
  label: string;
  to: string;
  done: boolean;
};

export type WorkspacePulse = {
  datasets: DatasetSummary[];
  plans: PlanSummary[];
  scenarios: ScenarioSummary[];
  baselines: PlanSummary[];
  recovered: ScenarioSummary[];
  activeDataset: DatasetSummary | null;
  activeScenario: ScenarioSummary | null;
  lastEvent: ActivityEvent | null;
  steps: PipelineStep[];
  readyCount: number;
  next: { to: string; label: string };
  isLoading: boolean;
};

/**
 * One read of the workspace behind the console menu. The rail, the mobile
 * drawer and the sticky mobile bar all render from this, so the navigation
 * reflects stored state instead of repeating the same static link list.
 *
 * Query keys include the limit on purpose: two pages asking for different page
 * sizes must not overwrite each other's cache, while the prefix invalidations
 * the mutations already emit (`['scenarios']`, `['plans']`, …) still refresh
 * every consumer, this hook included.
 */
export function useWorkspacePulse(): WorkspacePulse {
  const datasetsQuery = useQuery({
    queryKey: ['datasets'],
    queryFn: listDatasets,
    staleTime: 15_000,
    retry: false,
  });
  const plansQuery = useQuery({
    queryKey: ['plans', 50],
    queryFn: () => listPlans(50),
    staleTime: 15_000,
    retry: false,
  });
  const scenariosQuery = useQuery({
    queryKey: ['scenarios', 50],
    queryFn: () => listScenarios(50),
    staleTime: 15_000,
    retry: false,
  });
  const activityQuery = useQuery({
    queryKey: ['activity', 12],
    queryFn: () => listActivity(12),
    staleTime: 15_000,
    retry: false,
  });

  const datasetId = useAppStore((state) => state.datasetId);
  const scenarioId = useAppStore((state) => state.scenarioId);

  const datasets = datasetsQuery.data?.datasets ?? [];
  const plans = plansQuery.data?.plans ?? [];
  const scenarios = scenariosQuery.data?.scenarios ?? [];
  const baselines = plans.filter((plan) => plan.type === 'baseline');
  const recovered = scenarios.filter((scenario) => scenario.recovered_plan_id);

  // Lists arrive newest-first; fall back to the most recent entity when the
  // remembered selection was deleted, so the menu never points at a dead id.
  const activeDataset =
    datasets.find((dataset) => dataset.id === datasetId) ?? datasets[0] ?? null;
  const activeScenario =
    scenarios.find((scenario) => scenario.id === scenarioId) ?? scenarios[0] ?? null;

  const steps: PipelineStep[] = [
    { id: 'load', label: 'Load', to: '/datasets', done: datasets.length > 0 },
    { id: 'plan', label: 'Plan', to: '/planner', done: baselines.length > 0 },
    { id: 'break', label: 'Break', to: '/disruption', done: scenarios.length > 0 },
    { id: 'recover', label: 'Recover', to: '/recovery', done: recovered.length > 0 },
    { id: 'compare', label: 'Compare', to: '/compare', done: recovered.length > 0 },
    { id: 'export', label: 'Export', to: '/exports', done: scenarios.length > 0 },
  ];

  const next = !datasets.length
    ? { to: '/datasets', label: 'Load the sample network' }
    : !baselines.length
      ? { to: '/planner', label: 'Generate a baseline' }
      : !scenarios.length
        ? { to: '/disruption', label: 'Simulate a disruption' }
        : !recovered.length
          ? { to: '/recovery', label: 'Run recovery' }
          : { to: '/compare', label: 'Compare the plans' };

  return {
    datasets,
    plans,
    scenarios,
    baselines,
    recovered,
    activeDataset,
    activeScenario,
    lastEvent: activityQuery.data?.events[0] ?? null,
    steps,
    readyCount: steps.filter((step) => step.done).length,
    next,
    isLoading:
      datasetsQuery.isLoading ||
      plansQuery.isLoading ||
      scenariosQuery.isLoading ||
      activityQuery.isLoading,
  };
}
