import { useState, useEffect } from 'react';
import { useApp } from '../App.jsx';
import { summarise } from '../utils/engine.js';

export default function Dashboard() {
  const { setView, connected, settings, scaleData } = useApp();
  const [sessions,   setSessions]   = useState([]);
  const [prodCount,  setProdCount]  = useState(0);
  const [recentItems,setRecentItems]= useState([]);

  useEffect(() => {
    window.ss.db.getSessions().then(s => setSessions(s.slice(0, 8)));
    window.ss.db.getProductCount().then(n => setProdCount(n));
  }, []);

  async function loadRecentVariances() {
    if (!sessions[0]) return;
    const items = await window.ss.db.getSessionItems(sessions[0].session_id);
    setRecentItems(items.filter(i => i.variance !== 0).slice(0, 5));
  }

  useEffect(() => { loadRecentVariances(); }, [sessions]);

  const posOk  = !!settings.dutchie?.clientId;
  const ready  = connected && posOk && prodCount > 0;

  const lastSession = sessions[0];
  const last7       = sessions.slice(0, 7);
  const avgVariance = last7.length ? (last7.reduce((s,x) => s + (x.variance_count||0), 0) / last7.length).toFixed(1) : '—';

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div>
          <h1 style={S.title}>Dashboard</h1>
          <p style={S.sub}>OHAUS Ranger · Dutchie POS</p>
        </div>
        <button onClick={() => setView('count')} style={{ ...S.btn, opacity: ready ? 1 : .5 }}>
          + New Count Session
        </button>
      </div>

      {/* Readiness checklist */}
      <div style={S.checkRow}>
        {[
          { label: 'Scale Connected', ok: connected,     action: 'scale' },
          { label: 'Dutchie Configured', ok: posOk,     action: 'settings' },
          { label: 'Products Loaded', ok: prodCount > 0, action: 'products' },
        ].map(c => (
          <button key={c.label} onClick={() => !c.ok && setView(c.action)} style={{ ...S.checkCard, cursor: c.ok ? 'default' : 'pointer' }}>
            <span style={{ fontSize: 18, color: c.ok ? 'var(--green)' : 'var(--red)' }}>
              {c.ok ? '✓' : '○'}
            </span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: c.ok ? 'var(--text-hi)' : 'var(--text-mid)' }}>{c.label}</div>
              {!c.ok && <div style={{ fontSize: 11, color: 'var(--teal)', marginTop: 2 }}>Click to configure →</div>}
            </div>
          </button>
        ))}
      </div>

      {/* Stats row */}
      <div style={S.statsRow}>
        {[
          { label: 'Products Loaded', value: prodCount.toLocaleString(), color: 'var(--teal)' },
          { label: 'Sessions (All Time)', value: sessions.length, color: 'var(--text-hi)' },
          { label: 'Avg Variances / Session', value: avgVariance, color: avgVariance > 5 ? 'var(--amber)' : 'var(--green)' },
          { label: 'Last Count', value: lastSession ? new Date(lastSession.started_at).toLocaleDateString() : '—', color: 'var(--text-mid)' },
        ].map(s => (
          <div key={s.label} style={S.statCard}>
            <div style={{ ...S.statVal, color: s.color }}>{s.value}</div>
            <div style={S.statLabel}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={S.cols}>
        {/* Recent sessions */}
        <div style={{ flex: 1.5 }}>
          <div style={S.sectionHead}>Recent Sessions</div>
          {sessions.length === 0
            ? <div style={S.empty}>No sessions yet. Run your first count.</div>
            : sessions.map(s => (
              <div key={s.session_id} style={S.sessionRow}>
                <div>
                  <div style={S.sessionId}>{s.session_id}</div>
                  <div style={S.sessionMeta}>{s.location_name || 'No location'} · {s.started_by}</div>
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span style={S.pill}>{s.sku_count} SKUs</span>
                  {s.variance_count > 0 && <span style={{ ...S.pill, background: '#3D1515', color: 'var(--red)', borderColor: 'var(--red)44' }}>{s.variance_count} var</span>}
                  <span style={{ ...S.pill, background: s.status === 'completed' ? '#0D2A1A' : 'var(--bg-card)', color: s.status === 'completed' ? 'var(--green)' : 'var(--amber)', borderColor: 'transparent' }}>
                    {s.status === 'completed' ? 'done' : 'in progress'}
                  </span>
                </div>
              </div>
            ))
          }
        </div>

        {/* Recent variances */}
        {recentItems.length > 0 && (
          <div style={{ flex: 1 }}>
            <div style={S.sectionHead}>Last Session Variances</div>
            {recentItems.map(i => (
              <div key={i.id} style={S.varRow}>
                <div style={{ fontSize: 12, color: 'var(--text-mid)', flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{i.sku_name}</div>
                <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color: i.variance < 0 ? 'var(--red)' : 'var(--amber)', minWidth: 40, textAlign: 'right' }}>
                  {i.variance > 0 ? '+' : ''}{i.variance}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const S = {
  page:      { padding: 36, maxWidth: 980, margin: '0 auto', animation: 'fadeUp .3s ease' },
  header:    { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 },
  title:     { fontSize: 26, fontWeight: 700, color: 'var(--text-hi)', marginBottom: 4 },
  sub:       { fontSize: 12, color: 'var(--text-lo)', fontFamily: 'var(--font-mono)' },
  btn:       { background: 'var(--teal-dim)', border: 'none', borderRadius: 8, padding: '10px 22px', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' },
  checkRow:  { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 20 },
  checkCard: { display: 'flex', gap: 12, alignItems: 'center', background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', textAlign: 'left' },
  statsRow:  { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 32 },
  statCard:  { background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 10, padding: '18px 20px' },
  statVal:   { fontSize: 28, fontWeight: 700, fontFamily: 'var(--font-mono)', marginBottom: 4 },
  statLabel: { fontSize: 11, color: 'var(--text-lo)', textTransform: 'uppercase', letterSpacing: '.06em' },
  cols:      { display: 'flex', gap: 24 },
  sectionHead:{ fontSize: 11, color: 'var(--text-lo)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 12, fontFamily: 'var(--font-mono)' },
  sessionRow:{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px', marginBottom: 8 },
  sessionId: { fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--teal)', marginBottom: 3 },
  sessionMeta:{ fontSize: 11, color: 'var(--text-lo)' },
  pill:      { fontSize: 11, padding: '3px 8px', borderRadius: 20, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-mid)' },
  empty:     { color: 'var(--text-lo)', fontSize: 13, padding: '24px 0', textAlign: 'center' },
  varRow:    { display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--border)' },
};
