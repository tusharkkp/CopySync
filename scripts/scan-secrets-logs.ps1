# scripts/scan-secrets-logs.ps1 - PowerShell Secrets & Log Leak Scanner
$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = (Resolve-Path (Join-Path $scriptDir "..")).Path
Set-Location $rootDir

$failed = $false

# 1. Committed secrets / AWS keys (exclude docs, scripts, build output, and markdown docs)
$secretPattern = 'AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|aws_secret_access_key|-----BEGIN (RSA|EC|PRIVATE)'
$filesToCheck = Get-ChildItem -Path $rootDir -Recurse -File | Where-Object {
    $_.FullName -notmatch '[\\/](\.git|\.aws-sam|node_modules|target|dist|docs|scripts)[\\/]' -and
    $_.Extension -ne '.md'
}

foreach ($f in $filesToCheck) {
    try {
        $content = Get-Content $f.FullName -Raw -ErrorAction SilentlyContinue
        if ($content -and ($content -match $secretPattern)) {
            Write-Host "FAIL: possible credential in $($f.FullName)" -ForegroundColor Red
            $failed = $true
        }
    } catch {}
}

# 2. Dangerous logging of sensitive values in code
$loggingPattern = '(?i)(log|logger|console)\.[a-z]+\(.*(plaintext|clipboardText|snapshot|cek|privateKey|recoverySecret|pairingToken|ciphertext|payload|body)'
$codeFiles = Get-ChildItem -Path $rootDir -Recurse -File | Where-Object {
    ($_.Extension -in '.java', '.ts', '.tsx') -and
    ($_.FullName -notmatch '[\\/](\.git|node_modules|target|dist|test|__tests__)[\\/]')
}

foreach ($f in $codeFiles) {
    try {
        $content = Get-Content $f.FullName -Raw -ErrorAction SilentlyContinue
        if ($content -and ($content -match $loggingPattern)) {
            Write-Host "FAIL: suspicious logging in $($f.FullName)" -ForegroundColor Red
            $failed = $true
        }
    } catch {}
}

# 3. Canary plaintext check
$canary = 'CLIPSYNC_CANARY_9f3a'
$reportFiles = Get-ChildItem -Path $rootDir -Recurse -File | Where-Object {
    ($_.Extension -in '.log', '.xml', '.json', '.html') -and
    ($_.FullName -match '[\\/](backend[\\/]target|e2e[\\/]test-results|playwright-report)[\\/]')
}

foreach ($f in $reportFiles) {
    try {
        $content = Get-Content $f.FullName -Raw -ErrorAction SilentlyContinue
        if ($content -and ($content -match $canary)) {
            Write-Host "FAIL: canary plaintext found in report file $($f.FullName)" -ForegroundColor Red
            $failed = $true
        }
    } catch {}
}

if (-not $failed) {
    Write-Host "OK: no credentials or sensitive logs detected" -ForegroundColor Green
    exit 0
} else {
    exit 1
}
