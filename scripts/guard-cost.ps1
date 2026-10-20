# scripts/guard-cost.ps1 - Windows PowerShell Cost Guard
$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$templatePath = Join-Path $scriptDir "..\infra\template.yaml"

if (-not (Test-Path $templatePath)) {
    Write-Error "Template not found at $templatePath"
    exit 1
}

$content = Get-Content $templatePath -Raw
$failed = $false

function Deny($msg) {
    Write-Host "FAIL (cost): $msg" -ForegroundColor Red
    $script:failed = $true
}

# Forbidden resource types
$forbidden = @(
    'AWS::EC2::NatGateway', 'AWS::EC2::Instance', 'AWS::ECS::', 'AWS::EKS::', 'AWS::RDS::',
    'AWS::ElastiCache::', 'AWS::OpenSearch', 'AWS::Elasticsearch', 'AWS::SecretsManager::',
    'AWS::KMS::Key', 'AWS::WAFv2::', 'AWS::CloudFront::', 'AWS::Route53::', 'AWS::Cognito::',
    'AWS::EC2::VPC', 'AWS::Kinesis', 'AWS::MSK', 'AWS::Backup::'
)

foreach ($r in $forbidden) {
    if ($content -match [regex]::Escape($r)) {
        Deny "forbidden resource type $r"
    }
}

if ($content -match '(?i)(TracingConfig|Tracing:\s*Active|AWS::XRay)') {
    Deny "X-Ray tracing enabled"
}
if ($content -match '(?i)(PointInTimeRecoveryEnabled:\s*true|StreamSpecification|GlobalSecondaryIndexes)') {
    Deny "DynamoDB PITR/streams/GSI needs approval"
}

# Conditional safety settings when resources exist
if ($content -match 'AWS::Logs::LogGroup') {
    if ($content -notmatch 'RetentionInDays:\s*7') {
        Deny "log groups must set RetentionInDays: 7"
    }
}
if ($content -match 'AWS::Serverless::Function') {
    if ($content -notmatch 'ReservedConcurrentExecutions') {
        Deny "Lambda reserved concurrency (cost brake) missing"
    }
    if ($content -notmatch 'arm64') {
        Deny "Lambda should use arm64"
    }
    if ($content -notmatch 'Timeout:\s*([0-9]|1[0-5])\b') {
        Deny "Lambda timeout should be <= 15s (prefer <= 10s)"
    }
}
if ($content -match 'AWS::ApiGatewayV2::Stage') {
    if ($content -notmatch '(ThrottlingBurstLimit|ThrottlingRateLimit|DefaultRouteSettings)') {
        Deny "API Gateway stage throttling missing"
    }
}
if ($content -match 'BillingMode:\s*PAY_PER_REQUEST') {
    Write-Host "WARN: on-demand DynamoDB -- confirm free-tier coverage with owner" -ForegroundColor Yellow
}

if (-not $failed) {
    Write-Host "OK: cost guard passed (no forbidden resources or missing brakes)" -ForegroundColor Green
    exit 0
} else {
    exit 1
}
