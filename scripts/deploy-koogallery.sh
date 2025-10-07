#!/bin/bash

# KooGallery SaaS 2.0 Deployment Script
# This script deploys the Prompify AI app builder with KooGallery integration

set -e

echo "🚀 Starting KooGallery SaaS 2.0 deployment..."

# Check if required environment variables are set
if [ -z "$KOOGALLERY_ACCESS_KEY" ]; then
    echo "❌ Error: KOOGALLERY_ACCESS_KEY environment variable is required"
    echo "Please set your KooGallery access key from the Seller Console"
    exit 1
fi

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp env.local.example .env
    echo "⚠️  Please update .env file with your configuration before continuing"
    exit 1
fi

# Build Docker image
echo "🔨 Building Docker image..."
docker build -t bolt-ai:development -t bolt-ai:latest --target bolt-ai-development .

# Create SSL certificates if they don't exist
if [ ! -d "ssl" ]; then
    echo "🔐 Creating SSL certificates..."
    mkdir -p ssl
    openssl req -x509 -newkey rsa:4096 -keyout ssl/key.pem -out ssl/cert.pem -days 365 -nodes -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"
fi

# Start services with Docker Compose
echo "🐳 Starting services with Docker Compose..."
docker-compose -f docker-compose.dev-https.yaml --profile development-https up -d

# Wait for services to be ready
echo "⏳ Waiting for services to start..."
sleep 10

# Check if services are running
echo "🔍 Checking service status..."
docker-compose -f docker-compose.dev-https.yaml --profile development-https ps

# Test KooGallery endpoints
echo "🧪 Testing KooGallery endpoints..."
echo "Testing Create Instance endpoint..."
curl -k -X POST "https://localhost/api/koogallery/create-instance" \
  -H "Content-Type: application/json" \
  -d '{"activity":"newInstance","orderId":"test-order-123","orderLineId":"test-line-123","businessId":"test-business-123","testFlag":"1"}' \
  || echo "⚠️  Create Instance endpoint test failed (this is expected without proper signature)"

echo "Testing Query Instance endpoint..."
curl -k -X POST "https://localhost/api/koogallery/query-instance" \
  -H "Content-Type: application/json" \
  -d '{"activity":"queryInstance","instanceId":"test-instance-123"}' \
  || echo "⚠️  Query Instance endpoint test failed (this is expected without proper signature)"

echo "✅ KooGallery SaaS 2.0 deployment completed!"
echo ""
echo "📋 Next steps:"
echo "1. Configure your KooGallery access key in .env file"
echo "2. Update your KooGallery Seller Console with these endpoints:"
echo "   - Create Instance: https://your-domain.com/api/koogallery/create-instance"
echo "   - Query Instance: https://your-domain.com/api/koogallery/query-instance"
echo "3. Test the integration with KooGallery's test environment"
echo ""
echo "🌐 Your application is available at:"
echo "   - HTTP: http://localhost"
echo "   - HTTPS: https://localhost"
echo ""
echo "📊 Monitor logs with:"
echo "   docker-compose -f docker-compose.dev-https.yaml --profile development-https logs -f"

