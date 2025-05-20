#!/bin/bash

set -e

echo "🔧 [1/7] Postavljam virtualno okruženje..."
if [ ! -d "venv" ]; then
  python3 -m venv venv
fi
source venv/bin/activate

echo "📦 [2/7] Instaliram pip i bench CLI..."
python3 -m pip install --upgrade pip
pip install frappe-bench

echo "🧰 [3/7] Kloniram Frappe i ERPNext ako nisu prisutni..."
mkdir -p apps

if [ ! -d "apps/frappe" ]; then
  git clone --branch version-15 https://github.com/frappe/frappe.git apps/frappe
fi

if [ ! -d "apps/erpnext" ]; then
  git clone --branch version-15 https://github.com/frappe/erpnext.git apps/erpnext
fi

echo "📦 [4/7] Instaliram aplikacije kao pip module..."
pip install -e apps/frappe
pip install -e apps/erpnext
pip install -e ./apps/helpdesk

echo "💻 [5/7] Instaliram Node.js, Yarn i frontend zavisnosti..."
corepack enable
corepack prepare yarn@4.9.1 --activate

cd apps/helpdesk/desk

echo "📥 → yarn install"
yarn install || echo "⚠️  yarn install nije uspeo"

echo "🛠️ → yarn build"
yarn build || echo "⚠️  yarn build nije uspeo"

cd ../../../

echo "🔨 [6/7] Pokrećem backend build i migracije..."
bench build
bench migrate
bench clear-cache

echo "🚀 [7/7] Setup završen!"
echo ""
echo "✅ Pokreni razvojni server komandama:"
echo "   source venv/bin/activate"
echo "   bench start"
