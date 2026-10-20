# scripts/verify.ps1 - PowerShell Verification Runner
param(
    [string]$Mode = "fast"
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = (Resolve-Path (Join-Path $scriptDir "..")).Path
Set-Location $rootDir

function Step($name) {
    Write-Host "`n=== $name ===" -ForegroundColor Cyan
}

function Run-FrontendFast {
    Step "frontend lint + typecheck + unit tests"
    Push-Location (Join-Path $rootDir "frontend")
    try {
        npm run lint
        npm run typecheck
        npm test
    } finally {
        Pop-Location
    }
}

function Run-BackendFast {
    Step "backend build + unit tests"
    Push-Location (Join-Path $rootDir "backend")
    try {
        mvn -q -B test
    } finally {
        Pop-Location
    }
}

function Run-InfraChecks {
    Step "sam validate + cost guard"
    Push-Location (Join-Path $rootDir "infra")
    try {
        sam validate --lint
    } finally {
        Pop-Location
    }
    & "$rootDir\scripts\guard-cost.ps1"
}

function Run-Security {
    Step "leak scan"
    & "$rootDir\scripts\scan-secrets-logs.ps1"
    Step "frontend audit"
    Push-Location (Join-Path $rootDir "frontend")
    try {
        npm audit --audit-level=high
    } finally {
        Pop-Location
    }
}

switch ($Mode) {
    "fast" {
        Run-FrontendFast
        Run-BackendFast
    }
    "security" {
        Run-Security
    }
    "0" {
        Write-Host "Phase 0 is manual: see docs/aws/00-account-bootstrap.md checklist"
    }
    "1" {
        Run-FrontendFast
        Run-BackendFast
        Run-InfraChecks
        Run-Security
    }
    default {
        Write-Host "Running Mode $Mode..."
        Run-FrontendFast
        Run-BackendFast
        Run-InfraChecks
        Run-Security
    }
}

Write-Host "`nVERIFY $Mode : OK" -ForegroundColor Green
