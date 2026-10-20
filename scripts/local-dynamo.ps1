# scripts/local-dynamo.ps1 - PowerShell DynamoDB Local Manager
param(
    [ValidateSet("up", "down")]
    [string]$Action = "up"
)

if ($Action -eq "up") {
    Write-Host "Starting DynamoDB Local container (clipsync-ddb)..." -ForegroundColor Cyan
    docker run -d --rm --name clipsync-ddb -p 8000:8000 amazon/dynamodb-local:latest -jar DynamoDBLocal.jar -inMemory
    Write-Host "DynamoDB Local is running on http://localhost:8000" -ForegroundColor Green
} elseif ($Action -eq "down") {
    Write-Host "Stopping DynamoDB Local container..." -ForegroundColor Cyan
    docker stop clipsync-ddb 2>$null
    Write-Host "DynamoDB Local stopped." -ForegroundColor Green
}
