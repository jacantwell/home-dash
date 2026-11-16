variable "env" {
  description = "staging or production"
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.env)
    error_message = "env must be staging or production"
  }
}

variable "upload_origins" {
  description = "Browser origins allowed to POST uploads straight to the bucket (one * wildcard each)"
  type        = list(string)
}

variable "cloudfront_public_key_pem" {
  description = "Public half of the key the backend signs CloudFront URLs with"
  type        = string
}
