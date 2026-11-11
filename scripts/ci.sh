#!/usr/bin/env bash
# Local equivalent of the GitHub Actions workflow in docs/github-actions-ci.yml.
# Run from anywhere: scripts/ci.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "== backend dependency audit"
python -m pip install pip-audit==2.10.1
python -m pip_audit -r apps/api/requirements-dev.txt

echo "== backend tests"
python -m pytest apps/api/tests -q

echo "== frontend typecheck + build"
(
  cd apps/web
  npm run typecheck
  npm run build
  npm audit --audit-level=moderate
)

echo "== browser workflow (starts API + Vite itself)"
(
  cd apps/web
  npx playwright test
)

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo "== container builds"
  docker compose config >/dev/null
  docker compose build
else
  echo "== container builds skipped (docker daemon unavailable)"
fi

echo "CI checks passed."
