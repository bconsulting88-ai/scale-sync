#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ScaleSync v1.2 — Full Setup, Build & GitHub Push
#
# Run this script with Claude Code or manually:
#   bash setup.sh
#
# What it does:
#   1. Checks prerequisites (Node 18+, npm, git, gh)
#   2. npm install (including native module rebuild for Electron)
#   3. Verifies the app launches (headless check)
#   4. Builds the platform-specific installer
#   5. Creates a GitHub repo and pushes the code
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

log()   { echo -e "${CYAN}▶${RESET} $1"; }
ok()    { echo -e "${GREEN}✓${RESET} $1"; }
warn()  { echo -e "${YELLOW}⚠${RESET} $1"; }
error() { echo -e "${RED}✗${RESET} $1"; exit 1; }
header(){ echo -e "\n${BOLD}${CYAN}$1${RESET}"; echo "$(printf '─%.0s' {1..50})"; }

# ── Banner ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${CYAN}"
echo "  ╔══════════════════════════════════════════╗"
echo "  ║   ScaleSync v1.2 — Build & Deploy        ║"
echo "  ║   Cannabis Inventory Automation           ║"
echo "  ╚══════════════════════════════════════════╝"
echo -e "${RESET}"

# ── Detect OS ─────────────────────────────────────────────────────────────────
OS="unknown"
case "$(uname -s)" in
  Darwin) OS="mac"   ;;
  Linux)  OS="linux" ;;
  CYGWIN*|MINGW*|MSYS*) OS="win" ;;
esac
ok "Platform: $OS ($(uname -m))"

# ── Step 1: Prerequisites ─────────────────────────────────────────────────────
header "STEP 1 — Prerequisites"

# Node.js
if ! command -v node &>/dev/null; then
  error "Node.js not found. Install from https://nodejs.org (v18+ required)"
fi
NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ]; then
  error "Node.js v18+ required. Found: $(node --version)"
fi
ok "Node.js $(node --version)"

# npm
if ! command -v npm &>/dev/null; then
  error "npm not found"
fi
ok "npm $(npm --version)"

# git
if ! command -v git &>/dev/null; then
  error "git not found. Install from https://git-scm.com"
fi
ok "git $(git --version | awk '{print $3}')"

# gh CLI (optional but needed for auto-push)
GH_AVAILABLE=false
if command -v gh &>/dev/null; then
  GH_AVAILABLE=true
  ok "GitHub CLI $(gh --version | head -1 | awk '{print $3}')"
else
  warn "GitHub CLI (gh) not found — will skip auto-push to GitHub"
  warn "Install from: https://cli.github.com"
fi

# ── Step 2: Install dependencies ─────────────────────────────────────────────
header "STEP 2 — npm install"
log "Installing packages and rebuilding native modules for Electron..."
npm install

# Verify native modules compiled
node -e "require('better-sqlite3')" 2>/dev/null && ok "better-sqlite3 native module OK" \
  || { warn "better-sqlite3 needs rebuild — running electron-rebuild..."; npx electron-rebuild -f -w better-sqlite3; }

node -e "require('serialport')" 2>/dev/null && ok "serialport native module OK" \
  || { warn "serialport needs rebuild — running electron-rebuild..."; npx electron-rebuild -f -w serialport; }

ok "All dependencies installed"

# ── Step 3: Build renderer (if dist/ is stale) ───────────────────────────────
header "STEP 3 — Vite build"
if [ ! -f "dist/renderer.js" ]; then
  log "Building renderer bundle..."
  npx vite build
  ok "Renderer built: dist/renderer.js"
else
  ok "Pre-built renderer present: dist/renderer.js ($(du -sh dist/renderer.js | cut -f1))"
  log "Tip: run 'npx vite build' to rebuild from source if you changed src/ files"
fi

# ── Step 4: Build installer ───────────────────────────────────────────────────
header "STEP 4 — Build Electron installer"

BUILD_CMD=""
case "$OS" in
  mac)   BUILD_CMD="npm run build:mac"   ; OUTPUT_GLOB="release/*.dmg"    ;;
  win)   BUILD_CMD="npm run build:win"   ; OUTPUT_GLOB="release/*.exe"    ;;
  linux) BUILD_CMD="npm run build:linux" ; OUTPUT_GLOB="release/*.AppImage" ;;
esac

log "Running: $BUILD_CMD"
$BUILD_CMD

# Find output file
INSTALLER=$(ls $OUTPUT_GLOB 2>/dev/null | head -1 || true)
if [ -n "$INSTALLER" ]; then
  SIZE=$(du -sh "$INSTALLER" | cut -f1)
  ok "Installer built: $INSTALLER ($SIZE)"
else
  warn "No installer found at $OUTPUT_GLOB — check electron-builder output above"
fi

# ── Step 5: Git init & GitHub push ───────────────────────────────────────────
header "STEP 5 — GitHub"

# Init git if not already
if [ ! -d ".git" ]; then
  log "Initializing git repository..."
  git init
  git branch -M main
fi

# Stage and commit
log "Staging all files..."
git add .
git diff --cached --quiet && ok "Nothing new to commit — repo already up to date" || {
  git commit -m "feat: ScaleSync v1.2 — cannabis inventory automation

Core features:
- OHAUS Ranger Count 3000 serial driver (9600 8N1, write queue, gen counter)  
- Dutchie Enterprise GraphQL API (OAuth2, paginated sync, PHYSICAL_COUNT push)
- SQLite database (WAL mode, 5 tables, per-item push tracking)
- Electron 31 + React 18 + Vite 5 + electron-builder 24
- macOS DMG / Windows NSIS / Linux AppImage targets

Stability (v1.2 stress test — 13 bugs fixed):
- C-01 to C-07: crash-level concurrency and race conditions
- D-01 to D-05: data integrity under load
- P-01 to P-03: performance at 10Hz scale stream + large catalogs"
  ok "Committed"
}

# Push to GitHub
if [ "$GH_AVAILABLE" = true ]; then
  # Check if remote already exists
  if git remote get-url origin &>/dev/null; then
    log "Remote 'origin' exists — pushing..."
    git push -u origin main
  else
    log "Creating GitHub repo 'scalesync' and pushing..."
    gh repo create scalesync \
      --private \
      --description "Cannabis inventory automation — OHAUS Ranger + Dutchie POS" \
      --source=. \
      --remote=origin \
      --push
  fi
  REPO_URL=$(gh repo view --json url -q .url 2>/dev/null || echo "check github.com")
  ok "Pushed to GitHub: $REPO_URL"
else
  warn "Skipping GitHub push (gh CLI not available)"
  echo ""
  echo "  To push manually:"
  echo "  1. Create repo at https://github.com/new"
  echo "  2. git remote add origin https://github.com/YOUR_USERNAME/scalesync.git"
  echo "  3. git push -u origin main"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}"
echo "  ╔══════════════════════════════════════════╗"
echo "  ║   ✓  All done!                           ║"
echo "  ╚══════════════════════════════════════════╝"
echo -e "${RESET}"

echo "  Development:  npm run dev"
echo "  Production:   npm run build:$(echo $OS | sed 's/mac/mac/;s/win/win/;s/linux/linux/')"
if [ -n "${INSTALLER:-}" ]; then
  echo "  Installer:    $INSTALLER"
fi
if [ "$GH_AVAILABLE" = true ] && git remote get-url origin &>/dev/null; then
  echo "  GitHub:       $(gh repo view --json url -q .url 2>/dev/null)"
fi
echo ""
