#!/bin/bash
# Test SendGrid Connection Script (Linux/Mac)
# Usage: ./test-sendgrid.sh <API_KEY> <FROM_EMAIL> <TO_EMAIL>

if [ $# -ne 3 ]; then
    echo "Usage: $0 <API_KEY> <FROM_EMAIL> <TO_EMAIL>"
    echo "Example: $0 SG.xxx noreply@example.com test@example.com"
    exit 1
fi

API_KEY=$1
FROM_EMAIL=$2
TO_EMAIL=$3

echo "========================================"
echo "SendGrid Connection Test"
echo "========================================"
echo ""

# Validate API key format
if [[ ! $API_KEY =~ ^SG\. ]]; then
    echo "❌ Error: API key should start with 'SG.'"
    exit 1
fi

echo "✓ API Key format valid"
echo ""

# Test 1: Check API key validity
echo "Test 1: Validating API Key..."

RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "https://api.sendgrid.com/v3/user/profile" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -eq 200 ]; then
    echo "✓ API Key is valid!"
    USERNAME=$(echo "$BODY" | grep -o '"username":"[^"]*' | cut -d'"' -f4)
    EMAIL=$(echo "$BODY" | grep -o '"email":"[^"]*' | cut -d'"' -f4)
    echo "  User: $USERNAME"
    echo "  Email: $EMAIL"
    echo ""
else
    echo "❌ API Key validation failed!"
    echo "  HTTP Code: $HTTP_CODE"
    echo "  Response: $BODY"
    exit 1
fi

# Test 2: Send test email
echo "Test 2: Sending test email..."

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

EMAIL_JSON=$(cat <<EOF
{
  "personalizations": [
    {
      "to": [
        {
          "email": "$TO_EMAIL"
        }
      ]
    }
  ],
  "from": {
    "email": "$FROM_EMAIL"
  },
  "subject": "SendGrid Test Email - $TIMESTAMP",
  "content": [
    {
      "type": "text/plain",
      "value": "This is a test email from SendGrid API. If you received this, your SendGrid connection is working correctly!"
    },
    {
      "type": "text/html",
      "value": "<html><body><h2>SendGrid Test Email</h2><p>This is a test email from SendGrid API. If you received this, your SendGrid connection is working correctly!</p><p>Sent at: $TIMESTAMP</p></body></html>"
    }
  ]
}
EOF
)

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "https://api.sendgrid.com/v3/mail/send" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "$EMAIL_JSON")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -eq 202 ]; then
    echo "✓ Test email sent successfully!"
    echo "  Check inbox: $TO_EMAIL"
    echo ""
    echo "========================================"
    echo "All tests passed! ✓"
    echo "========================================"
else
    echo "❌ Failed to send test email!"
    echo "  HTTP Code: $HTTP_CODE"
    echo "  Response: $BODY"
    exit 1
fi
