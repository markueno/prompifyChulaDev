#!/bin/bash

# Huawei ECS Deployment Script
# This script helps you deploy Prompify to Huawei ECS

set -e

echo "🚀 Starting Prompify deployment to Huawei ECS..."

# Check if required files exist
if [ ! -f ".env.ecs" ]; then
    echo "❌ Error: .env.ecs file not found!"
    echo "📝 Please copy env.ecs.example to .env.ecs and configure it"
    exit 1
fi

if [ ! -f "ssl/cert.pem" ] || [ ! -f "ssl/key.pem" ]; then
    echo "🔐 Generating SSL certificates..."
    chmod +x generate-ssl.sh
    ./generate-ssl.sh
fi

# Build the application
echo "🔨 Building application..."
docker-compose -f docker-compose.ecs.yaml build

# Start the services
echo "🚀 Starting services..."
docker-compose -f docker-compose.ecs.yaml up -d

# Wait for services to be healthy
echo "⏳ Waiting for services to be ready..."
sleep 30

# Check if services are running
echo "🔍 Checking service health..."
docker-compose -f docker-compose.ecs.yaml ps

# Test the application
echo "🧪 Testing application..."
if curl -f http://localhost/api/health > /dev/null 2>&1; then
    echo "✅ Application is running successfully!"
    echo "🌐 Access your application at: https://localhost"
    echo "📊 Or check the logs with: docker-compose -f docker-compose.ecs.yaml logs -f"
else
    echo "❌ Application health check failed!"
    echo "📋 Check the logs with: docker-compose -f docker-compose.ecs.yaml logs"
    exit 1
fi

echo "🎉 Deployment completed successfully!"
echo ""
echo "📋 Useful commands:"
echo "  View logs: docker-compose -f docker-compose.ecs.yaml logs -f"
echo "  Stop services: docker-compose -f docker-compose.ecs.yaml down"
echo "  Restart services: docker-compose -f docker-compose.ecs.yaml restart"
echo "  Update application: docker-compose -f docker-compose.ecs.yaml up -d --build"

