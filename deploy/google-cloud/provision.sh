#!/usr/bin/env bash
# Explicit remote provisioning only. Never run automatically from app startup.
set -euo pipefail
if [[ "${1:-}" != "--apply" ]]; then
  cat <<'PLAN'
Plan only (no API calls):
- Project explicitly supplied as TRATO_CLOUD_PROJECT.
- us-central1 / us-central1-a, one standard e2-standard-2 VM, 30 GB balanced disk.
- Dedicated trato VPC: backend 10.40.0.0/24, Cloud Run 10.41.0.0/24.
- API access: TCP8100 from Cloud Run's trato-web tag to trato-backend tag only.
- SSH only through IAP TCP22, never public SSH/Redis/processor.
- One image registry and one web service account with no project roles.
- No source upload, app launch, private files or database migrations.
Run with --apply only after checking billing expiry and approving this plan.
PLAN
  exit 0
fi
: "${TRATO_CLOUD_PROJECT:?Set the Google project ID}"
command -v gcloud >/dev/null
region=us-central1
zone=us-central1-a
# Stop if our resource names already exist; never edit an existing stack implicitly.
if gcloud compute instances describe trato-demo --project="$TRATO_CLOUD_PROJECT" --zone="$zone" >/dev/null 2>&1; then
  echo 'trato-demo exists. Inspect it; this script will not overwrite it.' >&2
  exit 1
fi
gcloud services enable compute.googleapis.com run.googleapis.com artifactregistry.googleapis.com iam.googleapis.com --project="$TRATO_CLOUD_PROJECT"
gcloud compute networks create trato --subnet-mode=custom --project="$TRATO_CLOUD_PROJECT"
gcloud compute networks subnets create trato-backend --network=trato --region="$region" --range=10.40.0.0/24 --enable-private-ip-google-access --project="$TRATO_CLOUD_PROJECT"
gcloud compute networks subnets create trato-web --network=trato --region="$region" --range=10.41.0.0/24 --enable-private-ip-google-access --project="$TRATO_CLOUD_PROJECT"
gcloud compute firewall-rules create trato-web-to-api --network=trato --allow=tcp:8100 --source-tags=trato-web --target-tags=trato-backend --project="$TRATO_CLOUD_PROJECT"
gcloud compute firewall-rules create trato-iap-ssh --network=trato --allow=tcp:22 --source-ranges=35.235.240.0/20 --target-tags=trato-backend --project="$TRATO_CLOUD_PROJECT"
gcloud iam service-accounts create trato-web --display-name='Trato web runtime (no project roles)' --project="$TRATO_CLOUD_PROJECT"
gcloud artifacts repositories create trato --repository-format=docker --location="$region" --project="$TRATO_CLOUD_PROJECT"
gcloud compute instances create trato-demo --project="$TRATO_CLOUD_PROJECT" --zone="$zone" --machine-type=e2-standard-2 --image-family=debian-12 --image-project=debian-cloud --boot-disk-size=30GB --boot-disk-type=pd-balanced --no-boot-disk-auto-delete --network=trato --subnet=trato-backend --private-network-ip=10.40.0.10 --tags=trato-backend --no-service-account --metadata=enable-oslogin=TRUE --labels=app=trato,purpose=hackathon
printf '%s\n' 'Resources created; app not started. Inspect billing and continue with the deployment guide.'
