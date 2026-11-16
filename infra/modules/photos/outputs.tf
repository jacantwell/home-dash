# Everything the backend needs, named after the env vars it reads.
output "PHOTOS_BUCKET" {
  value = aws_s3_bucket.photos.bucket
}

output "PHOTOS_REGION" {
  value = aws_s3_bucket.photos.region
}

output "PHOTOS_CDN_URL" {
  value = "https://${aws_cloudfront_distribution.photos.domain_name}"
}

output "PHOTOS_CDN_KEY_PAIR_ID" {
  value = aws_cloudfront_public_key.signer.id
}

output "backend_iam_user" {
  value = aws_iam_user.backend.name
}
