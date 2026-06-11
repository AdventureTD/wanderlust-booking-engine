#!/bin/bash
set -e

# WBE_SHARED_SECRET must be set in Render Dashboard → Environment.
if [ -z "$WBE_SHARED_SECRET" ]; then
  echo "ERROR: WBE_SHARED_SECRET is not set."
  echo "Go to Render Dashboard → Environment → add WBE_SHARED_SECRET"
  exit 1
fi

# Optional: seed the Gmail OAuth token from a base64 env var.
# To create GMAIL_TOKEN_B64 on your local machine:
#   base64 ~/.hermes/gmail_token.json | tr -d '\n'
# Then paste the result into Render Dashboard → GMAIL_TOKEN_B64
if [ -n "$GMAIL_TOKEN_B64" ]; then
  mkdir -p /tmp/gmail
  echo "$GMAIL_TOKEN_B64" | base64 -d > /tmp/gmail/gmail_token.json
  export GMAIL_TOKEN_PATH=/tmp/gmail/gmail_token.json
  echo "Gmail token loaded from env."
fi

# PORT is injected by Render automatically.
# Use 2 workers (free tier has limited RAM).
exec gunicorn \
  -k uvicorn.workers.UvicornWorker \
  -w 2 \
  --bind "0.0.0.0:$PORT" \
  --timeout 60 \
  --access-logfile - \
  --error-logfile - \
  invoice_service:app
