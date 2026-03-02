#!/usr/bin/env bash
set -euo pipefail

HOST="${1:-www.2dolist.top}"

curl -fsS -m 5 -H "Host: ${HOST}" "http://127.0.0.1/health"
echo
