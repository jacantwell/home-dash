# make plan ENV=staging / make apply ENV=production. Runs against the personal AWS account.
ENV ?= staging
AWS := AWS_CONFIG_FILE=$(HOME)/.aws-personal/config AWS_SHARED_CREDENTIALS_FILE=$(HOME)/.aws-personal/credentials AWS_PROFILE=personal
TF := $(AWS) terraform -chdir=envs/$(ENV)

.PHONY: init plan apply output fmt validate

init:
	$(TF) init

plan: init
	$(TF) plan

apply: init
	$(TF) apply

output:
	$(TF) output

fmt:
	terraform fmt -recursive

validate:
	for d in bootstrap envs/staging envs/production; do terraform -chdir=$$d init -backend=false -input=false >/dev/null && terraform -chdir=$$d validate || exit 1; done
