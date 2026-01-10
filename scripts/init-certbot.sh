#!/bin/bash
# Certbot initialization script for Prompify
# This script initializes Let's Encrypt certificates using certbot

set -e

# Configuration
DOMAIN_NAME="${DOMAIN_NAME:-prompify.com}"
EMAIL="${CERTBOT_EMAIL:-admin@${DOMAIN_NAME}}"
STAGING="${CERTBOT_STAGING:-0}"  # Set to 1 for testing

echo "Initializing Certbot for domain: ${DOMAIN_NAME}"
echo "Email: ${EMAIL}"

# Check if domain is set
if [ "$DOMAIN_NAME" = "YOUR_DOMAIN" ] || [ -z "$DOMAIN_NAME" ]; then
    echo "ERROR: DOMAIN_NAME environment variable must be set!"
    echo "Usage: DOMAIN_NAME=yourdomain.com ./scripts/init-certbot.sh"
    exit 1
fi

# Build staging flag
STAGING_FLAG=""
if [ "$STAGING" = "1" ]; then
    STAGING_FLAG="--staging"
    echo "Using Let's Encrypt staging environment (for testing)"
fi

# Run certbot to obtain certificates
echo "Requesting SSL certificate from Let's Encrypt..."
docker-compose -f docker-compose.prod.yaml exec certbot certbot certonly \
    --webroot \
    --webroot-path=/var/www/certbot \
    --email "${EMAIL}" \
    --agree-tos \
    --no-eff-email \
    --force-renewal \
    ${STAGING_FLAG} \
    -d "${DOMAIN_NAME}" \
    -d "www.${DOMAIN_NAME}" || {
    echo "Failed to obtain certificate. Trying standalone mode..."
    # Stop nginx temporarily for standalone mode
    docker-compose -f docker-compose.prod.yaml stop nginx
    docker-compose -f docker-compose.prod.yaml exec certbot certbot certonly \
        --standalone \
        --email "${EMAIL}" \
        --agree-tos \
        --no-eff-email \
        --force-renewal \
        ${STAGING_FLAG} \
        -d "${DOMAIN_NAME}" \
        -d "www.${DOMAIN_NAME}"
    docker-compose -f docker-compose.prod.yaml start nginx
}

# Update nginx configuration with the domain name
echo "Updating nginx configuration..."
sed -i.bak "s|YOUR_DOMAIN|${DOMAIN_NAME}|g" nginx-ecs.conf

# Reload nginx to use new certificates
echo "Reloading nginx..."
docker-compose -f docker-compose.prod.yaml exec nginx nginx -s reload || \
    docker-compose -f docker-compose.prod.yaml restart nginx

echo "Certbot initialization complete!"
echo "Certificates are stored in: /etc/letsencrypt/live/${DOMAIN_NAME}/"
echo "Auto-renewal is configured and will run every 12 hours."

