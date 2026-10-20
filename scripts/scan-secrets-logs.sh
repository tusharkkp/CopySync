#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
fail=0

# 1. Committed secrets / AWS keys (exclude docs, scripts, build output, and markdown)
if grep -RInE --exclude-dir={node_modules,.git,.aws-sam,target,dist,docs,scripts} \
   --exclude='*.md' \
   'AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|aws_secret_access_key|-----BEGIN (RSA|EC|PRIVATE)' . ; then
  echo "FAIL: possible credential committed"
  fail=1
fi

# 2. Dangerous logging of payload-ish variables
if grep -RInE --include=*.java --include=*.ts --include=*.tsx \
   --exclude-dir={node_modules,.git,target,dist,test,__tests__} \
   '(log|logger|console)\.[a-z]+\(.*(plaintext|clipboardText|snapshot|cek|privateKey|recoverySecret|pairingToken|ciphertext|payload|body)' . ; then
  echo "FAIL: suspicious logging of sensitive-named value"
  fail=1
fi

# 3. Test artifacts/reports containing canary plaintext
CANARY='CLIPSYNC_CANARY_9f3a'
if grep -RIn --exclude-dir={node_modules,.git} --include=*.log --include=*.xml --include=*.json --include=*.html \
   "$CANARY" backend/target e2e/test-results playwright-report 2>/dev/null | grep -v 'frontend-only-allowlist' ; then
  echo "FAIL: canary plaintext found in reports/logs"
  fail=1
fi

if [ $fail -eq 0 ]; then
  echo "OK: no credentials or sensitive logs detected"
fi
exit $fail
