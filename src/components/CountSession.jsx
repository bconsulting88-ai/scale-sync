import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../App.jsx';
import { calcUnits, calcVariance, StabilityDetector, uid, fmt, toCSV } from '../utils/engine.js';
import { dutchieFromSettings } from '../services/dutchie.js';

const STEP = { SELECT: 'select', WEIGH: 'weigh', DONE: 'done' };

// ─── P-02: debounce hook ──────────────────────────────────────────────────────
function useDebounce(value, ms) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export default function CountSession() {
  const { scaleData, connected, settings, toast, setView } = useApp();

  // ── Session ───────────────────────────────────────────────────────────────
  const [session,      setSession]      = useState(null);
  const [step,         setStep]         = useState(STEP.SELECT);
  const [countedItems, setCountedItems] = useState([]);

  // ── Product selection ─────────────────────────────────────────────────────
  const [products,  setProducts]  = useState([]);
  const [search,    setSearch]    = useState('');
  const [tares,     setTares]     = useState([]);
  const [syncing,   setSyncing]   = useState(false);

  // ── Weighing ──────────────────────────────────────────────────────────────
  const [selProduct,   setSelProduct]   = useState(null);
  const [selTare,      setSelTare]      = useState(null);
  const [stability,    setStability]    = useState({ stable: false, current: 0 });
  const [lockedWeight, setLockedWeight] = useState(null);
  const [calcResult,   setCalcResult]   = useState(null);
  const [varResult,    setVarResult]    = useState(null);
  const [notes,        setNotes]        = useState('');

  // ── Async op guards ───────────────────────────────────────────────────────
  const [confirming,   setConfirming]   = useState(false);   // C-02: double-confirm
  const [pushing,      setPushing]      = useState(false);
  const [pushResult,   setPushResult]   = useState(null);
  const [pushProgress, setPushProgress] = useState(null);    // { done, total }

  // ── Refs ──────────────────────────────────────────────────────────────────
  const detector        = useRef(new StabilityDetector({ window: 6, tolerance: 0.3, holdMs: 1200 }));
  const lockedWeightRef = useRef(null);
  const selProductRef   = useRef(null);
  const selTareRef      = useRef(null);
  const rafRef          = useRef(null);      // P-01: RAF coalescing handle
  const mountedRef      = useRef(true);      // D-01: unmount guard
  const sessionRef      = useRef(null);      // C-03: created session object
  const sessionCreating = useRef(false);     // C-03: creation lock
  const syncingRef      = useRef(false);     // C-07: sync double-fire lock

  // D-01: cancel RAF and mark unmounted on cleanup
  useEffect(() => () => {
    mountedRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  // Mirror state → refs for scale-feed effect
  useEffect(() => { lockedWeightRef.current = lockedWeight; }, [lockedWeight]);
  useEffect(() => { selProductRef.current   = selProduct;   }, [selProduct]);
  useEffect(() => { selTareRef.current      = selTare;      }, [selTare]);

  // Tare change after weight locked → invalidate result
  useEffect(() => {
    if (lockedWeightRef.current !== null) {
      setLockedWeight(null);
      lockedWeightRef.current = null;
      setCalcResult(null);
      setVarResult(null);
      detector.current.reset();
    }
  }, [selTare]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Boot ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    loadProducts('');
    window.ss.db.getTares().then(t => { if (mountedRef.current) setTares(t); });
  }, []);

  useEffect(() => {
    if (tares.length && !selTare) setSelTare(tares[0]);
  }, [tares]);

  // P-02: debounce search 200ms before hitting SQLite
  const debouncedSearch = useDebounce(search, 200);
  useEffect(() => { loadProducts(debouncedSearch); }, [debouncedSearch]);

  async function loadProducts(q = '') {
    const prods = await window.ss.db.getProducts(q);
    if (mountedRef.current) setProducts(prods);
  }

  // ── Scale feed ─────────────────────────────────────────────────────────────
  // P-01: coalesce 10 Hz OHAUS stream into one render per animation frame
  useEffect(() => {
    if (step !== STEP.WEIGH || !scaleData || scaleData.weight === null) return;
    if (scaleData.overload) { toast('Scale overloaded — remove weight', 'error'); return; }

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      if (!mountedRef.current) return;

      const result = detector.current.feed(scaleData.weight, scaleData.stable);
      setStability(result);

      if (result.stable && !lockedWeightRef.current) {
        const product = selProductRef.current;
        const tare    = selTareRef.current;
        if (!product) return;

        const locked = result.current;
        setLockedWeight(locked);
        lockedWeightRef.current = locked;

        const cr = calcUnits({
          grossWeight:    locked,
          tareWeight:     tare?.weight_g || 0,
          avgUnitWeight:  product.avg_unit_weight,
        });
        if (cr.error) { toast(cr.error, 'error'); return; }
        const vr = calcVariance({ countedUnits: cr.countedUnits, bookUnits: product.book_quantity });
        setCalcResult(cr);
        setVarResult(vr);
      }
    });
  }, [scaleData, step, toast]);

  // ── C-03: serialised session creation ─────────────────────────────────────
  // Ref-based lock prevents two rapid confirms from creating two sessions.
  const ensureSession = useCallback(async () => {
    if (sessionRef.current) return sessionRef.current;
    if (sessionCreating.current) {
      for (let i = 0; i < 30; i++) {         // spin-wait up to 3 s
        await new Promise(r => setTimeout(r, 100));
        if (sessionRef.current) return sessionRef.current;
      }
      throw new Error('Session creation timed out — try again');
    }
    sessionCreating.current = true;
    try {
      const sid  = uid();
      const user = settings.userName || 'Staff';
      const loc  = settings.locationName || '';
      await window.ss.db.createSession({ session_id: sid, started_by: user, location_name: loc });
      const s = { session_id: sid, started_by: user, location_name: loc };
      sessionRef.current = s;
      if (mountedRef.current) setSession(s);
      return s;
    } finally {
      sessionCreating.current = false;
    }
  }, [settings]);

  // ── Select product ─────────────────────────────────────────────────────────
  function selectProduct(p) {
    if (!p.avg_unit_weight) {
      toast(`No unit weight for "${p.sku_name}" — edit in Products first.`, 'warn', 5000);
      return;
    }
    setSelProduct(p);
    setLockedWeight(null);
    setCalcResult(null);
    setVarResult(null);
    setNotes('');
    detector.current.reset();
    setStep(STEP.WEIGH);
  }

  // ── C-02: confirming flag prevents double-submit ───────────────────────────
  async function confirmCount() {
    if (confirming) return;
    setConfirming(true);
    try {
      const sess = await ensureSession();
      const item = {
        session_id:      sess.session_id,
        sku_id:          selProduct.sku_id,
        sku_name:        selProduct.sku_name,
        category:        selProduct.category || '',
        tare_weight:     selTare?.weight_g || 0,
        gross_weight:    lockedWeight,
        net_weight:      calcResult.netWeight,
        avg_unit_weight: calcResult.avgUnitWeight,
        counted_units:   calcResult.countedUnits,
        book_units:      selProduct.book_quantity,
        variance:        varResult.variance,
        variance_pct:    varResult.variancePct,
        notes,
      };
      const res = await window.ss.db.saveItem(item);
      if (!mountedRef.current) return;
      if (res?.error?.includes('UNIQUE')) {
        toast(`${selProduct.sku_name} already counted this session`, 'warn', 5000);
        setStep(STEP.SELECT);
        return;
      }
      setCountedItems(prev => [...prev, item]);
      toast(`✓ ${selProduct.sku_name} — ${calcResult.countedUnits} units logged`, 'success');
      setStep(STEP.SELECT);
      setSelProduct(null);
      detector.current.reset();
    } finally {
      if (mountedRef.current) setConfirming(false);
    }
  }

  // ── C-07: ref-lock prevents double-sync ───────────────────────────────────
  async function syncDutchie() {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      const svc    = await dutchieFromSettings();
      const result = await svc.getInventory();
      if (!result.ok) throw new Error(result.error);
      const upsert = await window.ss.db.upsertProducts(result.products);
      if (upsert?.ok === false) throw new Error(upsert.error || 'Catalog save failed');
      if (mountedRef.current) {
        await loadProducts(debouncedSearch);
        toast(`Synced ${result.total} products from Dutchie`, 'success');
      }
    } catch (e) {
      if (mountedRef.current) toast(`Sync failed: ${e.message}`, 'error', 6000);
    } finally {
      syncingRef.current = false;
      if (mountedRef.current) setSyncing(false);
    }
  }

  // ── D-02 + D-05: push then complete; mark each item as it succeeds ─────────
  async function completeAndPush() {
    if (!session || countedItems.length === 0 || pushing) return;
    setPushing(true);
    setPushProgress({ done: 0, total: countedItems.length });
    try {
      const svc = await dutchieFromSettings();
      await svc.authenticate();
      const result = await svc.pushCounts(countedItems, session.session_id, {
        onItemPushed: async (sku_id) => {
          await window.ss.db.markItemPushed({ session_id: session.session_id, sku_id });
          if (mountedRef.current)
            setPushProgress(p => ({ ...p, done: (p?.done || 0) + 1 }));
        },
      });
      if (!mountedRef.current) return;
      setPushResult(result);
      // D-02: complete AFTER push, not before — prevents half-pushed sessions
      await window.ss.db.completeSession(session.session_id);
      toast(
        result.ok
          ? `${result.pushed.length} items pushed to Dutchie ✓`
          : `Push partially failed — ${result.errors.length} errors`,
        result.ok ? 'success' : 'warn',
        5000,
      );
      setStep(STEP.DONE);
    } catch (e) {
      if (mountedRef.current) toast(`Push failed: ${e.message}`, 'error', 6000);
      // Stay on current screen so user can retry or save offline
    } finally {
      if (mountedRef.current) { setPushing(false); setPushProgress(null); }
    }
  }

  async function completeOffline() {
    if (!session || countedItems.length === 0) {
      toast('Count at least one product first', 'warn');
      return;
    }
    await window.ss.db.completeSession(session.session_id);
    if (mountedRef.current) {
      setStep(STEP.DONE);
      toast('Session saved locally. Push from History when ready.', 'info');
    }
  }

  async function exportCSV() {
    if (!session) return;
    const full = await window.ss.db.getSession(session.session_id);
    const csv  = toCSV(full, countedItems);
    const fn   = `ScaleSync_${session.session_id}_${new Date().toISOString().slice(0, 10)}.csv`;
    await window.ss.report.saveCsv(fn, csv);
    toast('CSV saved to Downloads', 'success');
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const countedIds = new Set(countedItems.map(i => i.sku_id));
  const filtered   = products.filter(p =>
    !search ||
    p.sku_name.toLowerCase().includes(search.toLowerCase()) ||
    (p.category || '').toLowerCase().includes(search.toLowerCase())
  );

  if (step === STEP.DONE) {
    return (
      <DoneView
        session={session}
        items={countedItems}
        pushResult={pushResult}
        onNew={() => {
          sessionRef.current = null;
          setSession(null);
          setCountedItems([]);
          setPushResult(null);
          setStep(STEP.SELECT);
        }}
        onExport={exportCSV}
      />
    );
  }

  return (
    <div style={S.page}>

      {/* Header */}
      <div style={S.header}>
        <div>
          <h1 style={S.title}>{step === STEP.WEIGH ? 'Weighing' : 'Select Product'}</h1>
          {session && <div style={S.sessionTag}>{session.session_id}</div>}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {pushing && pushProgress && (
            <div style={S.pushBadge}>
              Pushing {pushProgress.done}/{pushProgress.total}…
            </div>
          )}
          {countedItems.length > 0 && step !== STEP.WEIGH && (
            <>
              <button onClick={completeOffline} style={S.btnGhost} disabled={pushing}>Save Offline</button>
              <button onClick={completeAndPush} style={S.btnPrimary} disabled={pushing}>
                {pushing ? 'Pushing…' : 'Push to Dutchie & Complete'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Progress stats */}
      {countedItems.length > 0 && (
        <div style={S.progress}>
          {[
            { label: '✓ Matched', n: countedItems.filter(i => i.variance === 0).length,        color: 'var(--green)' },
            { label: '↓ Short',   n: countedItems.filter(i => (i.variance || 0) < 0).length,  color: 'var(--red)' },
            { label: '↑ Over',    n: countedItems.filter(i => (i.variance || 0) > 0).length,  color: 'var(--amber)' },
            { label: 'Total',     n: countedItems.length,                                       color: 'var(--text-mid)' },
          ].map(p => (
            <div key={p.label} style={S.progressStat}>
              <span style={{ color: p.color, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{p.n}</span>
              <span style={{ color: 'var(--text-lo)', fontSize: 11, marginLeft: 4 }}>{p.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* SELECT step */}
      {step === STEP.SELECT && (
        <>
          <div style={S.toolbar}>
            <input
              style={S.search}
              placeholder="Search by name or category…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <button onClick={syncDutchie} style={S.btnSync} disabled={syncing}>
              {syncing
                ? <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>↻</span>
                : '↻'
              }{' '}Sync Dutchie
            </button>
          </div>

          {filtered.length === 0
            ? <div style={S.empty}>No products. Click "Sync Dutchie" to load your catalog.</div>
            : (
              <div style={S.grid}>
                {filtered.map(p => {
                  const done = countedIds.has(p.sku_id);
                  return (
                    <button
                      key={p.sku_id}
                      onClick={() => selectProduct(p)}
                      style={{ ...S.card, ...(done ? S.cardDone : {}) }}
                    >
                      {done && <span style={S.doneCheck}>✓</span>}
                      <div style={S.cardCat}>{p.category || 'Uncategorized'}</div>
                      <div style={S.cardName}>{p.sku_name}</div>
                      <div style={S.cardMeta}>
                        <span style={{ color: p.avg_unit_weight ? 'var(--teal)' : 'var(--red)' }}>
                          {p.avg_unit_weight ? `${p.avg_unit_weight}g/unit` : 'Weight needed'}
                        </span>
                        <span>Book: {p.book_quantity ?? '—'}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )
          }
        </>
      )}

      {/* WEIGH step */}
      {step === STEP.WEIGH && selProduct && (
        <div style={S.weighLayout}>

          {/* Left panel */}
          <div>
            <button onClick={() => setStep(STEP.SELECT)} style={S.backBtn}>← Back to products</button>

            <div style={S.productPanel}>
              <div style={S.productCat}>{selProduct.category}</div>
              <div style={S.productName}>{selProduct.sku_name}</div>
              {selProduct.brand && <div style={S.productBrand}>{selProduct.brand}</div>}
            </div>

            <div style={S.infoGrid}>
              <InfoCell label="Avg Unit Weight" value={`${selProduct.avg_unit_weight}g`} accent />
              <InfoCell label="POS Book Qty"     value={selProduct.book_quantity ?? '—'} />
            </div>

            <div style={S.fieldBlock}>
              <div style={S.fieldLabel}>Container / Tare Weight</div>
              <select
                value={selTare?.id || ''}
                onChange={e => setSelTare(tares.find(t => t.id === +e.target.value))}
                style={S.select}
              >
                {tares.map(t => <option key={t.id} value={t.id}>{t.name} ({t.weight_g}g)</option>)}
              </select>
            </div>

            {calcResult && (
              <div style={S.fieldBlock}>
                <div style={S.fieldLabel}>Staff Notes</div>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  style={S.textarea}
                  placeholder="Optional — explain any variance…"
                  rows={3}
                />
              </div>
            )}
          </div>

          {/* Right panel — scale readout */}
          <div>
            {!connected ? (
              <div style={S.noScale}>
                <div style={{ fontSize: 36 }}>⊙</div>
                <div>Scale not connected</div>
                <button onClick={() => setView('scale')} style={S.btnLink}>Go to Scale Setup →</button>
              </div>
            ) : (
              <>
                <div style={S.liveBox}>
                  <div style={S.liveLabel}>LIVE WEIGHT</div>
                  <div style={S.liveVal}>
                    {scaleData?.weight != null ? scaleData.weight.toFixed(2) : '—'}
                  </div>
                  <div style={S.liveUnit}>grams</div>
                  <div style={{
                    ...S.stabBadge,
                    ...(stability.stable ? S.stabGreen : stability.current > 0 ? S.stabAmber : {}),
                  }}>
                    {scaleData?.overload    ? '⚠ OVERLOAD'
                      : stability.stable   ? '● STABLE — LOCKED'
                      : scaleData?.stable  ? '○ HOLDING…'
                      : '○ SETTLING'}
                  </div>
                  <div style={S.tareNote}>
                    Tare: {fmt(selTare?.weight_g || 0)} · Net:{' '}
                    {stability.current > 0
                      ? fmt(stability.current - (selTare?.weight_g || 0))
                      : '—'}
                  </div>
                </div>

                {calcResult && varResult ? (
                  <div style={S.resultCard}>
                    {[
                      ['Gross', fmt(calcResult.grossWeight)],
                      ['Tare',  `− ${fmt(calcResult.tareWeight)}`],
                      ['Net',   fmt(calcResult.netWeight)],
                    ].map(([l, v]) => (
                      <div key={l} style={S.resultRow}>
                        <span style={{ color: 'var(--text-lo)' }}>{l}</span>
                        <span style={{ fontFamily: 'var(--font-mono)' }}>{v}</span>
                      </div>
                    ))}

                    <div style={S.divider} />

                    <div style={S.countedRow}>
                      <span style={{ color: 'var(--text-lo)' }}>Counted Units</span>
                      <span style={S.countedVal}>{calcResult.countedUnits}</span>
                    </div>

                    <div style={{
                      ...S.varianceBadge,
                      background: varResult.variance === 0 ? '#0D2A1A' : Math.abs(varResult.variance) <= 2 ? '#2A1A00' : '#2A0D0D',
                      color:      varResult.variance === 0 ? 'var(--green)' : Math.abs(varResult.variance) <= 2 ? 'var(--amber)' : 'var(--red)',
                    }}>
                      {varResult.variance === null
                        ? 'NO BOOK DATA'
                        : varResult.variance === 0
                        ? '✓ MATCHES BOOK'
                        : `VARIANCE: ${varResult.variance > 0 ? '+' : ''}${varResult.variance} (${varResult.variancePct?.toFixed(1)}%)`}
                    </div>

                    <div style={S.confRow}>
                      Confidence:{' '}
                      <span style={{
                        color: calcResult.confidence >= 0.97
                          ? 'var(--green)'
                          : calcResult.confidence >= 0.85
                          ? 'var(--amber)'
                          : 'var(--red)',
                      }}>
                        {calcResult.confLabel} ({(calcResult.confidence * 100).toFixed(1)}%)
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                      <button
                        onClick={() => {
                          setLockedWeight(null);
                          setCalcResult(null);
                          setVarResult(null);
                          detector.current.reset();
                        }}
                        style={S.btnGhost}
                      >
                        Re-weigh
                      </button>
                      <button
                        onClick={confirmCount}
                        style={{ ...S.btnPrimary, flex: 1, opacity: confirming ? 0.6 : 1 }}
                        disabled={confirming}
                      >
                        {confirming ? 'Saving…' : '✓ Confirm Count'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={S.placeProd}>
                    <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.4 }}>⊙</div>
                    Place product on scale
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function InfoCell({ label, value, accent }) {
  return (
    <div style={{ background: 'var(--bg-deep)', borderRadius: 8, padding: '12px 14px', border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 10, color: 'var(--text-lo)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono)', color: accent ? 'var(--teal)' : 'var(--text-hi)' }}>{value}</div>
    </div>
  );
}

function DoneView({ session, items, pushResult, onNew, onExport }) {
  const matched   = items.filter(i => i.variance === 0).length;
  const variances = items.filter(i => i.variance !== 0 && i.variance != null);
  return (
    <div style={{ padding: 40, maxWidth: 700, margin: '0 auto', animation: 'fadeUp .3s ease' }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>✓</div>
        <h2 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-hi)', marginBottom: 4 }}>Session Complete</h2>
        <div style={{ fontSize: 12, color: 'var(--text-lo)', fontFamily: 'var(--font-mono)' }}>{session?.session_id}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 24 }}>
        {[
          ['Total SKUs', items.length,    'var(--text-hi)'],
          ['Matched',    matched,         'var(--green)'],
          ['Variances',  variances.length, variances.length > 0 ? 'var(--red)' : 'var(--green)'],
        ].map(([l, v, c]) => (
          <div key={l} style={{ background: 'var(--bg-panel)', borderRadius: 10, padding: 20, textAlign: 'center', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 36, fontWeight: 700, color: c, fontFamily: 'var(--font-mono)' }}>{v}</div>
            <div style={{ fontSize: 11, color: 'var(--text-lo)', marginTop: 4 }}>{l}</div>
          </div>
        ))}
      </div>

      {pushResult && (
        <div style={{
          background:   pushResult.ok ? '#0D2A1A' : '#2A0D0D',
          border:       `1px solid ${pushResult.ok ? 'var(--green)' : 'var(--red)'}44`,
          borderRadius: 10, padding: '14px 18px', marginBottom: 20, fontSize: 13,
        }}>
          {pushResult.ok
            ? `✓ ${pushResult.pushed.length} items successfully pushed to Dutchie`
            : `⚠ ${pushResult.pushed.length} pushed · ${pushResult.errors.length} failed`}
        </div>
      )}

      {variances.length > 0 && (
        <div style={{ background: 'var(--bg-panel)', borderRadius: 10, padding: 20, border: '1px solid var(--border)', marginBottom: 20 }}>
          <div style={{ fontSize: 12, color: 'var(--red)', fontFamily: 'var(--font-mono)', marginBottom: 12 }}>VARIANCE REPORT</div>
          {variances.map(i => (
            <div key={i.sku_id} style={{ display: 'flex', gap: 16, fontSize: 13, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ flex: 1, color: 'var(--text-mid)' }}>{i.sku_name}</span>
              <span style={{ color: 'var(--text-lo)' }}>Book: {i.book_units}</span>
              <span style={{ color: 'var(--text-lo)' }}>Count: {i.counted_units}</span>
              <span style={{ color: i.variance < 0 ? 'var(--red)' : 'var(--amber)', fontWeight: 700, fontFamily: 'var(--font-mono)', minWidth: 40, textAlign: 'right' }}>
                {i.variance > 0 ? '+' : ''}{i.variance}
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onExport} style={{ ...S.btnGhost, flex: 1 }}>⬇ Export CSV</button>
        <button onClick={onNew}    style={{ ...S.btnPrimary, flex: 2 }}>Start New Session</button>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = {
  page:         { padding: 32, animation: 'fadeUp .25s ease' },
  header:       { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  title:        { fontSize: 24, fontWeight: 700, color: 'var(--text-hi)', marginBottom: 4 },
  sessionTag:   { fontSize: 11, color: 'var(--teal)', fontFamily: 'var(--font-mono)' },
  pushBadge:    { fontSize: 11, color: 'var(--amber)', fontFamily: 'var(--font-mono)', background: '#2A1A00', padding: '4px 10px', borderRadius: 6, border: '1px solid var(--amber)44' },
  progress:     { display: 'flex', gap: 24, background: 'var(--bg-panel)', borderRadius: 8, padding: '10px 18px', marginBottom: 20, border: '1px solid var(--border)' },
  progressStat: { display: 'flex', alignItems: 'center', gap: 4 },
  toolbar:      { display: 'flex', gap: 10, marginBottom: 18 },
  search:       { flex: 1, background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', color: 'var(--text-hi)', fontSize: 13 },
  btnSync:      { background: 'none', border: '1px solid var(--teal-dim)', color: 'var(--teal)', borderRadius: 8, padding: '10px 18px', fontSize: 13, whiteSpace: 'nowrap', cursor: 'pointer' },
  btnPrimary:   { background: 'var(--teal-dim)', border: 'none', borderRadius: 8, padding: '10px 20px', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' },
  btnGhost:     { background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 16px', color: 'var(--text-mid)', fontSize: 13, cursor: 'pointer' },
  btnLink:      { background: 'none', border: 'none', color: 'var(--teal)', fontSize: 13, cursor: 'pointer', marginTop: 8 },
  grid:         { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: 10 },
  card:         { background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', textAlign: 'left', position: 'relative', cursor: 'pointer', transition: 'border-color .15s' },
  cardDone:     { borderColor: '#1B5E2066', opacity: 0.65 },
  doneCheck:    { position: 'absolute', top: 10, right: 12, color: 'var(--green)', fontWeight: 700, fontSize: 14 },
  cardCat:      { fontSize: 10, color: 'var(--teal)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 },
  cardName:     { fontSize: 13, fontWeight: 600, color: 'var(--text-hi)', marginBottom: 8, lineHeight: 1.3 },
  cardMeta:     { display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-lo)' },
  empty:        { textAlign: 'center', color: 'var(--text-lo)', padding: '60px 0', fontSize: 14 },
  weighLayout:  { display: 'grid', gridTemplateColumns: '320px 1fr', gap: 28, marginTop: 8 },
  backBtn:      { background: 'none', border: 'none', color: 'var(--text-lo)', fontSize: 12, cursor: 'pointer', padding: '0 0 16px', display: 'block' },
  productPanel: { marginBottom: 20 },
  productCat:   { fontSize: 10, color: 'var(--teal)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 },
  productName:  { fontSize: 20, fontWeight: 700, color: 'var(--text-hi)', lineHeight: 1.3 },
  productBrand: { fontSize: 12, color: 'var(--text-lo)', marginTop: 4 },
  infoGrid:     { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 },
  fieldBlock:   { marginBottom: 16 },
  fieldLabel:   { fontSize: 11, color: 'var(--text-lo)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 },
  select:       { width: '100%', background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', color: 'var(--text-hi)', fontSize: 13 },
  textarea:     { width: '100%', background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', color: 'var(--text-hi)', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' },
  liveBox:      { background: 'var(--bg-panel)', borderRadius: 12, border: '1px solid var(--teal-glow)', padding: '28px 24px', textAlign: 'center', marginBottom: 16 },
  liveLabel:    { fontSize: 10, color: 'var(--text-lo)', letterSpacing: '.1em', marginBottom: 8, fontFamily: 'var(--font-mono)' },
  liveVal:      { fontSize: 56, fontWeight: 700, color: 'var(--teal)', fontFamily: 'var(--font-mono)', letterSpacing: '-.02em', lineHeight: 1 },
  liveUnit:     { fontSize: 13, color: 'var(--text-lo)', marginTop: 6 },
  stabBadge:    { display: 'inline-block', marginTop: 12, padding: '3px 12px', borderRadius: 20, fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600, border: '1px solid var(--border)', color: 'var(--text-lo)', letterSpacing: '.06em' },
  stabGreen:    { color: 'var(--green)', borderColor: 'var(--green)66' },
  stabAmber:    { color: 'var(--amber)', borderColor: 'var(--amber)66' },
  tareNote:     { fontSize: 11, color: 'var(--text-lo)', marginTop: 10 },
  resultCard:   { background: 'var(--bg-panel)', borderRadius: 12, border: '1px solid var(--border)', padding: '20px' },
  resultRow:    { display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 },
  divider:      { height: 1, background: 'var(--border)', margin: '12px 0' },
  countedRow:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  countedVal:   { fontSize: 36, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-hi)' },
  varianceBadge:{ borderRadius: 8, padding: '10px 14px', textAlign: 'center', fontWeight: 700, fontSize: 13, fontFamily: 'var(--font-mono)', letterSpacing: '.04em' },
  confRow:      { fontSize: 11, color: 'var(--text-lo)', textAlign: 'center', marginTop: 10 },
  noScale:      { textAlign: 'center', color: 'var(--text-lo)', padding: '60px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, fontSize: 14 },
  placeProd:    { textAlign: 'center', color: 'var(--text-lo)', padding: '60px 0', fontSize: 14 },
};
