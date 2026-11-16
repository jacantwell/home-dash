# CI plans and applies (.github/workflows/infra.yml). These are for bootstrap and debugging,
# against the personal AWS account: make plan ENV=staging, make bootstrap.
ENV ?= staging
AWS := AWS_CONFIG_FILE=$(HOME)/.aws-personal/config AWS_SHARED_CREDENTIALS_FILE=$(HOME)/.aws-personal/credentials AWS_PROFILE=personal
TF := $(AWS) terraform -chdir=envs/$(ENV)

.PHONY: init plan output fmt validate bootstrap

init:
	$(TF) init

plan: init
	$(TF) plan -lock=false

output:
	$(TF) output

fmt:
	terraform fmt -recursive

validate:
	for d in bootstrap envs/staging envs/production; do t=$$(mktemp -d); TF_DATA_DIR=$$t terraform -chdir=$$d init -backend=false -input=false >/dev/null && TF_DATA_DIR=$$t terraform -chdir=$$d validate || exit 1; done

# the one root CI can't apply: state bucket + the GitHub OIDC roles CI runs as
bootstrap:
	$(AWS) terraform -chdir=bootstrap init
	$(AWS) terraform -chdir=bootstrap apply
