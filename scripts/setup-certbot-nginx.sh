#!/bin/bash
# Setup script to generate nginx config with domain name
# This script creates an nginx config file with the correct domain paths

set -e

DOMAIN_NAME="${DOMAIN_NAME:-prompify.com}"

if [ "$DOMAIN_NAME" = "YOUR_DOMAIN" ] || [ -z "$DOMAIN_NAME" ]; then
    echo "ERROR: DOMAIN_NAME environment variable must be set!"
    echo "Usage: DOMAIN_NAME=yourdomain.com ./scripts/setup-certbot-nginx.sh"
    exit 1
fi

echo "Setting up nginx configuration for domain: ${DOMAIN_NAME}"

# Check if nginx-ecs.conf exists
if [ ! -f "nginx-ecs.conf" ]; then
    echo "ERROR: nginx-ecs.conf not found!"
    exit 1
fi

# Create backup
cp nginx-ecs.conf nginx-ecs.conf.backup

# Replace domain placeholder
sed -i.tmp "s|YOUR_DOMAIN|${DOMAIN_NAME}|g" nginx-ecs.conf

# Remove temporary file (sed creates it on some systems)
rm -f nginx-ecs.conf.tmp

echo "Nginx configuration updated successfully!"
echo "Backup saved as: nginx-ecs.conf.backup"
echo "You can now start the services with: docker-compose -f docker-compose.prod.yaml --profile production up -d"

