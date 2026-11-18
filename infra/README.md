# GCP deployment

The Cloud Run Job runs the OpenCode SDK and evaluator; Cloud Storage keeps the immutable forecast artifacts. By default the job replays the pinned MTA snapshot without contacting the live MTA feed, and writes under `snapshots/<snapshot-id>/forecasts/`. The latest earlier artifact in that prefix supplies the incumbent. A Cloud Storage generation precondition prevents duplicate publication.

The job starts a fresh [Cloud Run sandbox (Preview)](https://docs.cloud.google.com/run/docs/configuring/jobs/sandboxes) for each fold. It uses a dedicated Python root filesystem at `/opt/python-rootfs`, not the parent filesystem. It passes input through stdin, keeps egress off, and validates bounded prediction output in the parent. The candidate doesn't receive the job's identity, credentials, or held-out actuals.

## Bootstrap from the repository root

Use a Google Cloud CLI version that supports `gcloud beta run jobs create --sandbox-launcher` (verified with 594.0.0) with the beta component installed. Enable the Cloud Run, Secret Manager, and Artifact Registry APIs. Create a private storage bucket and a Docker repository. Give the job service account `roles/storage.objectViewer` and `roles/storage.objectCreator` on the forecast bucket, plus `roles/secretmanager.secretAccessor` on only the model credential secret.

Set `PROJECT`, `REGION`, `IMAGE` (a tagged Artifact Registry image URL), `JOB_SA`, `BUCKET`, and `MODEL` (`provider/model`). The example uses an OpenAI key stored as `forecast-openai-api-key`; change the secret and environment variable to match your provider.

```sh
gcloud auth configure-docker "$REGION-docker.pkg.dev"
bash infra/build-cloud-image.sh "$IMAGE"
docker push "$IMAGE"

gcloud beta run jobs create forecast-weekly \
  --project "$PROJECT" --region "$REGION" --image "$IMAGE" \
  --service-account "$JOB_SA" --sandbox-launcher \
  --set-env-vars "FORECAST_BUCKET=$BUCKET,FORECAST_MODEL=$MODEL" \
  --set-secrets OPENAI_API_KEY=forecast-openai-api-key:latest \
  --cpu 2 --memory 2Gi --tasks 1 --max-retries 0 --task-timeout 30m

gcloud run jobs execute forecast-weekly --project "$PROJECT" --region "$REGION" --wait
```

Verify that a real Cloud Run execution can launch the Python sandbox and publish one valid replay artifact. The image can be built locally, but the native launcher is only available inside Cloud Run.

## Schedule the snapshot replay campaign

After deploying an image that supports `--replay-next`, set that argument on the job. The campaign runs one historical week per execution, starting September 21, 2026. Each run takes the earliest unpublished week and uses the previous campaign winner as its incumbent. It writes to `snapshots/<snapshot-id>/campaign/forecasts/`, leaving one-off results untouched. Runs exit without calling the model after all eight weeks are published. Pause the schedule when the campaign is complete.

Enable the [Cloud Scheduler API](https://docs.cloud.google.com/run/docs/execute/jobs-on-schedule) and give a dedicated Scheduler service account (`SCHEDULER_SA`) `roles/run.invoker` on this job. This schedule triggers the job on Wednesdays at 2 p.m. New York time:

```sh
gcloud beta run jobs update forecast-weekly \
  --project "$PROJECT" --region "$REGION" --args=--replay-next --sandbox-launcher

gcloud scheduler jobs create http forecast-weekly \
  --project "$PROJECT" --location "$REGION" \
  --schedule "0 14 * * 3" --time-zone "America/New_York" \
  --uri "https://run.googleapis.com/v2/projects/$PROJECT/locations/$REGION/jobs/forecast-weekly:run" \
  --http-method POST --headers "Content-Type=application/json" --message-body '{}' \
  --oauth-service-account-email "$SCHEDULER_SA" --max-retry-attempts=0
```

For live forecasts instead, set the job's container argument to `--live` and test an execution before enabling the schedule. Live forecasts are written to `forecasts/`.

## Continuous deployment from GitHub

[GitHub Actions](../.github/workflows/ci-cd.yml) checks formatting and types, runs the Bun tests, and builds and smoke-tests the Linux AMD64 Cloud Run image on pull requests. A push to `main` that passes verification builds and smoke-tests the image before publishing it to Artifact Registry. The workflow updates `forecast-weekly` to the pushed image digest with the sandbox launcher enabled. It does not execute the job or change its runtime identity, secrets, bucket, or schedule.

After bootstrapping GCP, [set up Workload Identity Federation for GitHub Actions](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines#github-actions) with a separate deploy service account. Enable the IAM, Resource Manager, Security Token Service, and Service Account Credentials APIs for federation. No service account key or model API key is needed in GitHub.

1. Create a dedicated workload identity pool and GitHub OIDC provider (issuer `https://token.actions.githubusercontent.com`). Map `google.subject=assertion.sub` and `attribute.repository_id=assertion.repository_id`. Set this provider condition with the repository's numeric ID (for example, from `gh api repos/OWNER/REPO --jq .id`):

   ```cel
   assertion.repository_id == 'REPO_ID' &&
   assertion.ref == 'refs/heads/main' &&
   assertion.event_name == 'push' &&
   assertion.environment == 'production'
   ```

2. Grant `roles/iam.workloadIdentityUser` on the deploy service account to `principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/attribute.repository_id/REPO_ID`. Use the pool project's **number**, not its ID.
3. Grant the deploy identity `roles/artifactregistry.writer` on the Docker repository, `roles/run.developer` on `forecast-weekly`, and `roles/iam.serviceAccountUser` on the job's runtime service account. Keep the runtime and Scheduler permissions separate.
4. Create a GitHub Actions environment named `production`, restrict deployment branches to `main`, and set these environment variables before merging the workflow:

   | Variable | Value |
   | --- | --- |
   | `GCP_PROJECT_ID` | Project ID containing the job and registry |
   | `GCP_REGION` | Region containing the job and Docker repository |
   | `GCP_ARTIFACT_REPOSITORY` | Artifact Registry Docker repository name |
   | `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/providers/PROVIDER_ID` |
   | `GCP_DEPLOY_SERVICE_ACCOUNT` | Deploy service account email |

Keep previous deployed digests available in Artifact Registry. To roll back without launching a forecast, take the previous digest reference from the successful deploy's GitHub Actions summary and run:

```sh
gcloud beta run jobs update forecast-weekly \
  --project "$PROJECT" --region "$REGION" --image "$PREVIOUS_DIGEST_REF" \
  --sandbox-launcher
```
