// ─── Core counting math ───────────────────────────────────────────────────────

export function calcUnits({ grossWeight, tareWeight = 0, avgUnitWeight }) {
  if (!avgUnitWeight || avgUnitWeight <= 0) return { error: 'No average unit weight set for this product.' };
  const net  = grossWeight - tareWeight;
  if (net < 0) return { error: `Net weight is negative (${net.toFixed(2)}g). Check tare or re-zero.` };
  const raw   = net / avgUnitWeight;
  const units = Math.round(raw);
  const rem   = net - units * avgUnitWeight;
  const conf  = Math.min(1, Math.max(0, 1 - Math.abs(rem) / avgUnitWeight));
  return {
    grossWeight,
    tareWeight,
    netWeight:    +net.toFixed(3),
    avgUnitWeight,
    rawUnits:     +raw.toFixed(4),
    countedUnits: units,
    remainder:    +rem.toFixed(3),
    confidence:   +conf.toFixed(4),
    confLabel:    conf >= 0.97 ? 'HIGH' : conf >= 0.85 ? 'MEDIUM' : 'LOW'
  };
}

export function calcVariance({ countedUnits, bookUnits }) {
  if (bookUnits == null) return { variance: null, variancePct: null, label: 'NO BOOK DATA' };
  const v    = countedUnits - bookUnits;
  const pct  = bookUnits > 0 ? (v / bookUnits) * 100 : null;
  return {
    variance:    v,
    variancePct: pct !== null ? +pct.toFixed(2) : null,
    label: v === 0 ? 'MATCH'
         : Math.abs(v) <= 2   ? 'MINOR'
         : Math.abs(v) <= 10  ? 'MODERATE'
         : 'SIGNIFICANT'
  };
}

// ─── OHAUS-aware stability detector ──────────────────────────────────────────
// Primary signal: hardware ST flag from OHAUS parser
// Secondary:      software sliding window (tolerance 0.3g, hold 1.2s)

export class StabilityDetector {
  constructor(cfg = {}) {
    this.window   = cfg.window   ?? 5;
    this.tolerance= cfg.tolerance?? 0.3;
    this.holdMs   = cfg.holdMs   ?? 1200;
    this.buf      = [];
    this.stableAt = null;
  }

  feed(weight, hwStable) {
    const now = Date.now();
    this.buf.push({ weight, hwStable, ts: now });
    if (this.buf.length > this.window) this.buf.shift();

    const avg = this.buf.reduce((s,r) => s + r.weight, 0) / this.buf.length;

    if (!hwStable) { this.stableAt = null; return { stable: false, current: +avg.toFixed(2) }; }

    if (this.buf.length >= 3) {
      const ws  = this.buf.map(r => r.weight);
      const rng = Math.max(...ws) - Math.min(...ws);
      if (rng > this.tolerance) { this.stableAt = null; return { stable: false, current: +avg.toFixed(2) }; }
    }

    if (!this.stableAt) this.stableAt = now;
    const held = now - this.stableAt;
    return { stable: held >= this.holdMs, current: +avg.toFixed(2), heldMs: held };
  }

  reset() { this.buf = []; this.stableAt = null; }
}

// ─── Session summary ──────────────────────────────────────────────────────────

export function summarise(items) {
  const total     = items.length;
  const matched   = items.filter(i => i.variance === 0).length;
  const short_    = items.filter(i => (i.variance ?? 0) < 0).length;
  const over      = items.filter(i => (i.variance ?? 0) > 0).length;
  const noBook    = items.filter(i => i.variance == null).length;
  return { total, matched, short: short_, over, noBook };
}

// ─── CSV export ───────────────────────────────────────────────────────────────

// Properly quote a CSV field: wrap in double-quotes, escape internal double-quotes
function csvField(val) {
  if (val == null) return '';
  const s = String(val);
  // Always quote strings to handle commas, newlines, quotes
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCSV(session, items) {
  const header = [
    'Session ID','Location','Started By','Started At','Status',
    'SKU ID','SKU Name','Category',
    'Tare (g)','Gross (g)','Net (g)','Avg Unit Weight (g)',
    'Counted Units','Book Units','Variance','Variance %','Notes'
  ].map(csvField).join(',');

  const rows = items.map(i => [
    csvField(session.session_id),
    csvField(session.location_name),
    csvField(session.started_by),
    csvField(session.started_at),
    csvField(session.status),
    csvField(i.sku_id),
    csvField(i.sku_name),
    csvField(i.category),
    i.tare_weight,
    i.gross_weight,
    i.net_weight,
    i.avg_unit_weight,
    i.counted_units,
    i.book_units ?? '',
    i.variance   ?? '',
    i.variance_pct ?? '',
    csvField(i.notes),
  ].join(',')).join('\n');

  return `${header}\n${rows}`;
}

// ─── Misc utils ───────────────────────────────────────────────────────────────

export function uid() {
  const ts   = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2,6).toUpperCase();
  return `SS-${ts}-${rand}`;
}

export function fmt(g) {
  if (g == null) return '—';
  return Math.abs(g) >= 1000 ? `${(g/1000).toFixed(3)} kg` : `${g.toFixed(1)} g`;
}
