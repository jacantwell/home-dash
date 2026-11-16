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
    key          = "production/terraform.tfstate"
    region       = "eu-west-2"
    use_lockfile = true
  }
}

provider "aws" {
  region = "eu-west-2"
  default_tags {
    tags = { project = "home-dash", env = "production", managed-by = "terraform" }
  }
}

module "photos" {
  source                    = "../../modules/photos"
  env                       = "production"
  cloudfront_public_key_pem = file("${path.module}/cloudfront-public-key.pub")
  upload_origins            = ["https://worm.beer"]
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
