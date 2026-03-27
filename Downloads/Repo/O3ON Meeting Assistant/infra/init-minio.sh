#!/bin/sh
set -e

echo "Waiting for MinIO to be ready..."
until mc alias set local http://minio:9000 "${MINIO_ROOT_USER:-minioadmin}" "${MINIO_ROOT_PASSWORD:-minioadmin}" 2>/dev/null; do
  sleep 1
done

echo "Creating bucket..."
mc mb local/"${S3_BUCKET:-o3on-meeting-assistant}" --ignore-existing

echo "MinIO initialization complete."
