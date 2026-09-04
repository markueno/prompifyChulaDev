#!/usr/bin/env bash
#
# Prove a Resend API key and sending domain work, before wiring them into the app.
#
# The app fails soft on email — a refused send is logged and the request carries on — so a bad key
# or an unverified domain is invisible until someone reports never getting a verification link.
# This makes that failure loud and immediate.
#
# Usage:
#   RESEND_API_KEY=re_... FROM_EMAIL=noreply@prompify.com ./scripts/test-resend.sh you@example.com
#
set -euo pipefail

TO="${1:-}"
: "${RESEND_API_KEY:?Set RESEND_API_KEY (re_...) in the environment}"
FROM="${FROM_EMAIL:-noreply@prompify.com}"

if [ -z "$TO" ]; then
  echo "usage: RESEND_API_KEY=re_... $0 <recipient@example.com>" >&2
  exit 1
fi

echo "Sending test email"
echo "  from: $FROM"
echo "  to:   $TO"
echo

RESPONSE=$(curl -sS -w '\n%{http_code}' -X POST 'https://api.resend.com/emails' \
  -H "Authorization: Bearer ${RESEND_API_KEY}" \
  -H 'Content-Type: application/json' \
  -d "{
    \"from\": \"Prompify <${FROM}>\",
    \"to\": [\"${TO}\"],
    \"subject\": \"Prompify Resend test\",
    \"html\": \"<p>If you are reading this, Resend is configured correctly.</p>\",
    \"text\": \"If you are reading this, Resend is configured correctly.\"
  }")

STATUS=$(printf '%s' "$RESPONSE" | tail -n1)
BODY=$(printf '%s' "$RESPONSE" | sed '$d')

echo "HTTP $STATUS"
echo "$BODY"
echo

case "$STATUS" in
  200|201)
    echo "OK — check the inbox (and the spam folder; a brand-new domain often lands there first)."
    ;;
  401|403)
    echo "FAILED — key rejected, or '$FROM' is not on a domain verified in this Resend account." >&2
    echo "Resend dashboard -> Domains: the domain must read 'Verified', not 'Pending'." >&2
    exit 1
    ;;
  422)
    echo "FAILED — Resend rejected the payload; the 'from' address is the usual cause." >&2
    exit 1
    ;;
  *)
    echo "FAILED — unexpected status $STATUS." >&2
    exit 1
    ;;
esac
