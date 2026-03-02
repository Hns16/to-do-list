#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_FILE="$BASE_DIR/data.json"
BACKUP_DIR="$BASE_DIR/backups"

mkdir -p "$BACKUP_DIR"
TS="$(date +%Y%m%d.%H%M%S)"
TARGET="$BACKUP_DIR/data-$TS.manual.json"

cp -f "$DATA_FILE" "$TARGET"
echo "backup_created=$TARGET"
