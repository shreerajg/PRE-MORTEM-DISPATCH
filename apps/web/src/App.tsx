import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
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
const Exports = lazy(() => import('./pages/Exports'));

function PageFallback() {
  return <div className="p-8 text-sm text-slate-500">Loading…</div>;
}

export default function App() {
  return (
    <BrowserRouter>
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
