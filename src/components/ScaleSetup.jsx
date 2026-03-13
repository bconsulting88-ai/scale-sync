import { useState, useEffect, useRef } from 'react';
import { useApp } from '../App.jsx';

export default function ScaleSetup() {
  const { connected, setConnected, scaleData, toast } = useApp();

  const [ports,       setPorts]       = useState([]);
  const [selPort,     setSelPort]     = useState('');
  const [scanning,    setScanning]    = useState(false);
  const [connecting,  setConnecting]  = useState(false);
  const [refWeight,   setRefWeight]   = useState('100');
  const [calibrating, setCalibrating] = useState(false);
  const [calibResult, setCalibResult] = useState(null);
  const [calibHistory,setCalibHistory]= useState([]);
  const [userName,    setUserName]    = useState('');

  const scaleDataRef = useRef(null);
  useEffect(() => { scaleDataRef.current = scaleData; }, [scaleData]);

  useEffect(() => {
    scan();
    window.ss.settings.get('userName').then(u => u && setUserName(u));
    window.ss.db.getCalibrations().then(setCalibHistory);
    window.ss.scale.lastPort().then(p => p && setSelPort(p));
  }, []);

  async function scan() {
    setScanning(true);
    const r = await window.ss.scale.listPorts();
    if (r.ok) {
      setPorts(r.ports);
      // Auto-select if only one useful port
      if (r.ports.length === 1) setSelPort(r.ports[0].path);
    } else {
      toast('Could not list serial ports: ' + r.error, 'error');
    }
    setScanning(false);
  }

  async function connect() {
    if (!selPort) { toast('Select a port first', 'warn'); return; }
    setConnecting(true);
    const r = await window.ss.scale.connect(selPort);
    if (r.ok) {
      setConnected(true);
      toast(`OHAUS Ranger connected on ${r.port}`, 'success');
    } else {
      toast(`Connection failed: ${r.error}`, 'error');
    }
    setConnecting(false);
  }

  async function disconnect() {
    await window.ss.scale.disconnect();
    setConnected(false);
    toast('Scale disconnected', 'info');
  }

  async function tare() {
    const r = await window.ss.scale.tare();
    if (r.ok) toast('Tare sent — scale zeroed with load', 'success');
    else      toast('Tare failed: ' + r.error, 'error');
  }

  async function zero() {
    const r = await window.ss.scale.zero();
    if (r.ok) toast('Zero sent — scale re-zeroed', 'success');
    else      toast('Zero failed: ' + r.error, 'error');
  }

  async function calibrate() {
    if (!connected) { toast('Connect scale first', 'warn'); return; }
    const ref = parseFloat(refWeight);
    if (isNaN(ref) || ref <= 0) { toast('Enter a valid reference weight', 'warn'); return; }
    setCalibrating(true);
    // Wait 2s for a stable reading, then sample from the ref (not stale closure)
    await new Promise(r => setTimeout(r, 2000));
    const measured = scaleDataRef.current?.weight;
    if (measured == null) { toast('No reading — is scale powered on?', 'error'); setCalibrating(false); return; }

    const offset = +(measured - ref).toFixed(3);
    const passed = Math.abs(offset) < ref * 0.005; // 0.5% tolerance
    const rec    = { calibrated_by: userName || 'Staff', reference_g: ref, measured_g: measured, offset_g: offset, passed };
    await window.ss.db.saveCalibration(rec);
    setCalibResult({ ...rec, measured });
    const fresh = await window.ss.db.getCalibrations();
    setCalibHistory(fresh);
    toast(passed ? 'Calibration PASSED ✓' : 'Calibration FAILED — variance > 0.5%', passed ? 'success' : 'error');
    setCalibrating(false);
  }

  return (
    <div style={S.page}>
      <h1 style={S.title}>Scale Setup</h1>
      <p style={S.sub}>OHAUS Ranger Count 3000 · 9600 baud · 8N1</p>

      <div style={S.grid}>

        {/* ── Connection ──────────────────────────────────────────────────── */}
        <div style={S.card}>
          <div style={S.cardHead}>Connection</div>

          <div style={S.specBlock}>
            {[['Model','OHAUS Ranger Count 3000'],['Baud','9600 (fixed)'],['Protocol','8 data · No parity · 1 stop'],['Output','Continuous CR+LF stream'],['Capacity','3000 g · 0.1 g resolution']].map(([l,v]) => (
              <div key={l} style={S.specRow}>
                <span style={S.specLabel}>{l}</span>
                <span style={S.specVal}>{v}</span>
              </div>
            ))}
          </div>

          <div style={S.field}>
            <div style={S.fieldLabel}>USB Serial Port</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <select value={selPort} onChange={e => setSelPort(e.target.value)} style={S.select}>
                <option value="">Select port…</option>
                {ports.map(p => (
                  <option key={p.path} value={p.path}>
                    {p.path}{p.manufacturer ? ` — ${p.manufacturer}` : ''}
                  </option>
                ))}
              </select>
              <button onClick={scan} style={S.btnSm} disabled={scanning}>{scanning ? '…' : '⟳'}</button>
            </div>
            {ports.length === 0 && !scanning && (
              <div style={S.hint}>No ports found. Ensure USB cable is connected and driver installed.</div>
            )}
          </div>

          {connected
            ? <button onClick={disconnect} style={S.btnDanger}>Disconnect Scale</button>
            : <button onClick={connect}    style={S.btnPrimary} disabled={connecting || !selPort}>{connecting ? 'Connecting…' : 'Connect Scale'}</button>
          }
        </div>

        {/* ── Live Readout ─────────────────────────────────────────────────── */}
        <div style={S.card}>
          <div style={S.cardHead}>Live Readout</div>

          <div style={S.readoutBox}>
            <div style={{ ...S.connDot, background: connected ? 'var(--teal)' : 'var(--text-lo)' }} />
            {connected && scaleData
              ? <>
                  <div style={S.readoutVal}>{scaleData.weight != null ? scaleData.weight.toFixed(2) : '—'}</div>
                  <div style={S.readoutUnit}>grams</div>
                  <div style={{ ...S.readoutFlag,
                    color:       scaleData.stable   ? 'var(--green)' : scaleData.motion ? 'var(--amber)' : 'var(--text-lo)',
                    borderColor: scaleData.stable   ? 'var(--green)44' : 'var(--border)',
                  }}>
                    {scaleData.overload ? '⚠ OVERLOAD' : scaleData.stable ? '● ST — STABLE' : '○ US — MOTION'}
                  </div>
                  <div style={S.rawLine}>raw: {scaleData.raw}</div>
                </>
              : <div style={S.noSig}>{connected ? 'Waiting for data…' : 'Not connected'}</div>
            }
          </div>

          {connected && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={tare} style={{ ...S.btnSm, flex: 1, padding: '10px' }}>TARE</button>
              <button onClick={zero} style={{ ...S.btnSm, flex: 1, padding: '10px' }}>ZERO</button>
            </div>
          )}
        </div>

        {/* ── Calibration ──────────────────────────────────────────────────── */}
        <div style={{ ...S.card, gridColumn: '1 / -1' }}>
          <div style={S.cardHead}>Calibration Check</div>
          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-end', marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={S.fieldLabel}>Reference Weight (g)</div>
              <input type="number" value={refWeight} onChange={e => setRefWeight(e.target.value)} style={S.input} placeholder="e.g. 100" />
              <div style={S.hint}>Place known reference weight on scale, then run calibration check.</div>
            </div>
            <button onClick={calibrate} style={S.btnPrimary} disabled={calibrating || !connected}>
              {calibrating ? 'Reading…' : 'Run Check'}
            </button>
          </div>

          {calibResult && (
            <div style={{ ...S.calibResult, borderColor: calibResult.passed ? 'var(--green)44' : 'var(--red)44', background: calibResult.passed ? '#0D2A1A' : '#2A0D0D' }}>
              {[['Reference', `${calibResult.reference_g}g`], ['Measured', `${calibResult.measured?.toFixed(3)}g`], ['Offset', `${calibResult.offset_g > 0 ? '+' : ''}${calibResult.offset_g}g`], ['Result', calibResult.passed ? 'PASS ✓' : 'FAIL ✗']].map(([l,v],i) => (
                <div key={l} style={S.calibCell}>
                  <div style={S.calibLabel}>{l}</div>
                  <div style={{ ...S.calibVal, color: i === 3 ? (calibResult.passed ? 'var(--green)' : 'var(--red)') : 'var(--text-hi)' }}>{v}</div>
                </div>
              ))}
            </div>
          )}

          {calibHistory.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={S.fieldLabel}>Calibration History</div>
              {calibHistory.slice(0, 5).map(c => (
                <div key={c.id} style={S.histRow}>
                  <span style={{ color: 'var(--text-lo)' }}>{c.calibrated_at}</span>
                  <span>{c.calibrated_by}</span>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{c.reference_g}g ref → {c.measured_g?.toFixed(3)}g</span>
                  <span style={{ color: c.passed ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{c.passed ? 'PASS' : 'FAIL'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const S = {
  page:       { padding: 36, maxWidth: 900, margin: '0 auto', animation: 'fadeUp .25s ease' },
  title:      { fontSize: 24, fontWeight: 700, color: 'var(--text-hi)', marginBottom: 4 },
  sub:        { fontSize: 12, color: 'var(--text-lo)', fontFamily: 'var(--font-mono)', marginBottom: 28 },
  grid:       { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 },
  card:       { background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 24 },
  cardHead:   { fontSize: 11, color: 'var(--teal)', textTransform: 'uppercase', letterSpacing: '.08em', fontFamily: 'var(--font-mono)', marginBottom: 18 },
  specBlock:  { background: 'var(--bg-deep)', borderRadius: 8, padding: 14, marginBottom: 18, border: '1px solid var(--teal-glow)' },
  specRow:    { display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #0F2020' },
  specLabel:  { fontSize: 11, color: 'var(--text-lo)' },
  specVal:    { fontSize: 11, color: 'var(--teal)', fontFamily: 'var(--font-mono)', fontWeight: 600 },
  field:      { marginBottom: 16 },
  fieldLabel: { fontSize: 11, color: 'var(--text-lo)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 },
  select:     { flex: 1, background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', color: 'var(--text-hi)', fontSize: 13 },
  input:      { width: '100%', background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', color: 'var(--text-hi)', fontSize: 13, boxSizing: 'border-box' },
  hint:       { fontSize: 11, color: 'var(--text-lo)', marginTop: 6 },
  btnPrimary: { background: 'var(--teal-dim)', border: 'none', borderRadius: 8, padding: '10px 22px', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', width: '100%' },
  btnDanger:  { background: 'none', border: '1px solid var(--red)66', borderRadius: 8, padding: '10px', color: 'var(--red)', fontWeight: 600, fontSize: 13, cursor: 'pointer', width: '100%' },
  btnSm:      { background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 14px', color: 'var(--text-mid)', fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontWeight: 600, letterSpacing: '.04em' },
  readoutBox: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 0', textAlign: 'center' },
  connDot:    { width: 8, height: 8, borderRadius: '50%', marginBottom: 14 },
  readoutVal: { fontSize: 52, fontWeight: 700, color: 'var(--teal)', fontFamily: 'var(--font-mono)', letterSpacing: '-.02em', lineHeight: 1 },
  readoutUnit:{ fontSize: 13, color: 'var(--text-lo)', marginTop: 6 },
  readoutFlag:{ display: 'inline-block', marginTop: 10, padding: '3px 12px', borderRadius: 20, fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600, border: '1px solid', letterSpacing: '.06em' },
  rawLine:    { fontSize: 10, color: 'var(--text-lo)', marginTop: 10, fontFamily: 'var(--font-mono)' },
  noSig:      { color: 'var(--text-lo)', fontSize: 14, padding: '24px 0' },
  calibResult:{ display: 'flex', gap: 0, border: '1px solid', borderRadius: 10, overflow: 'hidden' },
  calibCell:  { flex: 1, padding: '16px 20px', borderRight: '1px solid var(--border)', textAlign: 'center' },
  calibLabel: { fontSize: 10, color: 'var(--text-lo)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 },
  calibVal:   { fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-hi)' },
  histRow:    { display: 'flex', gap: 20, fontSize: 12, color: 'var(--text-mid)', padding: '8px 0', borderBottom: '1px solid var(--border)' },
};
