/**
 * Regenerate the README console screenshots from a clean demo run.
 *
 * Usage (from apps/web): start the API on :8000 and Vite on :5173 against a
 * throwaway database, then run
 *
 *   DATABASE_URL=sqlite:///./data/shots.db uvicorn app.main:app --port 8000   # apps/api
 *   npm run dev                                                               # apps/web
 *   node scripts/capture-docs.mjs
 *
 * Screenshots are viewport-sized on purpose: the console shell is a fixed
 * sidebar, and a full-page capture would paint it once and then fall off frame.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173';
const OUT = resolve(process.cwd(), '..', '..', 'docs', 'screenshots');
const SCENARIO_NAME = 'RT-03 lane closure';

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

/** Wait for a transient toast to expire so the next frame reads clean. */
async function settle() {
  await page
    .waitForFunction(() => !document.querySelector('.animate-toast-in'), null, { timeout: 9_000 })
    .catch(() => {});
}

async function shot(name) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(OUT, name) });
  console.log('captured', name);
}

// 1 — workspace: sample network, search field and row actions
await page.goto(`${BASE}/datasets`);
await page.getByRole('button', { name: /load sample dataset/i }).click();
await page.getByText(/Dataset imported/i).waitFor();
await settle();
await page.getByLabel('Search datasets').scrollIntoViewIfNeeded();
await shot('datasets.png');

// 2 — baseline plan
await page.goto(`${BASE}/planner`);
await page.getByRole('button', { name: /generate baseline/i }).click();
await page.getByText(/Baseline plan created/i).waitFor();
await shot('planner.png');

// 3 — disruption
await page.goto(`${BASE}/disruption`);
await page.getByLabel('Scenario name (optional)').fill(SCENARIO_NAME);
await page.getByLabel('Disruption type').selectOption('route_closure');
await page.getByLabel('Route').selectOption('RT-03');
await page.getByRole('button', { name: /simulate disruption/i }).click();
await page.getByText(/Route closure: set route RT-03 available=False/).waitFor();
await settle();
await shot('disruption-lab.png');

// 4 — recovery, then the searchable scenario picker
await page.goto(`${BASE}/recovery`);
await page.getByRole('button', { name: /run recovery/i }).click();
await page.getByText('Recovery actions').waitFor();
await settle();
await shot('recovery.png');

// The rail itself: counters, active context and the next-step action.
await page.locator('aside').screenshot({ path: resolve(OUT, 'console-menu.png') });
console.log('captured console-menu.png');

await page.getByLabel('Scenario', { exact: true }).click();
await page.getByLabel('Search scenarios').fill('RT-03');
await shot('scenario-picker.png');
await page.keyboard.press('Escape');

// 5 — comparison, dashboard, insights
await page.goto(`${BASE}/compare`);
await page.getByText('KPI comparison').waitFor();
await shot('compare.png');

await page.goto(`${BASE}/dashboard`);
await shot('dashboard.png');

await page.goto(`${BASE}/insights`);
await page.getByText(/Disruption mix/i).first().waitFor();
await shot('insights.png');

// 6 — the rename dialog and the toast it produces
await page.goto(`${BASE}/datasets`);
const row = page.getByRole('row', { name: /Sample Network/ }).first();
await row.getByRole('button', { name: /^Rename / }).click();
const dialog = page.getByRole('dialog', { name: 'Rename dataset' });
await dialog.getByLabel('Dataset name').fill('Bundled sample network');
await shot('dataset-dialog.png');
await dialog.getByRole('button', { name: 'Save name' }).click();
await page.getByText('Dataset renamed').waitFor();
await shot('toast.png');

await context.close();

// 7 — the same dialog on a phone, where it docks to the bottom edge
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
const phone = await mobile.newPage();
await phone.goto(`${BASE}/datasets`);
await phone
  .getByRole('row', { name: /sample network/i })
  .first()
  .getByRole('button', { name: /^Rename / })
  .click();
await phone.getByRole('dialog', { name: 'Rename dataset' }).waitFor();
await phone.waitForTimeout(400);
await phone.screenshot({ path: resolve(OUT, 'dataset-dialog-mobile.png') });
console.log('captured dataset-dialog-mobile.png');

await phone.keyboard.press('Escape');
await phone.getByRole('button', { name: 'Open console menu' }).click();
await phone.getByRole('dialog', { name: 'Pre-Mortem Dispatch' }).waitFor();
await phone.waitForTimeout(400);
await phone.screenshot({ path: resolve(OUT, 'menu-mobile.png') });
console.log('captured menu-mobile.png');
await mobile.close();

await browser.close();
