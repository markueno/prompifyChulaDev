#!/bin/bash
# Certbot renewal script for Prompify
# This script manually triggers certificate renewal and reloads nginx

set -e

echo "Checking for certificate renewal..."

# Run certbot renew
docker-compose -f docker-compose.prod.yaml exec certbot certbot renew

# Reload nginx to use renewed certificates
echo "Reloading nginx with renewed certificates..."
docker-compose -f docker-compose.prod.yaml exec nginx nginx -s reload || \
    docker-compose -f docker-compose.prod.yaml restart nginx

echo "Certificate renewal check complete!"

