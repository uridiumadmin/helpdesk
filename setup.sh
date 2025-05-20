#!/bin/bash

set -e

echo "🎯 Aktiviram virtualno okruženje..."
if [ ! -d "venv" ]; then
  python3 -m venv venv
fi
source venv/bin/activate

echo "📦 Instaliram pip, node, yarn i corepack..."
python3 -m pip install --upgrade pip
corepack enable
corepack prepare yarn@4.9.1 --activate

echo "📥 Instaliram Frappe, ERPNext i tvoju aplikaciju..."
bash install_frappe_apps.sh

echo "🔧 Instaliram frontend zavisnosti tvoje aplikacije..."
cd apps/helpdesk/desk
yarn install || echo "⚠️ Yarn install failed"
yarn build || echo "⚠️ Yarn build failed"
cd ../../../

echo "🛠️ Pokrećem bench komande (build, migrate)..."
bench build
bench migrate
bench clear-cache

echo "✅ Setup završen. Pokreni razvojni server sa:"
echo "   bench start"
