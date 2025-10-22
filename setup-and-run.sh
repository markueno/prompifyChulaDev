#!/bin/bash

echo "Setting up Prompify development environment..."

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "Creating .env file from template..."
    cp env.local.example .env
    echo "✅ .env file created. Please edit it with your API keys if needed."
else
    echo "✅ .env file already exists."
fi

# Generate SSL certificates
echo "Generating SSL certificates..."
chmod +x generate-ssl.sh
./generate-ssl.sh

# Make sure the ssl directory has the right permissions
chmod 644 ssl/cert.pem ssl/key.pem

echo "✅ SSL certificates generated."

# Run the application
echo "Starting Docker Compose with HTTPS development profile..."
docker-compose -f docker-compose.dev-https.yaml --profile development-https up --build --force-recreate

