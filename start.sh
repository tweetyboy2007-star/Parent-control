#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

if ! command -v node &>/dev/null; then
  echo "Node.js is required. Install from https://nodejs.org or: brew install node"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies…"
  npm install
fi

exec node server.js
