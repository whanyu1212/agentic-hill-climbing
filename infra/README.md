# GCP deployment

[Cloud Scheduler triggers a Cloud Run Job](https://docs.cloud.google.com/run/docs/execute/jobs-on-schedule). The job runs the OpenCode SDK and evaluator; Cloud Storage keeps the immutable forecast artifacts. The latest earlier artifact supplies the incumbent. A Cloud Storage generation precondition prevents duplicate publication.

The job starts a fresh [Cloud Run sandbox (Preview)](https://docs.cloud.google.com/run/docs/configuring/jobs/sandboxes) for each fold. It uses a dedicated Python root filesystem at `/opt/python-rootfs`, not the parent filesystem. It passes input through stdin, keeps egress off, and validates bounded prediction output in the parent. The candidate doesn't receive the job's identity, credentials, or held-out actuals.

## Deploy from the repository root

Use a recent Google Cloud CLI with the beta commands installed. Enable the Cloud Run, Cloud Scheduler, Secret Manager, and Artifact Registry APIs. Create a private storage bucket and a Docker repository. Give the job service account `roles/storage.objectViewer` and `roles/storage.objectCreator` on the forecast bucket, plus `roles/secretmanager.secretAccessor` on only the model credential secret. Give a separate Scheduler service account `roles/run.invoker` on this job.

Set `PROJECT`, `REGION`, `IMAGE` (a tagged Artifact Registry image URL), `JOB_SA`, `SCHEDULER_SA`, `BUCKET`, and `MODEL` (`provider/model`). The example uses an OpenAI key stored as `forecast-openai-api-key`; change the secret and environment variable to match your provider.

```sh
docker build --platform linux/amd64 -f sandbox/Dockerfile --target cloud -t "$IMAGE" .
docker push "$IMAGE"

gcloud beta run jobs create forecast-weekly \
  --project "$PROJECT" --region "$REGION" --image "$IMAGE" \
  --service-account "$JOB_SA" --sandbox-launcher \
  --set-env-vars "FORECAST_BUCKET=$BUCKET,FORECAST_MODEL=$MODEL" \
  --set-secrets OPENAI_API_KEY=forecast-openai-api-key:latest \
  --cpu 2 --memory 2Gi --tasks 1 --max-retries 0 --task-timeout 30m

gcloud run jobs execute forecast-weekly --project "$PROJECT" --region "$REGION" --wait
```

Before scheduling, verify that a real Cloud Run execution can launch the Python sandbox and publish one valid artifact. The image can be built locally, but the native launcher is only available inside Cloud Run.

```sh
gcloud scheduler jobs create http forecast-weekly \
  --project "$PROJECT" --location "$REGION" \
  --schedule "0 14 * * 3" --time-zone "America/New_York" \
  --uri "https://run.googleapis.com/v2/projects/$PROJECT/locations/$REGION/jobs/forecast-weekly:run" \
  --http-method POST --headers "Content-Type=application/json" --message-body '{}' \
  --oauth-service-account-email "$SCHEDULER_SA"
```
