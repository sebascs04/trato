#!/usr/bin/env bash
# Deploy a previously built image; no credentials or secret env in this service.
set -euo pipefail
: "${TRATO_CLOUD_PROJECT:?Set project}"
: "${TRATO_WEB_IMAGE:?Set the reviewed image URI pinned with @sha256 digest}"
: "${TRATO_WEB_ORIGIN:?Set the canonical https://...run.app origin}"
[[ "$TRATO_WEB_IMAGE" =~ @sha256:[a-f0-9]{64}$ ]] || { echo 'Image must be pinned by digest' >&2; exit 1; }
[[ "$TRATO_WEB_ORIGIN" =~ ^https://[a-zA-Z0-9-]+\.run\.app$ ]] || { echo 'Expected the exact Cloud Run HTTPS origin' >&2; exit 1; }
gcloud run deploy trato-web --project="$TRATO_CLOUD_PROJECT" --region=us-central1 --image="$TRATO_WEB_IMAGE" --service-account="trato-web@${TRATO_CLOUD_PROJECT}.iam.gserviceaccount.com" --network=trato --subnet=trato-web --network-tags=trato-web --vpc-egress=private-ranges-only --port=8080 --cpu=1 --memory=256Mi --concurrency=20 --timeout=120 --min=1 --max=1 --cpu-throttling --allow-unauthenticated --set-env-vars="HOST=0.0.0.0,TRATO_DEPLOYMENT_MODE=connected,TRATO_API_URL=http://10.40.0.10:8100,WEB_ORIGIN=$TRATO_WEB_ORIGIN"
