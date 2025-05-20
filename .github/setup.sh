#!/bin/bash

set -e  # Exit on error

echo "🧠 Aktiviram Python venv..."
if [ ! -d "venv" ]; then
  python3 -m venv venv
fi
source venv/bin/activate

echo "📦 Instaliram Python zavisnosti..."
pip install -U pip
pip install -e apps/frappe
pip install -e apps/helpdesk
pip install -e apps/erpnext  # ako koristiš i ERPNext
# Dodaj ovde i ostale aplikacije

echo "🔧 Instaliram frontend zavisnosti (yarn)..."
cd apps/helpdesk/desk
corepack enable
corepack prepare yarn@4.9.1 --activate
yarn install || echo "⚠️ Yarn install failed"
yarn build || echo "⚠️ Yarn build failed, koristi yarn dev za razvoj"

cd ../../../..

echo "🛠️ Frappe setup..."
bench build
bench migrate
bench clear-cache

echo "✅ Okruženje je spremno. Pokreni bench sa:"
echo "    bench start"
