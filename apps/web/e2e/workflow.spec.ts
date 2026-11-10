import { expect, test } from '@playwright/test';

/**
 * The critical demo path, exercised through the real UI:
 * load sample → baseline → disruption → impact → recovery → compare → export.
 */
test.describe('Pre-Mortem Dispatch — critical workflow', () => {
  test('baseline to disruption to recovery to export', async ({ page }) => {
    // --- 1. Load the bundled sample dataset -------------------------------
    await page.goto('/datasets');
    await expect(page.getByRole('heading', { name: 'Datasets', exact: true })).toBeVisible();

    await page.getByRole('button', { name: /load sample dataset/i }).click();
    await expect(page.getByText(/Dataset imported/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/No issues/i)).toBeVisible();

    // --- 2. Generate the baseline plan -----------------------------------
    await page.goto('/planner');
    await page.getByRole('button', { name: /generate baseline/i }).click();
    await expect(page.getByText(/Baseline plan created/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('All demand fulfilled under the modelled constraints.')).toBeVisible();

    // --- 3. Simulate a route closure -------------------------------------
    await page.goto('/disruption');
    await page.getByLabel('Disruption type').selectOption('route_closure');
    await page.getByLabel('Route').selectOption('RT-03');
    await page.getByRole('button', { name: /simulate disruption/i }).click();

    await expect(page.getByText(/Route closure: set route RT-03 available=False/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Unmet demand after disruption')).toBeVisible();
    // Fulfillment must visibly degrade from the 100% baseline
    await expect(page.getByText(/^89\.9% fulfilled$/)).toBeVisible();
    // Every gap is explained, not just counted
    await expect(page.getByText('Capacity used').first()).toBeVisible();

    // --- 4. Run recovery -------------------------------------------------
    await page.goto('/recovery');
    await page.getByRole('button', { name: /run recovery/i }).click();
    await expect(page.getByRole('button', { name: /re-run recovery/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Recovery actions')).toBeVisible();
    await expect(page.getByText(/Trade-off explanation/i)).toBeVisible();

    // --- 5. Compare ------------------------------------------------------
    await page.goto('/compare');
    await expect(page.getByText('KPI comparison')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Recovered', { exact: false }).first()).toBeVisible();

    // --- 6. Export -------------------------------------------------------
    await page.goto('/exports');
    const downloadPromise = page.waitForEvent('download', { timeout: 20_000 });
    await page.getByRole('button', { name: /download csv/i }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/pre-mortem-scenario-.*\.csv/);

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const csv = Buffer.concat(chunks).toString('utf8');

    expect(csv).toContain('Allocations');
    expect(csv).toContain('KPIs');
    expect(csv).toContain('RT-03'); // baseline used the lane that we later closed
  });

  test('deadline constraint is opt-in and shown on the plan', async ({ page }) => {
    await page.goto('/datasets');
    await page.getByRole('button', { name: /load sample dataset/i }).click();
    await expect(page.getByText(/Dataset imported/i)).toBeVisible({ timeout: 20_000 });

    await page.goto('/planner');
    const toggle = page.getByRole('checkbox', { name: /enforce destination deadlines/i });
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toBeChecked();

    await toggle.check();
    await page.getByRole('button', { name: /generate baseline/i }).click();
    await expect(page.getByText(/Baseline plan created/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Deadlines: enforced')).toBeVisible();
  });

  test('combines two disruptions into one scenario', async ({ page }) => {
    await page.goto('/datasets');
    await page.getByRole('button', { name: /load sample dataset/i }).click();
    await expect(page.getByText(/Dataset imported/i)).toBeVisible({ timeout: 20_000 });

    await page.goto('/planner');
    await page.getByRole('button', { name: /generate baseline/i }).click();
    await expect(page.getByText(/Baseline plan created/i)).toBeVisible({ timeout: 20_000 });

    await page.goto('/disruption');
    await page.getByLabel('Disruption type').selectOption('route_closure');
    await page.getByLabel('Route').selectOption('RT-03');
    await page.getByRole('button', { name: /add to scenario/i }).click();
    await expect(page.getByText(/Combined scenario · 1\/5 events/)).toBeVisible();

    await page.getByLabel('Disruption type').selectOption('inventory_shortage');
    await page.getByLabel('Warehouse').selectOption('WH-02');
    await page.getByLabel('Product').selectOption('PRD-A');
    await page.getByRole('button', { name: /add to scenario/i }).click();
    await expect(page.getByText(/Combined scenario · 2\/5 events/)).toBeVisible();
    await expect(page.getByText('Close RT-03')).toBeVisible();
    await expect(page.getByText(/Shortage WH-02\/PRD-A/)).toBeVisible();

    await page.getByRole('button', { name: /simulate disruption/i }).click();
    await expect(
      page.getByText(/Route closure: set route RT-03 available=False \+ Inventory shortage/),
    ).toBeVisible({ timeout: 20_000 });
  });

  test('sensitivity sweep re-solves a severity range', async ({ page }) => {
    await page.goto('/datasets');
    await page.getByRole('button', { name: /load sample dataset/i }).click();
    await expect(page.getByText(/Dataset imported/i)).toBeVisible({ timeout: 20_000 });

    await page.goto('/planner');
    await page.getByRole('button', { name: /generate baseline/i }).click();
    await expect(page.getByText(/Baseline plan created/i)).toBeVisible({ timeout: 20_000 });

    await page.goto('/disruption');
    await page.getByRole('button', { name: /run sensitivity sweep/i }).click();
    await expect(page.getByText(/Baseline 100\.0% fulfilled/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Stock reduction').first()).toBeVisible();
    await expect(page.getByText(/Ephemeral analysis/)).toBeVisible();
    await expect(page.locator('.recharts-surface').first()).toBeVisible();

    // Delays keep volume, so the sweep must chart lateness instead of fulfilment.
    await page.getByLabel('Disruption type').selectOption('route_delay');
    await page.getByLabel('Route').selectOption('RT-06');
    await page.getByRole('button', { name: /run sensitivity sweep/i }).click();
    await expect(page.getByText(/Delays preserve volume/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('At risk').first()).toBeVisible();
    await expect(page.getByText(/worst case 8d/)).toBeVisible({ timeout: 20_000 });
  });

  test('named scenario can be deleted without touching the baseline', async ({ page }) => {
    const scenarioName = `E2E named ${Date.now()}`;

    await page.goto('/datasets');
    await page.getByRole('button', { name: /load sample dataset/i }).click();
    await expect(page.getByText(/Dataset imported/i)).toBeVisible({ timeout: 20_000 });

    await page.goto('/planner');
    await page.getByRole('button', { name: /generate baseline/i }).click();
    await expect(page.getByText(/Baseline plan created/i)).toBeVisible({ timeout: 20_000 });

    await page.goto('/disruption');
    await page.getByLabel('Scenario name (optional)').fill(scenarioName);
    await page.getByLabel('Disruption type').selectOption('route_closure');
    await page.getByLabel('Route').selectOption('RT-03');
    await page.getByRole('button', { name: /simulate disruption/i }).click();
    await expect(page.getByText(/Route closure: set route RT-03 available=False/)).toBeVisible({ timeout: 20_000 });

    await page.goto('/recovery');
    await expect(page.getByLabel('Scenario', { exact: true })).toContainText(scenarioName);
    await expect(page.getByText(`Scenario ${scenarioName}`)).toBeVisible();

    // The searchable picker should find the run without scrolling a native list.
    await page.getByLabel('Scenario', { exact: true }).click();
    await page.getByLabel('Search scenarios').fill(scenarioName);
    await expect(page.getByRole('option', { name: new RegExp(scenarioName) })).toBeVisible();
    await page.keyboard.press('Escape');

    const renamed = `${scenarioName} renamed`;
    await page.getByRole('button', { name: 'Rename scenario' }).click();
    const renameDialog = page.getByRole('dialog', { name: 'Rename scenario' });
    await renameDialog.getByLabel('Scenario name').fill(renamed);
    await renameDialog.getByRole('button', { name: 'Save name' }).click();
    await expect(page.getByText('Scenario renamed')).toBeVisible();
    await expect(page.getByLabel('Scenario', { exact: true })).toContainText(renamed);

    await page.getByRole('button', { name: 'Delete scenario' }).click();
    const deleteDialog = page.getByRole('dialog', { name: 'Delete scenario' });
    await expect(deleteDialog.getByText(/baseline plan is kept/i)).toBeVisible();
    await deleteDialog.getByRole('button', { name: 'Delete scenario' }).click();
    await expect(page.getByText('Scenario deleted')).toBeVisible();
    await expect(page.getByLabel('Scenario', { exact: true })).not.toContainText(renamed);
  });

  test('a dataset can be renamed and deleted from the workspace', async ({ page, request }) => {
    const created = await request.post('/api/v1/datasets/sample');
    expect(created.ok()).toBeTruthy();
    const datasetId = (await created.json()).dataset_id as string;
    const original = `E2E dataset ${Date.now()}`;
    const renamed = `${original} renamed`;

    const patch = await request.patch(`/api/v1/datasets/${datasetId}`, { data: { name: original } });
    expect(patch.ok()).toBeTruthy();

    await page.goto('/datasets');
    const row = page.getByRole('row', { name: new RegExp(original) });
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: `Rename ${original}` }).click();
    const renameDialog = page.getByRole('dialog', { name: 'Rename dataset' });
    await renameDialog.getByLabel('Dataset name').fill(renamed);
    await renameDialog.getByRole('button', { name: 'Save name' }).click();
    await expect(page.getByText('Dataset renamed')).toBeVisible();
    const renamedRow = page.getByRole('row', { name: new RegExp(renamed) });
    await expect(renamedRow).toBeVisible();

    await renamedRow.getByRole('button', { name: `Delete ${renamed}` }).click();
    const deleteDialog = page.getByRole('dialog', { name: 'Delete dataset' });
    await expect(deleteDialog.getByText(/cannot be undone/i)).toBeVisible();
    await deleteDialog.getByRole('button', { name: 'Delete dataset' }).click();
    await expect(page.getByText(/Deleted “/)).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(renamed) })).toHaveCount(0);

    const gone = await request.get(`/api/v1/datasets/${datasetId}`);
    expect(gone.status()).toBe(404);
  });

  test('dataset search narrows the workspace list', async ({ page }) => {
    await page.goto('/datasets');
    await page.getByRole('button', { name: /load sample dataset/i }).click();
    await expect(page.getByText(/Dataset imported/i)).toBeVisible({ timeout: 20_000 });

    const search = page.getByLabel('Search datasets');
    await search.fill('zzz-no-such-dataset');
    await expect(page.getByText(/No dataset matches/)).toBeVisible();

    await search.fill('Sample Network');
    await expect(page.getByRole('row', { name: /Sample Network/ }).first()).toBeVisible();
  });

  test('keyboard users can skip to content and dismiss a destructive dialog', async ({ page }) => {
    await page.goto('/datasets');
    await page.getByRole('button', { name: /load sample dataset/i }).click();
    await expect(page.getByText(/Dataset imported/i)).toBeVisible({ timeout: 20_000 });

    // Reload so the skip link is genuinely the first tab stop.
    await page.reload();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();

    await page.getByRole('button', { name: /^Rename / }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Rename dataset' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test('empty states explain what to do next', async ({ page }) => {
    // Pin the scenario list to empty so the assertion cannot race a seeded backend.
    await page.route('**/api/v1/scenarios/?limit=*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ scenarios: [], total: 0 }),
      }),
    );

    await page.goto('/recovery');
    // The scenario selector and its empty-state guidance must both be reachable
    await expect(page.getByLabel('Scenario', { exact: true })).toBeVisible();
    await expect(page.getByText(/No scenarios yet/)).toBeVisible();
    await expect(page.getByText('No recovery run yet.')).toBeVisible();
  });
});

test.describe('Operations dashboard', () => {
  test('leads with real service coverage and a clear next action', async ({ page, request }) => {
    const sample = await request.post('/api/v1/datasets/sample');
    expect(sample.ok()).toBeTruthy();
    const dataset = (await sample.json()) as { dataset_id: string };
    const solved = await request.post('/api/v1/plans/', {
      data: { dataset_id: dataset.dataset_id, solver: 'greedy' },
    });
    expect(solved.ok()).toBeTruthy();

    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Operations Dashboard' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Network operating status' })).toBeVisible();
    await expect(page.getByText('Current network fulfillment')).toBeVisible();
    await expect(page.getByText('100.0%', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Network fulfillment' })).toHaveAttribute('aria-valuenow', '100');
    const status = page.getByRole('region', { name: 'Network operating status' });
    await expect(status.getByRole('link', { name: 'Assess resilience' })).toBeVisible();
    await expect(status.getByRole('link', { name: 'Stress-test the plan' })).toBeVisible();
    await expect(page.getByText('Sample Network (bundled)').last()).toBeVisible();
  });

  test('shows scenarios only for the selected baseline', async ({ page, request }) => {
    const sample = await request.post('/api/v1/datasets/sample');
    expect(sample.ok()).toBeTruthy();
    const dataset = (await sample.json()) as { dataset_id: string };
    const createBaseline = async () => {
      const response = await request.post('/api/v1/plans/', {
        data: { dataset_id: dataset.dataset_id, solver: 'greedy' },
      });
      expect(response.ok()).toBeTruthy();
      return (await response.json()) as { id: string };
    };
    const first = await createBaseline();
    const firstScenario = await request.post('/api/v1/scenarios/', {
      data: {
        baseline_plan_id: first.id,
        name: 'First baseline lane failure',
        disruption: { type: 'route_closure', params: { route_id: 'RT-03' } },
      },
    });
    expect(firstScenario.ok()).toBeTruthy();

    const second = await createBaseline();
    const secondScenario = await request.post('/api/v1/scenarios/', {
      data: {
        baseline_plan_id: second.id,
        name: 'Second baseline lane failure',
        disruption: { type: 'route_closure', params: { route_id: 'RT-04' } },
      },
    });
    expect(secondScenario.ok()).toBeTruthy();

    await page.goto('/dashboard');
    const baselineSelect = page.getByRole('combobox', { name: 'Active baseline plan' });
    await expect(baselineSelect).toBeVisible();
    await expect(page.getByRole('link', { name: 'Second baseline lane failure', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'First baseline lane failure', exact: true })).toHaveCount(0);

    await baselineSelect.selectOption(first.id);
    await expect(page.getByRole('link', { name: 'First baseline lane failure', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Second baseline lane failure', exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: 'First baseline lane failure' }).click();
    await expect(page).toHaveURL('/compare');
  });

  test('fits the operating overview on a phone without horizontal overflow', async ({ page, request }) => {
    const sample = await request.post('/api/v1/datasets/sample');
    expect(sample.ok()).toBeTruthy();
    const dataset = (await sample.json()) as { dataset_id: string };
    const solved = await request.post('/api/v1/plans/', {
      data: { dataset_id: dataset.dataset_id, solver: 'greedy' },
    });
    expect(solved.ok()).toBeTruthy();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dashboard');
    await expect(page.getByRole('region', { name: 'Network operating status' })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe('Resilience intelligence', () => {
  test('assesses readiness and ranks solver-tested recovery moves', async ({ page }) => {
    await page.goto('/datasets');
    await page.getByRole('button', { name: /load sample dataset/i }).click();
    await expect(page.getByText(/Dataset imported/i)).toBeVisible({ timeout: 20_000 });

    await page.goto('/planner');
    await page.getByRole('button', { name: /generate baseline/i }).click();
    await expect(page.getByText(/Baseline plan created/i)).toBeVisible({ timeout: 20_000 });

    await page.goto('/resilience');
    await expect(page.getByRole('heading', { name: 'Network Resilience' })).toBeVisible();
    await expect(page.getByText('Readiness score')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('What is likely to break first')).toBeVisible();

    await page.goto('/disruption');
    await page.getByLabel('Disruption type').selectOption('route_closure');
    await page.getByLabel('Route').selectOption('RT-03');
    await page.getByRole('button', { name: /simulate disruption/i }).click();
    await expect(page.getByText(/Route closure: set route RT-03 available=False/)).toBeVisible({ timeout: 20_000 });

    await page.goto('/recovery');
    await page.getByRole('button', { name: /analyze impact and options/i }).click();
    await expect(page.getByText('Service projection')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Complete and on time', { exact: true })).toBeVisible();
    await expect(page.getByText('Solver-tested manufacturer moves')).toBeVisible();
    await expect(page.getByText(/Activate contingency lane RT-13/)).toBeVisible();
  });
});

test.describe('Insights', () => {
  test('aggregates scenario history and shows the activity trail', async ({ page }) => {
    await page.route('**/api/v1/analytics/overview*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          total_scenarios: 2,
          scenarios_analyzed: 2,
          limit: 50,
          summary: {
            scenarios_analyzed: 2,
            recovered: 2,
            avg_disrupted_fulfillment: 0.8994,
            avg_recovery_cost: 3410,
            avg_restored_pp: 10.1,
            open_gap_scenarios: 0,
          },
          by_type: [
            { type: 'route_closure', count: 2, avg_unmet_delta: 500, avg_fulfillment_drop_pp: -10.1 },
          ],
          trend: [
            {
              id: 'scenario-one',
              name: 'Lane closure',
              created_at: '2026-11-01T10:00:00+00:00',
              status: 'recovered',
              disruption_type: 'route_closure',
              baseline_fulfillment: 1,
              disrupted_fulfillment: 0.899,
              recovered_fulfillment: 1,
              cost_delta: -1620,
              unmet_delta: 500,
              recovery_cost: 3410,
              restored_pp: 10.1,
              residual_units: 0,
            },
            {
              id: 'scenario-two',
              name: 'Lane closure again',
              created_at: '2026-11-02T10:00:00+00:00',
              status: 'recovered',
              disruption_type: 'route_closure',
              baseline_fulfillment: 1,
              disrupted_fulfillment: 0.899,
              recovered_fulfillment: 1,
              cost_delta: -1620,
              unmet_delta: 500,
              recovery_cost: 3410,
              restored_pp: 10.1,
              residual_units: 0,
            },
          ],
        }),
      }),
    );
    await page.route('**/api/v1/activity*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          total: 3,
          limit: 12,
          offset: 0,
          events: [
            {
              id: 3,
              at: '2026-11-02T10:00:00+00:00',
              action: 'scenario.recovered',
              entity_type: 'scenario',
              entity_id: 'scenario-two',
              detail: { fulfillment_rate: 1, residual_units: 0 },
            },
            {
              id: 2,
              at: '2026-11-02T09:59:00+00:00',
              action: 'scenario.created',
              entity_type: 'scenario',
              entity_id: 'scenario-two',
              detail: { name: 'Lane closure again', unmet: 500 },
            },
            {
              id: 1,
              at: '2026-11-01T09:00:00+00:00',
              action: 'dataset.created',
              entity_type: 'dataset',
              entity_id: 'dataset-one',
              detail: { name: 'Sample Network (bundled)' },
            },
          ],
        }),
      }),
    );

    await page.goto('/insights');
    await expect(page.getByRole('heading', { name: 'Insights' })).toBeVisible();
    await expect(page.getByText('Scenarios analysed')).toBeVisible();
    await expect(page.getByText('2 recovered')).toBeVisible();
    await expect(page.getByText('$3,410')).toBeVisible();
    await expect(page.getByText('+10.1pp')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Disruption mix' })).toBeVisible();
    await expect(page.getByText('Dataset loaded')).toBeVisible();
    await expect(page.getByText('Recovery run', { exact: true })).toBeVisible();
    await expect(page.locator('.recharts-surface').first()).toBeVisible();
  });
});

test.describe('Landing page', () => {
  test('interactive demo tells the disruption story with real numbers', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: /Know what breaks/i })).toBeVisible();
    await expect(page.getByText(/TRIWIZATHON 2026/i).first()).toBeVisible();

    // Baseline state
    await expect(page.getByText('100.0%').first()).toBeVisible();

    // Break the network on the landing page itself
    await page.getByRole('button', { name: /lane closed/i }).click();
    await expect(page.getByText('89.9%')).toBeVisible();

    // Scoped to the diagram: the workflow cards repeat this figure as a fact chip
    const diagram = page.getByRole('img', { name: /Distribution network/i });
    await expect(diagram.getByText('−500 units')).toBeVisible();
    await expect(page.getByText('$22,620')).toBeVisible();

    // Recover it
    await page.getByRole('button', { name: /^recovered$/i }).click();
    await expect(page.getByText('$26,030')).toBeVisible();
    await expect(page.getByText(/Contingency lane RT-13/i)).toBeVisible();
  });

  test('routes into the console', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /run the workflow/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: /Operations Dashboard/i })).toBeVisible();
  });

  test('sign in hands off to the login route', async ({ page }) => {
    await page.goto('/');
    const signIn = page.getByTestId('login-button');
    await expect(signIn).toBeVisible();

    // Default destination until the Firebase module is merged
    await expect(signIn).toHaveAttribute('href', '/login');
    await signIn.click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('operator token gate verifies and stores the token', async ({ page }) => {
    await page.route('**/api/v1/auth/status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ required: true, scheme: 'bearer' }),
      }),
    );
    await page.route('**/api/v1/auth/check', (route) => {
      const authorization = route.request().headers()['authorization'];
      if (authorization === 'Bearer test-token') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, scheme: 'bearer' }),
        });
      }
      return route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Missing or invalid operator token', code: 'unauthorized' }),
      });
    });

    await page.goto('/login');
    await expect(page.getByLabel('Operator token')).toBeVisible();
    await page.getByLabel('Operator token').fill('test-token');
    await page.getByRole('button', { name: /unlock console/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    const stored = await page.evaluate(() => sessionStorage.getItem('pmd.operator-token'));
    expect(stored).toBe('test-token');
  });

  test('renders without horizontal overflow on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Know what breaks/i })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe('Console navigation', () => {
  test('the fixed rail reads live workspace state and points at the next step', async ({ page }) => {
    const rail = page.locator('aside');

    await page.goto('/datasets');
    await page.getByRole('button', { name: /load sample dataset/i }).click();
    await expect(page.getByText(/Dataset imported/i)).toBeVisible({ timeout: 20_000 });
    await expect(rail.getByText(/Active · Sample Network/)).toBeVisible();

    await page.goto('/planner');
    await page.getByRole('button', { name: /generate baseline/i }).click();
    await expect(page.getByText(/Baseline plan created/i)).toBeVisible({ timeout: 20_000 });
    await expect(rail.getByText(/100\.0% fulfilled · greedy/)).toBeVisible();

    await page.goto('/disruption');
    await page.getByLabel('Disruption type').selectOption('route_closure');
    await page.getByLabel('Route').selectOption('RT-03');
    await page.getByRole('button', { name: /simulate disruption/i }).click();
    await expect(page.getByText(/Route closure: set route RT-03 available=False/)).toBeVisible({
      timeout: 20_000,
    });

    await page.goto('/recovery');
    await page.getByRole('button', { name: /run recovery/i }).click();
    await expect(page.getByText('Recovery actions')).toBeVisible({ timeout: 20_000 });
    await expect(rail.getByText(/recovered plans?/)).toBeVisible();

    // The call to action follows the workspace, not the route you happen to be on.
    await rail.getByRole('link', { name: 'Compare the plans' }).click();
    await expect(page).toHaveURL(/\/compare$/);
    await expect(page.getByText('KPI comparison')).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, 600));
    expect((await rail.boundingBox())?.y).toBe(0);
  });

  test('the phone menu is a fixed drawer with the same live content', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/datasets');
    await page.getByRole('button', { name: /load sample dataset/i }).click();
    await expect(page.getByText(/Dataset imported/i)).toBeVisible({ timeout: 20_000 });

    const menuButton = page.getByRole('button', { name: 'Open console menu' });
    const drawer = page.getByRole('dialog', { name: 'Pre-Mortem Dispatch' });

    await menuButton.click();
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('navigation', { name: 'Primary' })).toBeVisible();
    await expect(drawer.getByText(/Active · Sample Network/)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(menuButton).toBeFocused();

    await menuButton.click();
    await drawer.getByRole('link', { name: /Planner/ }).click();
    await expect(page).toHaveURL(/\/planner$/);
    await expect(drawer).toHaveCount(0);

    await page.evaluate(() => window.scrollTo(0, 800));
    await expect(menuButton).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
