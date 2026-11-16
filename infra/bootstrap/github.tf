# GitHub Actions -> AWS without stored keys. PRs plan with a read-only role; only jobs
# in the infra-staging / infra-production environments (branch policy: main) can apply.

locals {
  # this repo issues immutable subjects (owner@id/repo@id), so a renamed or recreated
  # repo with the same name can't assume these roles
  github_sub = "repo:jacantwell@108410800/home-dash@1357369244"
  account_id = data.aws_caller_identity.current.account_id
  photos_bkt = "arn:aws:s3:::home-dash-photos-*"
  photos_iam = "arn:aws:iam::${local.account_id}:user/home-dash-photos-*"
}

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

data "aws_iam_policy_document" "trust_plan" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["${local.github_sub}:pull_request"]
    }
  }
}

data "aws_iam_policy_document" "trust_apply" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "${local.github_sub}:environment:infra-staging",
        "${local.github_sub}:environment:infra-production",
      ]
    }
  }
}

# --- plan: read state and the resources, change nothing ---

data "aws_iam_policy_document" "plan" {
  statement {
    sid       = "StateRead"
    actions   = ["s3:GetObject", "s3:ListBucket"]
    resources = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
  }
  statement {
    # bucket ARN only: every bucket-level read, none of the photos in it
    sid       = "PhotoBucketsRead"
    actions   = ["s3:Get*", "s3:ListBucket"]
    resources = [local.photos_bkt]
  }
  statement {
    sid       = "CloudFrontRead"
    actions   = ["cloudfront:Get*", "cloudfront:List*"]
    resources = ["*"]
  }
  statement {
    sid       = "BackendUserRead"
    actions   = ["iam:GetUser", "iam:GetUserPolicy", "iam:ListUserPolicies", "iam:ListUserTags", "iam:ListAttachedUserPolicies"]
    resources = [local.photos_iam]
  }
}

resource "aws_iam_role" "plan" {
  name               = "home-dash-infra-plan"
  assume_role_policy = data.aws_iam_policy_document.trust_plan.json
}

resource "aws_iam_role_policy" "plan" {
  name   = "plan"
  role   = aws_iam_role.plan.id
  policy = data.aws_iam_policy_document.plan.json
}

# --- apply: manage what modules/photos declares, nothing else ---

data "aws_iam_policy_document" "apply" {
  statement {
    sid       = "State"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
    resources = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/staging/*", "${aws_s3_bucket.state.arn}/production/*"]
  }
  statement {
    # bucket ARN only: config, not objects
    sid       = "PhotoBuckets"
    actions   = ["s3:*"]
    resources = [local.photos_bkt]
  }
  statement {
    # OACs, public keys and key groups have no names to scope by
    sid       = "CloudFront"
    actions   = ["cloudfront:*"]
    resources = ["*"]
  }
  statement {
    # no CreateAccessKey or AttachUserPolicy: CI can shape the backend user, never use it
    sid = "BackendUser"
    actions = [
      "iam:CreateUser", "iam:DeleteUser", "iam:GetUser", "iam:UpdateUser",
      "iam:TagUser", "iam:UntagUser", "iam:ListUserTags",
      "iam:PutUserPolicy", "iam:GetUserPolicy", "iam:DeleteUserPolicy", "iam:ListUserPolicies",
      "iam:ListAttachedUserPolicies", "iam:ListGroupsForUser", "iam:ListAccessKeys",
    ]
    resources = [local.photos_iam]
  }
}

resource "aws_iam_role" "apply" {
  name               = "home-dash-infra-apply"
  assume_role_policy = data.aws_iam_policy_document.trust_apply.json
}

resource "aws_iam_role_policy" "apply" {
  name   = "apply"
  role   = aws_iam_role.apply.id
  policy = data.aws_iam_policy_document.apply.json
}

output "plan_role_arn" {
  value = aws_iam_role.plan.arn
}

output "apply_role_arn" {
  value = aws_iam_role.apply.arn
}
