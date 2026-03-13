'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path   = require('path');
const fs     = require('fs');

// ─── Lazy-load native modules ─────────────────────────────────────────────────
// electron-store v8+ is ESM-only — must use dynamic import(), not require().
let SerialPort, ReadlineParser, Store, Database;

async function loadNative() {
  ({ SerialPort }     = require('serialport'));
  ({ ReadlineParser } = require('@serialport/parser-readline'));
  const storeModule   = await import('electron-store');
  Store               = storeModule.default;
  Database            = require('better-sqlite3');
}

const isDev = process.env.NODE_ENV === 'development';

let win, store, db;
let activePort  = null;
let activeParser = null;

// ─────────────────────────────────────────────────────────────────────────────
// APP LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  await loadNative();
  store = new Store();
  initDB();
  createWindow();
});

app.on('window-all-closed', () => {
  disconnectScale();
  if (db) db.close();
  app.quit();
});

function createWindow() {
  win = new BrowserWindow({
    width:           1300,
    height:          820,
    minWidth:        1050,
    minHeight:       680,
    titleBarStyle:   process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    backgroundColor: '#060E0E',
    show:            false,
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      preload:          path.join(__dirname, 'preload.js')
    }
  });

  win.once('ready-to-show', () => win.show());

  if (isDev) {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DATABASE — SQLite via better-sqlite3 (synchronous, no async needed)
// ─────────────────────────────────────────────────────────────────────────────

function initDB() {
  const dbPath = path.join(app.getPath('userData'), 'scalesync.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id    TEXT    UNIQUE NOT NULL,
      started_by    TEXT    NOT NULL,
      location_name TEXT,
      pos_system    TEXT    NOT NULL DEFAULT 'dutchie',
      status        TEXT    NOT NULL DEFAULT 'in_progress',
      started_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      completed_at  TEXT,
      sku_count     INTEGER DEFAULT 0,
      variance_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS count_items (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id     TEXT    NOT NULL REFERENCES sessions(session_id),
      sku_id         TEXT    NOT NULL,
      sku_name       TEXT    NOT NULL,
      category       TEXT,
      tare_weight    REAL    NOT NULL DEFAULT 0,
      gross_weight   REAL    NOT NULL,
      net_weight     REAL    NOT NULL,
      avg_unit_weight REAL   NOT NULL,
      counted_units  INTEGER NOT NULL,
      book_units     INTEGER,
      variance       INTEGER,
      variance_pct   REAL,
      notes          TEXT,
      counted_at     TEXT    DEFAULT (datetime('now','localtime')),
      pushed_to_pos  INTEGER DEFAULT 0,
      UNIQUE(session_id, sku_id)
    );

    CREATE TABLE IF NOT EXISTS products (
      sku_id          TEXT PRIMARY KEY,
      sku_name        TEXT NOT NULL,
      category        TEXT,
      subcategory     TEXT,
      brand           TEXT,
      avg_unit_weight REAL,
      book_quantity   INTEGER DEFAULT 0,
      unit_of_measure TEXT    DEFAULT 'EACH',
      last_synced     TEXT
    );

    CREATE TABLE IF NOT EXISTS tare_profiles (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      weight_g    REAL    NOT NULL,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS calibrations (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      calibrated_by   TEXT,
      reference_g     REAL,
      measured_g      REAL,
      offset_g        REAL,
      passed          INTEGER DEFAULT 1,
      calibrated_at   TEXT DEFAULT (datetime('now','localtime'))
    );

    INSERT OR IGNORE INTO tare_profiles (id, name, weight_g, description) VALUES
      (1, 'No container',        0,   'Place product directly on pan'),
      (2, 'Small plastic bin',   45,  'Standard ~45g counting bin'),
      (3, 'Medium plastic bin',  125, 'Standard ~125g counting bin'),
      (4, 'Large plastic bin',   280, 'Standard ~280g counting bin'),
      (5, 'Small glass jar',     180, 'Small glass jar ~180g'),
      (6, 'Large glass jar',     350, 'Large glass jar ~350g'),
      (7, 'Metal tray (small)',  320, 'Small metal counting tray ~320g'),
      (8, 'Metal tray (large)',  680, 'Large metal counting tray ~680g');

    CREATE INDEX IF NOT EXISTS idx_products_name     ON products(sku_name);
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
    CREATE INDEX IF NOT EXISTS idx_items_session     ON count_items(session_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_started  ON sessions(started_at DESC);
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// OHAUS RANGER COUNT 3000 — SERIAL DRIVER
//
// Comm spec: 9600 baud · 8 data bits · No parity · 1 stop bit (8N1)
// Output:    Continuous CR+LF terminated ASCII lines
//
// Output format:  "  +  1234.56 g  ST\r\n"
//   Field 1:  sign + magnitude (space-padded, 10 chars)
//   Field 2:  unit (g / kg)
//   Field 3:  stability flag: ST=Stable US=Unstable DY=Dynamic OL=Overload
//
// Commands (write to port):
//   "ON\r\n"   Enable continuous output stream
//   "OFF\r\n"  Disable stream
//   "IP\r\n"   Immediate print (single stable reading)
//   "T\r\n"    Tare (zero with current load on pan)
//   "Z\r\n"    Zero (re-zero with empty pan)
// ─────────────────────────────────────────────────────────────────────────────

const OHAUS = {
  BAUD:     9600,
  DATABITS: 8,
  PARITY:   'none',
  STOPBITS: 1,
  CMD: {
    STREAM_ON:  'ON\r\n',
    STREAM_OFF: 'OFF\r\n',
    PRINT:      'IP\r\n',
    TARE:       'T\r\n',
    ZERO:       'Z\r\n',
  }
};

function parseOHAUS(raw) {
  if (!raw) return null;
  const line = raw.trim();
  if (line.length < 6) return null;

  const overload = line.endsWith('OL');
  if (overload) return { weight: null, stable: false, overload: true, motion: false, raw: line };

  const stable   = line.endsWith('ST');
  const motion   = line.endsWith('US') || line.endsWith('DY');

  // Extract: optional sign, integer part, decimal part, unit
  const m = line.match(/([+-]?)\s*([\d]+\.[\d]+)\s+(g|kg)/i);
  if (!m) return null;

  const sign = m[1] === '-' ? -1 : 1;
  let   val  = parseFloat(m[2]) * sign;
  if (m[3].toLowerCase() === 'kg') val *= 1000;

  return {
    weight:   parseFloat(val.toFixed(3)),
    stable,
    motion,
    overload: false,
    raw:      line
  };
}

// ─── Serial write queue — prevents byte interleaving on rapid TARE/ZERO/PRINT ──
let writeQueue = Promise.resolve();

function queueWrite(cmd) {
  writeQueue = writeQueue.then(() => writeToScale(cmd));
  return writeQueue;
}

async function writeToScale(cmd) {
  if (!activePort?.isOpen) throw new Error('Scale not connected');
  return new Promise((res, rej) =>
    activePort.write(cmd, err => err ? rej(err) : res())
  );
}

function disconnectScale() {
  if (activePort?.isOpen) {
    activePort.close(err => { if (err) console.error('Serial close error:', err.message); });
  }
  activePort   = null;
  activeParser = null;
  writeQueue   = Promise.resolve(); // reset queue on disconnect
}

// ─── Scale IPC ────────────────────────────────────────────────────────────────

ipcMain.handle('scale:list-ports', async () => {
  try {
    const ports = await SerialPort.list();
    const score = p => {
      const m = (p.manufacturer || '').toLowerCase();
      return (m.includes('ohaus') || m.includes('prolific') || m.includes('ftdi')) ? 1 : 0;
    };
    const sorted = ports.sort((a, b) => score(b) - score(a));
    return { ok: true, ports: sorted };
  } catch (e) { return { ok: false, error: e.message }; }
});

// C-05 / C-06: generation counter prevents stale-port listener from firing
// after a newer connect supersedes it.
let connectGeneration = 0;

ipcMain.handle('scale:connect', async (_, { portPath }) => {
  // Immediately bump generation — any in-flight open() from a prior call
  // will check this before attaching listeners and bail out.
  const myGen = ++connectGeneration;

  try {
    // Close existing port synchronously before opening new one
    if (activePort?.isOpen) {
      const old = activePort;
      activePort = null;
      old.close(err => { if (err) console.error('Prior port close error:', err.message); });
    }

    const port = new SerialPort({
      path:     portPath,
      baudRate: OHAUS.BAUD,
      dataBits: OHAUS.DATABITS,
      parity:   OHAUS.PARITY,
      stopBits: OHAUS.STOPBITS,
      autoOpen: false
    });

    await new Promise((res, rej) => port.open(err => err ? rej(err) : res()));

    // If another connect call arrived while we were awaiting open(), abort
    if (myGen !== connectGeneration) {
      port.close(() => {});
      return { ok: false, error: 'Superseded by newer connect request' };
    }

    activePort = port;
    writeQueue = Promise.resolve(); // fresh queue for new port

    const parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }));
    activeParser  = parser;

    // C-06: use once-bound named handler so we can remove it on disconnect
    const onData = raw => {
      if (myGen !== connectGeneration) return; // stale port — ignore
      const parsed = parseOHAUS(raw);
      if (parsed && !win.isDestroyed()) win.webContents.send('scale:data', parsed);
    };
    const onError = err => {
      if (myGen !== connectGeneration) return;
      if (!win.isDestroyed()) win.webContents.send('scale:error', err.message);
    };
    const onClose = () => {
      if (myGen !== connectGeneration) return;
      if (!win.isDestroyed()) win.webContents.send('scale:disconnected');
    };

    parser.on('data',  onData);
    port.on('error',   onError);
    port.on('close',   onClose);

    // Enable continuous stream
    await queueWrite(OHAUS.CMD.STREAM_ON);
    store.set('lastPort', portPath);

    return { ok: true, port: portPath };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('scale:disconnect', async () => {
  disconnectScale();
  return { ok: true };
});

ipcMain.handle('scale:tare',  async () => {
  try { await queueWrite(OHAUS.CMD.TARE);  return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('scale:zero',  async () => {
  try { await queueWrite(OHAUS.CMD.ZERO);  return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('scale:print', async () => {
  try { await queueWrite(OHAUS.CMD.PRINT); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('scale:last-port', () => store.get('lastPort', null));

// ─────────────────────────────────────────────────────────────────────────────
// DATABASE IPC
// ─────────────────────────────────────────────────────────────────────────────

// Products
ipcMain.handle('db:get-products', (_, search = '') => {
  const q = `%${search}%`;
  return db.prepare(`
    SELECT * FROM products
    WHERE sku_name LIKE ? OR category LIKE ? OR sku_id LIKE ?
    ORDER BY category, sku_name
  `).all(q, q, q);
});

ipcMain.handle('db:upsert-products', (_, products) => {
  const stmt = db.prepare(`
    INSERT INTO products (sku_id, sku_name, category, subcategory, brand, avg_unit_weight, book_quantity, unit_of_measure, last_synced)
    VALUES (@sku_id, @sku_name, @category, @subcategory, @brand, @avg_unit_weight, @book_quantity, @unit_of_measure, @last_synced)
    ON CONFLICT(sku_id) DO UPDATE SET
      sku_name        = excluded.sku_name,
      category        = excluded.category,
      subcategory     = excluded.subcategory,
      brand           = excluded.brand,
      avg_unit_weight = CASE WHEN excluded.avg_unit_weight IS NOT NULL THEN excluded.avg_unit_weight ELSE products.avg_unit_weight END,
      book_quantity   = excluded.book_quantity,
      unit_of_measure = excluded.unit_of_measure,
      last_synced     = excluded.last_synced
  `);
  const now = new Date().toISOString();
  const run = db.transaction(prods => {
    for (const p of prods) stmt.run({ ...p, last_synced: now });
  });
  try {
    run(products);
    return { ok: true, count: products.length };
  } catch (e) {
    console.error('db:upsert-products transaction failed:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('db:update-product-weight', (_, { sku_id, avg_unit_weight }) => {
  db.prepare('UPDATE products SET avg_unit_weight = ? WHERE sku_id = ?').run(avg_unit_weight, sku_id);
  return { ok: true };
});

ipcMain.handle('db:get-product-count', () => {
  return db.prepare('SELECT COUNT(*) as count FROM products').get().count;
});

// Tare profiles
ipcMain.handle('db:get-tares', () => {
  return db.prepare('SELECT * FROM tare_profiles ORDER BY weight_g').all();
});

ipcMain.handle('db:add-tare', (_, { name, weight_g, description }) => {
  const info = db.prepare('INSERT INTO tare_profiles (name, weight_g, description) VALUES (?,?,?)').run(name, weight_g, description);
  return { ok: true, id: info.lastInsertRowid };
});

// Sessions
ipcMain.handle('db:create-session', (_, { session_id, started_by, location_name }) => {
  db.prepare(`INSERT INTO sessions (session_id, started_by, location_name) VALUES (?,?,?)`)
    .run(session_id, started_by, location_name || '');
  return { ok: true };
});

ipcMain.handle('db:get-sessions', () => {
  return db.prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT 100').all();
});

ipcMain.handle('db:get-session', (_, session_id) => {
  return db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(session_id);
});

ipcMain.handle('db:complete-session', (_, { session_id }) => {
  const counts = db.prepare('SELECT COUNT(*) as total, SUM(CASE WHEN variance IS NOT NULL AND variance != 0 THEN 1 ELSE 0 END) as variances FROM count_items WHERE session_id = ?').get(session_id);
  db.prepare(`UPDATE sessions SET status='completed', completed_at=datetime('now','localtime'), sku_count=?, variance_count=? WHERE session_id=?`)
    .run(counts.total, counts.variances || 0, session_id);
  return { ok: true };
});

// Count items
ipcMain.handle('db:save-item', (_, item) => {
  db.prepare(`
    INSERT INTO count_items (session_id, sku_id, sku_name, category, tare_weight, gross_weight, net_weight, avg_unit_weight, counted_units, book_units, variance, variance_pct, notes)
    VALUES (@session_id, @sku_id, @sku_name, @category, @tare_weight, @gross_weight, @net_weight, @avg_unit_weight, @counted_units, @book_units, @variance, @variance_pct, @notes)
  `).run(item);
  return { ok: true };
});

ipcMain.handle('db:get-session-items', (_, session_id) => {
  return db.prepare('SELECT * FROM count_items WHERE session_id = ? ORDER BY counted_at').all(session_id);
});

ipcMain.handle('db:mark-pushed', (_, session_id) => {
  db.prepare('UPDATE count_items SET pushed_to_pos=1 WHERE session_id=?').run(session_id);
  return { ok: true };
});

// Per-item push tracking — used by pushCounts to mark each item as it succeeds
ipcMain.handle('db:mark-item-pushed', (_, { session_id, sku_id }) => {
  db.prepare('UPDATE count_items SET pushed_to_pos=1 WHERE session_id=? AND sku_id=?').run(session_id, sku_id);
  return { ok: true };
});

// Calibrations
ipcMain.handle('db:save-calibration', (_, rec) => {
  db.prepare(`INSERT INTO calibrations (calibrated_by, reference_g, measured_g, offset_g, passed) VALUES (?,?,?,?,?)`)
    .run(rec.calibrated_by, rec.reference_g, rec.measured_g, rec.offset_g, rec.passed ? 1 : 0);
  return { ok: true };
});

ipcMain.handle('db:get-calibrations', () => {
  return db.prepare('SELECT * FROM calibrations ORDER BY calibrated_at DESC LIMIT 20').all();
});

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS IPC
// ─────────────────────────────────────────────────────────────────────────────

ipcMain.handle('settings:get-all',       ()           => store.store);
ipcMain.handle('settings:get',           (_, key)     => store.get(key));
ipcMain.handle('settings:set',           (_, kv)      => { store.set(kv.key, kv.val); return { ok: true }; });
ipcMain.handle('settings:set-many',      (_, obj)     => { Object.entries(obj).forEach(([k,v]) => store.set(k,v)); return { ok: true }; });
ipcMain.handle('settings:delete',        (_, key)     => { store.delete(key); return { ok: true }; });

// ─────────────────────────────────────────────────────────────────────────────
// REPORT — save PDF/CSV report to user's Downloads folder
// ─────────────────────────────────────────────────────────────────────────────

ipcMain.handle('report:save-csv', (_, { filename, csv }) => {
  const dest = path.join(app.getPath('downloads'), filename);
  fs.writeFileSync(dest, csv, 'utf8');
  shell.showItemInFolder(dest);
  return { ok: true, path: dest };
});
