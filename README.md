# ScaleSync v1.2
### Cannabis Inventory Automation — OHAUS Ranger Count 3000 + Dutchie Enterprise API

> Weigh products on a counting scale → auto-calculate unit counts → push directly to Dutchie POS as a compliant PHYSICAL_COUNT inventory adjustment.

---

## Quick Start

### Prerequisites
- **Node.js v18+** — https://nodejs.org
- **npm v9+** (bundled with Node)
- **macOS 12+**, **Windows 10/11 x64**, or **Ubuntu 20.04+**

### 1. Install

**macOS / Linux — one-liner (downloads + installs automatically):**
```bash
curl -fsSL https://raw.githubusercontent.com/bconsulting88-ai/scale-sync/main/install.sh | bash
```

**macOS / Linux — if you already cloned the repo:**
```bash
bash install.sh
```

**Windows:**
```
install.bat
```

Or manually:
```bash
npm install
```

### 2. Run in development mode
```bash
npm run dev
```
This opens Electron with hot-reload. The app window opens immediately.

### 3. Build a distributable

| Platform | Command | Output |
|----------|---------|--------|
| macOS | `npm run build:mac` | `release/ScaleSync-1.2.0.dmg` |
| Windows | `npm run build:win` | `release/ScaleSync Setup 1.2.0.exe` |
| Linux | `npm run build:linux` | `release/ScaleSync-1.2.0.AppImage` |

Installers appear in the `release/` directory.

---

## Native Module Note

ScaleSync uses two native Node addons that must be compiled for the exact Electron version:
- **better-sqlite3** — SQLite database
- **serialport** — USB serial port for OHAUS scale

`npm install` automatically runs `electron-builder install-app-deps` (via `postinstall`) which rebuilds these for Electron's Node ABI. **No manual steps needed.**

If you see `NODE_MODULE_VERSION` errors, run:
```bash
npx electron-rebuild
```

---

## First-Time Setup (inside the app)

### Scale Setup
1. Plug **OHAUS Ranger Count 3000** into your computer via USB-to-RS232 adapter
2. Open the **Scale Setup** tab
3. Click **Scan** → select the serial port
   - macOS: `/dev/tty.usbserial-*` or `/dev/cu.usbserial-*`
   - Windows: `COM3`, `COM4`, etc.
   - Linux: `/dev/ttyUSB0`
4. Click **Connect Scale** — baud rate is fixed at 9600 8N1
5. Live weight appears in the sidebar
6. Run a **Calibration Check** with a known reference weight

### Dutchie Credentials
1. Open **Settings → Dutchie POS**
2. Enter:
   - **Client ID** — Dutchie Back Office → Settings → API Access
   - **Client Secret** — same location
   - **Dispensary ID** — Back Office → Settings → General → About This Dispensary
3. Click **Test Connection** — verifies credentials against live API
4. Click **Save Credentials**

### Load Product Catalog
1. Open **New Count**
2. Click **↻ Sync Dutchie** — pulls your full inventory catalog via GraphQL
3. Products without a unit weight show in red → set them in the **Products** tab

### Run a Count
1. Select a product from the grid
2. Place the container on the scale → select the matching tare profile
3. Place product in container → wait for **● STABLE — LOCKED**
4. Review counted units and variance vs. book quantity
5. Click **✓ Confirm Count** → repeat for each product
6. Click **Push to Dutchie & Complete** when done

---

## Architecture

```
ScaleSync-v1.2/
├── src/
│   ├── main.js              Electron main process
│   │                        ├── OHAUS Ranger serial driver (9600 8N1)
│   │                        │   ├── Write queue — prevents byte interleaving
│   │                        │   └── Generation counter — prevents listener leaks
│   │                        ├── SQLite via better-sqlite3 (WAL mode)
│   │                        │   └── Tables: sessions, count_items, products,
│   │                        │            tare_profiles, calibrations
│   │                        └── IPC handlers (window.ss.* bridge)
│   │
│   ├── preload.js           Context bridge — typed API as window.ss
│   ├── main.jsx             React entry point
│   ├── App.jsx              Root — context, routing, sidebar, toast system
│   │
│   ├── components/
│   │   ├── Dashboard.jsx    Readiness checklist, stats, recent sessions
│   │   ├── CountSession.jsx Core workflow: select → weigh → confirm → push
│   │   │                    ├── Session creation lock (C-03)
│   │   │                    ├── Double-confirm guard (C-02)
│   │   │                    ├── Double-sync guard (C-07)
│   │   │                    ├── RAF-coalesced scale rendering (P-01)
│   │   │                    ├── Debounced search (P-02)
│   │   │                    └── Unmount guard for async ops (D-01)
│   │   ├── ScaleSetup.jsx   Port scan, connect, tare/zero, calibration check
│   │   ├── Products.jsx     Catalog browser — set avg unit weights per SKU
│   │   ├── History.jsx      Session history, variance drill-in, CSV export
│   │   └── Settings.jsx     Dutchie credentials, user/location
│   │
│   ├── services/
│   │   └── dutchie.js       Dutchie Enterprise GraphQL adapter
│   │                        ├── OAuth2 client_credentials (token cache + auto-refresh)
│   │                        ├── Paginated inventory pull (100/page)
│   │                        ├── inventoryAdjustment (PHYSICAL_COUNT reason)
│   │                        └── 5-concurrent push with per-item DB tracking (P-03/D-05)
│   │
│   └── utils/
│       └── engine.js        Count math
│                            ├── calcUnits()       — gross → net → unit count
│                            ├── calcVariance()    — vs. Dutchie book quantity
│                            ├── StabilityDetector — OHAUS ST + software hold
│                            ├── toCSV()           — RFC 4180 compliance export
│                            └── uid()             — session ID generator
│
├── dist/                    Pre-built renderer bundle (258KB minified)
│   ├── index.html
│   └── renderer.js
│
├── assets/                  App icons + build resources
│   ├── icon.icns            macOS
│   ├── icon.ico             Windows (multi-res: 16/32/64/128/256px)
│   ├── icon.png             Linux / general
│   └── entitlements.mac.plist
│
├── electron-builder.yml     Build config (mac/win/linux targets)
├── package.json
├── vite.config.js
├── install.sh               macOS/Linux one-command setup
└── install.bat              Windows one-command setup
```

---

## OHAUS Ranger Serial Protocol

| Parameter | Value |
|-----------|-------|
| Baud rate | 9600 |
| Data bits | 8 |
| Parity    | None |
| Stop bits | 1 |
| Delimiter | CR+LF (`\r\n`) |

**Output format:** `"  +  1234.56 g  ST\r\n"`
- `ST` = Stable, `US` = Unstable, `DY` = Dynamic, `OL` = Overload

**Commands sent by app:**

| Command | Effect |
|---------|--------|
| `ON\r\n` | Enable continuous output stream (sent on connect) |
| `T\r\n`  | Tare — zero with current load on pan |
| `Z\r\n`  | Zero — re-zero empty pan |
| `IP\r\n` | Request single stable print |

---

## Dutchie API

| Endpoint | Purpose |
|----------|---------|
| `POST https://auth.dutchie.com/oauth/token` | OAuth2 client_credentials auth |
| `POST https://plus.dutchie.com/plus/2021-07/graphql` | All queries + mutations |

**Key operations:**
- `query inventoryItems` — paginated catalog pull (100 items/page)
- `mutation inventoryAdjustment(reason: PHYSICAL_COUNT)` — push count

---

## Database

| Platform | Location |
|----------|----------|
| macOS | `~/Library/Application Support/ScaleSync/scalesync.db` |
| Windows | `%APPDATA%\ScaleSync\scalesync.db` |
| Linux | `~/.config/ScaleSync/scalesync.db` |

Tables: `sessions`, `count_items`, `products`, `tare_profiles`, `calibrations`

---

## Pending (Phase 2)

- [ ] Treez + Flowhub POS adapters
- [ ] Bluetooth scale support (Ohaus Scout STX)
- [ ] Multi-location dashboard
- [ ] PDF compliance report generator
- [ ] Dutchie API credentials — request `inventoryAdjustment` write scope from Dutchie Partner Portal
