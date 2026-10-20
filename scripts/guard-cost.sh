#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
T=infra/template.yaml
fail=0
deny() { echo "FAIL (cost): $1"; fail=1; }

# Forbidden resource types
for r in 'AWS::EC2::NatGateway' 'AWS::EC2::Instance' 'AWS::ECS::' 'AWS::EKS::' 'AWS::RDS::' 'AWS::ElastiCache::' \
         'AWS::OpenSearch' 'AWS::Elasticsearch' 'AWS::SecretsManager::' 'AWS::KMS::Key' 'AWS::WAFv2::' 'AWS::CloudFront::' \
         'AWS::Route53::' 'AWS::Cognito::' 'AWS::EC2::VPC' 'AWS::Kinesis' 'AWS::MSK' 'AWS::Backup::'; do
  grep -q "$r" "$T" && deny "forbidden resource type $r"
done

grep -qiE 'TracingConfig|Tracing: *Active|AWS::XRay' "$T" && deny "X-Ray tracing enabled"
grep -qiE 'PointInTimeRecoveryEnabled: *true|StreamSpecification|GlobalSecondaryIndexes' "$T" && deny "DynamoDB PITR/streams/GSI needs approval"

# When resources exist in template, check required safety settings
if grep -q 'AWS::Logs::LogGroup' "$T"; then
  grep -q 'RetentionInDays: *7' "$T" || deny "log groups must set RetentionInDays: 7"
fi

if grep -q 'AWS::Serverless::Function' "$T"; then
  grep -q 'ReservedConcurrentExecutions' "$T" || deny "Lambda reserved concurrency (cost brake) missing"
  grep -q 'arm64' "$T" || deny "Lambda should use arm64"
  grep -qE 'Timeout: *([0-9]|1[0-5])$' "$T" || deny "Lambda timeout should be <= 15s (prefer <= 10s)"
fi

if grep -q 'AWS::ApiGatewayV2::Stage' "$T"; then
  grep -qE 'ThrottlingBurstLimit|ThrottlingRateLimit|DefaultRouteSettings' "$T" || deny "API Gateway stage throttling missing"
fi

grep -q 'BillingMode: *PAY_PER_REQUEST' "$T" && echo "WARN: on-demand DynamoDB — confirm free-tier coverage with owner"

if [ $fail -eq 0 ]; then
  echo "OK: cost guard passed (no forbidden resources or missing brakes)"
fi
exit $fail
