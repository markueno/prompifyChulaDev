#!/bin/bash

# Setup daily database sync cron job
# This script should be run on your server to set up automatic daily sync

echo "🕐 Setting up daily database sync cron job..."

# Create logs directory
mkdir -p /var/log/prompify
touch /var/log/prompify/sync.log

# Make sync script executable
chmod +x /opt/prompify/scripts/daily-sync.js

# Add cron job to run daily at 2 AM
(crontab -l 2>/dev/null; echo "0 2 * * * cd /opt/prompify && node scripts/daily-sync.js >> /var/log/prompify/sync.log 2>&1") | crontab -

echo "✅ Cron job added successfully!"
echo "📅 Sync will run daily at 2:00 AM"
echo "📝 Logs will be written to /var/log/prompify/sync.log"

# Test the sync script
echo "🧪 Testing sync script..."
cd /opt/prompify && node scripts/daily-sync.js

echo "🎉 Setup complete!"

