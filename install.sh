#!/usr/bin/env bash
# ScaleSync — One-command setup for macOS / Linux
# Usage: bash install.sh

set -e

echo ""
echo "╔══════════════════════════════════════╗"
echo "║     ScaleSync v1.2 — Setup           ║"
echo "╚══════════════════════════════════════╝"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "❌ Node.js not found. Install from https://nodejs.org (v18+ required)"
  exit 1
fi

NODE_VER=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_VER" -lt 18 ]; then
  echo "❌ Node.js v18+ required (found v$NODE_VER)"
  exit 1
fi
echo "✓ Node.js $(node --version)"

# Check npm
if ! command -v npm &> /dev/null; then
  echo "❌ npm not found"
  exit 1
fi
echo "✓ npm $(npm --version)"

echo ""
echo "Installing dependencies..."
npm install

echo ""
echo "✓ Dependencies installed"
echo ""
echo "╔══════════════════════════════════════╗"
echo "║  Setup complete! Run:                ║"
echo "║                                      ║"
echo "║  npm run dev       ← development     ║"
echo "║  npm run build:mac ← macOS .dmg      ║"
echo "║  npm run build:win ← Windows .exe    ║"
echo "╚══════════════════════════════════════╝"
echo ""
