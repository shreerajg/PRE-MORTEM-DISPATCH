import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ToastViewport } from './components/ui/toast';
import Landing from './pages/Landing';
import LoginPlaceholder from './pages/LoginPlaceholder';

// Console pages are split per route so the landing page (and the initial
// bundle) never pays for Recharts or workflow screens it does not render.
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Datasets = lazy(() => import('./pages/Datasets'));
const Planner = lazy(() => import('./pages/Planner'));
const DisruptionLab = lazy(() => import('./pages/DisruptionLab'));
const Recovery = lazy(() => import('./pages/Recovery'));
const Compare = lazy(() => import('./pages/Compare'));
const Insights = lazy(() => import('./pages/Insights'));
const Exports = lazy(() => import('./pages/Exports'));

function PageFallback() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading page">
      <div className="space-y-3">
        <div className="h-3 w-32 animate-pulse rounded bg-slate-900/[0.06]" />
        <div className="h-7 w-64 animate-pulse rounded-lg bg-slate-900/[0.07]" />
        <div className="h-3 w-96 max-w-full animate-pulse rounded bg-slate-900/[0.05]" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl border border-slate-900/[0.05] bg-white" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-2xl border border-slate-900/[0.05] bg-white" />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastViewport />
      <Routes>
        {/* Landing page is full-bleed: it sits outside the console shell */}
        <Route path="/" element={<Landing />} />

        {/* Placeholder until the team's Firebase auth module lands (see the file header) */}
        <Route path="/login" element={<LoginPlaceholder />} />

        <Route
          path="*"
          element={
            <Layout>
              <Suspense fallback={<PageFallback />}>
                <Routes>
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/datasets" element={<Datasets />} />
                  <Route path="/planner" element={<Planner />} />
                  <Route path="/disruption" element={<DisruptionLab />} />
                  <Route path="/recovery" element={<Recovery />} />
                  <Route path="/compare" element={<Compare />} />
                  <Route path="/insights" element={<Insights />} />
                  <Route path="/exports" element={<Exports />} />
                  <Route path="*" element={<Navigate to="/dashboard" replace />} />
                </Routes>
              </Suspense>
            </Layout>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
