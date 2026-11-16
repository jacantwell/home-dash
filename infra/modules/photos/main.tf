terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

data "aws_caller_identity" "current" {}

locals {
  name = "home-dash-photos-${var.env}"
  # AWS managed "CachingOptimized": query strings (the URL signature) stay out of the cache key
  caching_optimized = "658327ea-f89d-4fab-a63d-7e88639e58f6"
}

# --- bucket: private, only CloudFront reads, only the backend's presigned POSTs write ---

resource "aws_s3_bucket" "photos" {
  bucket = "${local.name}-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "photos" {
  bucket                  = aws_s3_bucket.photos.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "photos" {
  bucket = aws_s3_bucket.photos.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "photos" {
  bucket = aws_s3_bucket.photos.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "photos" {
  bucket = aws_s3_bucket.photos.id
  cors_rule {
    allowed_methods = ["POST"]
    allowed_origins = var.upload_origins
    allowed_headers = ["*"]
    max_age_seconds = 3600
  }
}

resource "aws_s3_bucket_policy" "photos" {
  bucket = aws_s3_bucket.photos.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "CloudFrontRead"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.photos.arn}/*"
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.photos.arn } }
    }]
  })
  depends_on = [aws_s3_bucket_public_access_block.photos]
}

# --- CDN: every request needs a URL signed by the backend ---

resource "aws_cloudfront_origin_access_control" "photos" {
  name                              = local.name
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_public_key" "signer" {
  # name changes with the key so a rotation can create-before-destroy
  name        = "${local.name}-${substr(sha256(var.cloudfront_public_key_pem), 0, 8)}"
  encoded_key = var.cloudfront_public_key_pem

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_cloudfront_key_group" "signer" {
  name  = local.name
  items = [aws_cloudfront_public_key.signer.id]
}

resource "aws_cloudfront_distribution" "photos" {
  enabled         = true
  comment         = local.name
  price_class     = "PriceClass_100"
  http_version    = "http2and3"
  is_ipv6_enabled = true

  origin {
    origin_id                = "s3"
    domain_name              = aws_s3_bucket.photos.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.photos.id
  }

  default_cache_behavior {
    target_origin_id       = "s3"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = local.caching_optimized
    compress               = true
    trusted_key_groups     = [aws_cloudfront_key_group.signer.id]
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

# --- the backend's identity: presign uploads, check them, delete them ---

resource "aws_iam_user" "backend" {
  name = "${local.name}-backend"
}

resource "aws_iam_user_policy" "backend" {
  name = "photos-bucket"
  user = aws_iam_user.backend.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Objects"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.photos.arn}/albums/*"
      },
      {
        # lets HeadObject say 404 instead of 403, and album deletes find their objects
        Sid       = "List"
        Effect    = "Allow"
        Action    = "s3:ListBucket"
        Resource  = aws_s3_bucket.photos.arn
        Condition = { StringLike = { "s3:prefix" = ["albums/*"] } }
      },
    ]
  })
}
