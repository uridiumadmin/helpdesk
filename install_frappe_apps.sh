#!/bin/bash

set -e

mkdir -p apps

# Frappe
if [ ! -d "apps/frappe" ]; then
  git clone --branch version-15 https://github.com/frappe/frappe.git apps/frappe
fi

# ERPNext
if [ ! -d "apps/erpnext" ]; then
  git clone --branch version-15 https://github.com/frappe/erpnext.git apps/erpnext
fi

echo "📦 Instaliram aplikacije kao pip module..."
pip install -e apps/frappe
pip install -e apps/erpnext
pip install -e ./apps/helpdesk
