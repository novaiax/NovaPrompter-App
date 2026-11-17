#!/bin/bash
# Setup automatique Railway pour NovaPrompter API
# Nécessite Railway CLI : npm i -g @railway/cli puis railway login

set -e

if ! command -v railway &> /dev/null; then
  echo "Railway CLI pas installée. Installation..."
  npm install -g @railway/cli
fi

echo
echo "=== Setup variables Railway ==="
echo "Si pas déjà fait :"
echo "  railway login"
echo "  railway link  # choisir le projet/service"
echo

railway variables \
  --set "NODE_ENV=production"

echo
echo "=== Variables set. Reste à faire dans le dashboard : ==="
echo "1. Settings > Variables – configurez DATABASE_URL et JWT_SECRET
echo "2. Settings > Build > Root Directory : backend (si pas déjà bon)"
echo "3. Settings > Networking > Generate Domain"
