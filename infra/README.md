# infra

Terraform for the gallery's photo storage, on the **personal** AWS account (992382417038,
eu-west-2). The Makefile points at `~/.aws-personal`, so plain `aws` creds are never used.

```
bootstrap/          state bucket + GitHub OIDC roles for CI; the only root applied by hand
modules/photos/     S3 bucket + CloudFront (signed URLs) + the backend's IAM user
envs/staging/       Vercel Preview scope: staging.worm.beer, PR previews, localhost
envs/production/    Vercel Production scope: worm.beer
```

## Deploying

CI applies everything under `envs/`, the same way `migrate.yml` handles the database
(`.github/workflows/infra.yml`):

| When                              | What                                                   |
| --------------------------------- | ------------------------------------------------------ |
| PR touching `infra/`              | fmt + validate, then a plan per env in the job summary |
| Merge to `main` touching `infra/` | apply staging (environment `infra-staging`)            |
| **Promote to production**         | apply production (environment `infra-production`)      |
| Actions ▸ Infra ▸ Run workflow    | re-apply either env by hand                            |

CI signs in with GitHub OIDC, no stored keys. PRs get `home-dash-infra-plan` (read-only,
no photo objects); the apply jobs get `home-dash-infra-apply`, which only trusts the two
`infra-*` environments, both limited to `main`. The roles trust this repo's immutable OIDC
subject (`repo:jacantwell@108410800/home-dash@1357369244:…`), so a recreated repo with the
same name can't assume them.

Locally, for debugging only:

```bash
cd infra
make plan ENV=staging      # or production, never locks or applies
make output ENV=staging    # the PHOTOS_* values for Vercel
make validate
```

### Bootstrap

`bootstrap/` holds the state bucket and the roles CI runs as, so CI can't apply it. Change
it by hand with personal creds: `make bootstrap` (shows the plan, asks before applying).

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
```

Merge it (and promote, for production): the apply swaps in the new key group. Then set `PHOTOS_CDN_KEY_PAIR_ID` (from `make output`) and `PHOTOS_CDN_PRIVATE_KEY` on Vercel
and redeploy. URLs signed with the old key stop working once the apply finishes.
