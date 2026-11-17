terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
  backend "s3" {
    bucket       = "home-dash-tfstate-992382417038"
    key          = "staging/terraform.tfstate"
    region       = "eu-west-2"
    use_lockfile = true
  }
}

provider "aws" {
  region = "eu-west-2"
  default_tags {
    tags = { project = "home-dash", env = "staging", managed-by = "terraform" }
  }
}

module "photos" {
  source                    = "../../modules/photos"
  env                       = "staging"
  cloudfront_public_key_pem = file("${path.module}/cloudfront-public-key.pub")
  upload_origins = [
    "https://staging.worm.beer",
    "http://localhost:3000",
    # PR previews: home-dash-git-<branch>-… and home-dash-<hash>-…
    "https://home-dash-*-jasper-cantwells-projects.vercel.app",
  ]
}

# made by hand to test the CORS fix before this landed
import {
  to = module.photos.aws_cloudfront_response_headers_policy.cors
  id = "619eac0a-1a81-4d78-a243-a42f8accc8f6"
}

output "backend_env" {
  description = "Non-secret env vars for the backend's Vercel scope"
  value = {
    PHOTOS_BUCKET          = module.photos.PHOTOS_BUCKET
    PHOTOS_REGION          = module.photos.PHOTOS_REGION
    PHOTOS_CDN_URL         = module.photos.PHOTOS_CDN_URL
    PHOTOS_CDN_KEY_PAIR_ID = module.photos.PHOTOS_CDN_KEY_PAIR_ID
  }
}

output "backend_iam_user" {
  value = module.photos.backend_iam_user
}
