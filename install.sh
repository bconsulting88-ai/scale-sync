#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ScaleSync v1.2 — One-command installer (macOS / Linux)
#
# Works two ways:
#   1. curl | bash  (downloads + installs from scratch):
#        curl -fsSL https://raw.githubusercontent.com/bconsulting88-ai/scale-sync/main/install.sh | bash
#
#   2. Local run from inside a cloned repo:
#        bash install.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

log()   { echo -e "${CYAN}▶${RESET} $1"; }
ok()    { echo -e "${GREEN}✓${RESET} $1"; }
warn()  { echo -e "${YELLOW}⚠${RESET} $1"; }
error() { echo -e "${RED}✗${RESET} $1" >&2; exit 1; }

# ── Banner ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${CYAN}"
echo "  ╔══════════════════════════════════════════╗"
echo "  ║   ScaleSync v1.2 — Install               ║"
echo "  ║   Cannabis Inventory Automation           ║"
echo "  ╚══════════════════════════════════════════╝"
echo -e "${RESET}"

# ── Prerequisites ─────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  error "Node.js not found. Install v18+ from https://nodejs.org"
fi
NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ]; then
  error "Node.js v18+ required. Found: $(node --version)"
fi
ok "Node.js $(node --version)"

if ! command -v npm &>/dev/null; then
  error "npm not found"
fi
ok "npm $(npm --version)"

if ! command -v git &>/dev/null; then
  error "git not found. Install from https://git-scm.com"
fi
ok "git $(git --version | awk '{print $3}')"

# ── Detect if running via curl pipe (not inside a repo) ───────────────────────
REPO_URL="https://github.com/bconsulting88-ai/scale-sync.git"
INSTALL_DIR="$HOME/ScaleSync"

# If package.json doesn't exist in cwd, assume we're being piped via curl
if [ ! -f "package.json" ]; then
  log "Cloning ScaleSync into $INSTALL_DIR ..."
  if [ -d "$INSTALL_DIR/.git" ]; then
    log "Directory already exists — pulling latest..."
    git -C "$INSTALL_DIR" pull --ff-only
  else
    git clone "$REPO_URL" "$INSTALL_DIR"
  fi
  cd "$INSTALL_DIR"
  ok "Repository ready at $INSTALL_DIR"
else
  INSTALL_DIR="$(pwd)"
  ok "Using existing repo at $INSTALL_DIR"
fi

# ── Install dependencies ───────────────────────────────────────────────────────
echo ""
log "Installing dependencies (this rebuilds native modules for Electron)..."
npm install
ok "Dependencies installed"

# Verify native modules
node -e "require('better-sqlite3')" 2>/dev/null \
  && ok "better-sqlite3 native module OK" \
  || { warn "Rebuilding better-sqlite3..."; npx electron-rebuild -f -w better-sqlite3; }

node -e "require('serialport')" 2>/dev/null \
  && ok "serialport native module OK" \
  || { warn "Rebuilding serialport..."; npx electron-rebuild -f -w serialport; }

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}"
echo "  ╔══════════════════════════════════════════╗"
echo "  ║   ✓  ScaleSync is ready!                 ║"
echo "  ╚══════════════════════════════════════════╝"
echo -e "${RESET}"
echo "  Directory:  $INSTALL_DIR"
echo ""
echo "  Development mode:"
echo "    cd $INSTALL_DIR && npm run dev"
echo ""
echo "  Build installer:"
echo "    npm run build:mac    ← macOS .dmg"
echo "    npm run build:win    ← Windows .exe"
echo "    npm run build:linux  ← Linux .AppImage"
echo ""
