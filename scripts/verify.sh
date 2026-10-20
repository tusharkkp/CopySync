#!/usr/bin/env bash
# Usage: scripts/verify.sh <fast|security|e2e|0..10>
set -euo pipefail
cd "$(dirname "$0")/.."
step() { printf '\n=== %s ===\n' "$*"; }
mode="${1:-fast}"

frontend_fast() {
  step "frontend lint + typecheck + unit tests"
  (cd frontend && npm run lint && npm run typecheck && npm test)
}

backend_fast() {
  step "backend build + unit tests"
  (cd backend && mvn -q -B test)
}

infra_checks() {
  step "sam validate + cost guard"
  (cd infra && sam validate --lint)
  bash scripts/guard-cost.sh
}

security() {
  step "leak scan"
  bash scripts/scan-secrets-logs.sh
  step "frontend audit"
  (cd frontend && npm audit --audit-level=high)
}

coverage() {
  step "coverage gates"
  (cd frontend && npm run coverage)
  (cd backend && mvn -q -B verify jacoco:report)
}

case "$mode" in
  fast)
    frontend_fast
    backend_fast
    ;;
  security)
    security
    ;;
  0)
    echo "Phase 0 is manual: see docs/aws/00-account-bootstrap.md checklist"
    ;;
  1)
    frontend_fast
    backend_fast
    infra_checks
    security
    ;;
  *)
    echo "Running Mode $mode..."
    frontend_fast
    backend_fast
    infra_checks
    security
    ;;
esac

echo
echo "VERIFY $mode: OK"
