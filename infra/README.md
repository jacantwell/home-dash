# infra

Terraform for the gallery's photo storage, on the **personal** AWS account (992382417038,
eu-west-2). The Makefile points at `~/.aws-personal`, so plain `aws` creds are never used.

```
bootstrap/          the state bucket (home-dash-tfstate-…), its own state kept inside it
modules/photos/     S3 bucket + CloudFront (signed URLs) + the backend's IAM user
envs/staging/       Vercel Preview scope: staging.worm.beer, PR previews, localhost
envs/production/    Vercel Production scope: worm.beer
```

```bash
cd infra
make plan ENV=staging      # or production
make apply ENV=staging
make output ENV=staging    # the PHOTOS_* values for Vercel
```

## How it fits together

- The bucket is private. Browsers upload straight to it with presigned POSTs the backend
  hands out (size and type capped), and its CORS rule lists the env's frontend origins.
- Reads go through CloudFront with Origin Access Control. Every URL must be signed with
  the private half of `envs/<env>/cloudfront-public-key.pub`, which only the backend holds
  (`PHOTOS_CDN_PRIVATE_KEY`).
- The backend runs as IAM user `home-dash-photos-<env>-backend`, limited to `albums/*` in
  its bucket. Its access key is created by hand, never by Terraform, so no secret lands in
  state.

## Vercel env vars

| Var                                                                          | From                                      |
| ---------------------------------------------------------------------------- | ----------------------------------------- |
| `PHOTOS_BUCKET`, `PHOTOS_REGION`, `PHOTOS_CDN_URL`, `PHOTOS_CDN_KEY_PAIR_ID` | `make output`                             |
| `PHOTOS_CDN_PRIVATE_KEY`                                                     | the signing key's PEM, base64 on one line |
| `PHOTOS_AWS_ACCESS_KEY_ID`, `PHOTOS_AWS_SECRET_ACCESS_KEY`                   | `aws iam create-access-key` for the user  |

## Rotating the signing key

```bash
openssl genrsa -out new.pem 2048
openssl rsa -in new.pem -pubout -out envs/<env>/cloudfront-public-key.pub
make apply ENV=<env>   # new public key + key group; the old one is replaced
```

Then set `PHOTOS_CDN_KEY_PAIR_ID` (from `make output`) and `PHOTOS_CDN_PRIVATE_KEY` on Vercel
and redeploy. URLs signed with the old key stop working once the apply finishes.
