#!/usr/bin/env bash
set -euo pipefail

case "${1:-up}" in
  up)
    echo "Starting DynamoDB Local container (clipsync-ddb)..."
    docker run -d --rm --name clipsync-ddb -p 8000:8000 amazon/dynamodb-local:latest -jar DynamoDBLocal.jar -inMemory
    echo "DynamoDB Local is running on port 8000."
    ;;
  down)
    echo "Stopping DynamoDB Local container..."
    docker stop clipsync-ddb 2>/dev/null || true
    echo "DynamoDB Local stopped."
    ;;
  *)
    echo "Usage: $0 {up|down}"
    exit 1
    ;;
esac
