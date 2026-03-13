# ScaleSync — Claude Code Project Intelligence

> This file is read automatically by Claude Code. It contains everything needed
> to build, run, and deploy ScaleSync as a production Electron desktop app.

---

## What This App Does

ScaleSync automates cannabis retail inventory counts.
**Formula:** `Units = (Gross Weight − Tare) ÷ Avg Unit Weight`

Staff place products on an OHAUS Ranger Count 3000 counting scale → the app
reads the stable weight via USB serial → calculates unit count → pushes it to
Dutchie POS as a `PHYSICAL_COUNT` inventory adjustment.

---

## Immediate Task — Build & Deploy

Run these steps **in order**. Do not skip steps.

### Step 1 — Install dependencies
```bash
npm install
```
This installs all packages AND rebuilds native modules (better-sqlite3,
serialport) against the correct Electron Node ABI via the `postinstall` hook.
Expected output: `added N packages` with no errors.

**If native rebuild fails:**
```bash
npx electron-rebuild -f -w better-sqlite3
npx electron-rebuild -f -w serialport
```

### Step 2 — Launch in development mode (verify it works)
```bash
npm run dev
```
Expected: Vite dev server starts on port 5173, Electron window opens showing
the ScaleSync dashboard (dark teal UI). If the window opens, Step 2 is done.
Close the window to proceed.

### Step 3 — Build the production installer for the current platform

**macOS (produces .dmg):**
```bash
npm run build:mac
```

**Windows (produces .exe NSIS installer):**
```bash
npm run build:win
```

**Linux (produces .AppImage):**
```bash
npm run build:linux
```

Output goes to: `./release/`

### Step 4 — Initialize git and push to GitHub
```bash
git init
git add .
git commit -m "feat: ScaleSync v1.2 — cannabis inventory automation

- OHAUS Ranger Count 3000 serial driver (9600 8N1)
- Dutchie Enterprise GraphQL API integration
- SQLite session/count/product database
- 13 concurrency bugs fixed (stress test v1.2)
- Electron + React + Vite + electron-builder"

gh repo create scalesync --private --source=. --remote=origin --push
```

If `gh` is not available, use the GitHub API directly or create the repo
manually at github.com and then:
```bash
git remote add origin https://github.com/YOUR_USERNAME/scalesync.git
git push -u origin main
```

### Step 5 — Report back
After completing all steps, report:
- GitHub repo URL
- Path to the built installer in `./release/`
- Any errors encountered

---

## Project Architecture

### Tech Stack
| Layer | Technology |
|-------|-----------|
| Desktop shell | Electron 31 |
| Renderer | React 18 + Vite 5 |
| Database | SQLite via better-sqlite3 (WAL mode) |
| Serial port | serialport 12 + @serialport/parser-readline |
| Config/secrets | electron-store 8 (encrypted) |
| Build/package | electron-builder 24 |

### Process Model
```
Main Process (src/main.js — Node.js)
├── OHAUS serial driver
├── SQLite database
├── IPC handlers (ipcMain.handle)
└── BrowserWindow

Renderer Process (src/ — React)
├── Communicates ONLY via window.ss.* (context bridge)
├── Never touches Node APIs directly
└── Bundled to dist/renderer.js by Vite

Preload Script (src/preload.js)
└── Exposes window.ss API via contextBridge
```

### IPC Bridge — window.ss
```javascript
window.ss.scale.listPorts()
window.ss.scale.connect(portPath)
window.ss.scale.disconnect()
window.ss.scale.tare()
window.ss.scale.zero()
window.ss.scale.lastPort()
// Scale data arrives as event: ipcRenderer.on('scale:data', ...)

window.ss.db.getProducts(search)
window.ss.db.upsertProducts(products[])
window.ss.db.updateProductWeight({ sku_id, avg_unit_weight })
window.ss.db.getProductCount()
window.ss.db.getTares()
window.ss.db.addTare({ name, weight_g, description })
window.ss.db.createSession({ session_id, started_by, location_name })
window.ss.db.getSessions()
window.ss.db.getSession(session_id)
window.ss.db.completeSession(session_id)
window.ss.db.saveItem(item)
window.ss.db.getSessionItems(session_id)
window.ss.db.markPushed(session_id)
window.ss.db.markItemPushed({ session_id, sku_id })
window.ss.db.saveCalibration(rec)
window.ss.db.getCalibrations()

window.ss.settings.getAll()
window.ss.settings.get(key)
window.ss.settings.set({ key, val })
window.ss.settings.setMany(obj)
window.ss.settings.delete(key)

window.ss.report.saveCsv(filename, csvString)
```

### File Structure
```
src/
├── main.js                  Electron main process (Node.js)
├── preload.js               Context bridge
├── main.jsx                 React entry point
├── App.jsx                  Root — context, sidebar, routing, toast system
├── components/
│   ├── Dashboard.jsx        Readiness checklist, session stats
│   ├── CountSession.jsx     Core workflow: select → weigh → confirm → push
│   ├── ScaleSetup.jsx       Port scan, connect, calibration
│   ├── Products.jsx         Catalog browser, set unit weights
│   ├── History.jsx          Session history, CSV export, retry push
│   └── Settings.jsx         Dutchie credentials, user/location config
├── services/
│   └── dutchie.js           Dutchie GraphQL adapter (fetch-based, no axios)
└── utils/
    └── engine.js            calcUnits, calcVariance, StabilityDetector, toCSV, uid

assets/
├── icon.icns                macOS app icon
├── icon.ico                 Windows app icon (multi-res 16–256px)
├── icon.png                 Linux app icon
├── icon.svg                 Source SVG
├── dmg-background.png       macOS DMG installer background
└── entitlements.mac.plist   macOS hardened runtime entitlements

dist/                        Pre-built renderer (Vite output)
├── index.html
└── renderer.js              258KB minified bundle

release/                     electron-builder output (created on build)
```

---

## Key Implementation Details

### OHAUS Ranger Serial Protocol
- **Baud:** 9600, **Data:** 8N1, **Delimiter:** `\r\n`
- **Output format:** `"  +  1234.56 g  ST\r\n"`
  - Stability flags: `ST`=Stable, `US`=Unstable, `DY`=Dynamic, `OL`=Overload
- **Commands:** `ON\r\n` (stream), `T\r\n` (tare), `Z\r\n` (zero), `IP\r\n` (print)
- **Write queue** in main.js prevents byte interleaving on rapid commands
- **Generation counter** prevents stale listeners on reconnect

### Dutchie API
- **Auth:** `POST https://auth.dutchie.com/oauth/token` (client_credentials)
- **GraphQL:** `POST https://plus.dutchie.com/plus/2021-07/graphql`
- Token cached with 5-minute buffer before expiry, auto-refreshed
- Push uses `inventoryAdjustment(reason: PHYSICAL_COUNT)` mutation
- 5-concurrent chunk strategy (P-03 fix) — 200 items in ~12s vs 60s serial

### SQLite Schema
```sql
sessions       (session_id PK, started_by, location_name, pos_system, status,
                started_at, completed_at, sku_count, variance_count)
count_items    (id PK, session_id FK, sku_id, UNIQUE(session_id,sku_id),
                tare_weight, gross_weight, net_weight, avg_unit_weight,
                counted_units, book_units, variance, variance_pct, notes,
                counted_at, pushed_to_pos)
products       (sku_id PK, sku_name, category, subcategory, brand,
                avg_unit_weight, book_quantity, unit_of_measure, last_synced)
tare_profiles  (id PK, name, weight_g, description)
calibrations   (id PK, calibrated_by, reference_g, measured_g, offset_g,
                passed, calibrated_at)
```

### Database Location (runtime)
- macOS: `~/Library/Application Support/ScaleSync/scalesync.db`
- Windows: `%APPDATA%\ScaleSync\scalesync.db`
- Linux: `~/.config/ScaleSync/scalesync.db`

---

## Concurrency Fixes Applied (v1.1 → v1.2)

These are already fixed in the codebase — listed for context.

| ID | Bug | Fix |
|----|-----|-----|
| C-01 | `useRef` missing from ScaleSetup import | Added |
| C-02 | Double-click Confirm → duplicate DB rows | `confirming` state flag |
| C-03 | Race condition creates two sessions | Ref-based creation lock |
| C-04 | TARE+ZERO byte interleaving | Serial write queue |
| C-05 | Double-click Connect leaks stale port | Generation counter |
| C-06 | Reconnect stacks N listeners | Generation guard on all handlers |
| C-07 | Double-click Sync → concurrent SQLite transactions | `syncingRef` lock |
| D-01 | `setState` on unmounted component during push | `mountedRef` guard |
| D-02 | `completeSession` before push → half-pushed data | Complete AFTER push |
| D-03 | Malformed product crashes transaction silently | try/catch + error return |
| D-04 | No uniqueness constraint on count_items | `UNIQUE(session_id, sku_id)` |
| D-05 | All-or-nothing push marking → duplicate Dutchie adjustments | Per-item `markItemPushed` |
| P-01 | 10Hz scale stream drives full React re-render | `requestAnimationFrame` coalescing |
| P-02 | Every keystroke fires SQLite LIKE scan | `useDebounce(200ms)` |
| P-03 | 200 items × serial push = 60s | 5-concurrent chunk strategy |

---

## npm Scripts Reference
```bash
npm run dev          # Vite + Electron dev mode (hot reload)
npm run build        # Vite build + electron-builder (current platform)
npm run build:mac    # macOS DMG (x64 + arm64 universal)
npm run build:win    # Windows NSIS installer (x64)
npm run build:linux  # Linux AppImage (x64)
npm start            # Run electron directly (production mode, needs dist/)
npm run postinstall  # Rebuild native modules (runs automatically after install)
```

---

## Troubleshooting

### "Cannot find module 'better-sqlite3'"
```bash
npx electron-rebuild -f -w better-sqlite3
```

### "Cannot find module 'serialport'"
```bash
npx electron-rebuild -f -w serialport
```

### "NODE_MODULE_VERSION mismatch"
```bash
npx electron-rebuild
```

### Electron window is blank / white screen
```bash
npm run dev
# Check DevTools console: Cmd+Option+I (mac) / Ctrl+Shift+I (win)
# Usually means dist/renderer.js didn't load — check dist/index.html script src
```

### Scale not detected on macOS
Install the CP210x USB-to-Serial driver:
https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers

### Scale not detected on Windows
Install the Prolific PL2303 driver or CP210x driver depending on your adapter.

---

## Phase 2 Roadmap (not yet built)
- Treez POS adapter
- Flowhub POS adapter
- Bluetooth scale support (OHAUS Scout STX)
- Multi-location web dashboard
- PDF compliance report generator
- Auto-update via electron-updater
