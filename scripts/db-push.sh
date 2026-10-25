#!/usr/bin/env bash
# db push با override صریح DATABASE_URL از .env (سندباکس متغیر پیش‌فرض دارد)
set -euo pipefail
cd "$(dirname "$0")/.."
DATABASE_URL=$(sed -n 's/^DATABASE_URL=//p' .env | tr -d '"') \
  bunx prisma db push "$@"
