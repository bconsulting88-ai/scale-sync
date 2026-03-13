import { useState, useEffect } from 'react';
import { toCSV } from '../utils/engine.js';
import { useApp } from '../App.jsx';
import { dutchieFromSettings } from '../services/dutchie.js';

export default function History() {
  const { toast } = useApp();
  const [sessions,  setSessions]  = useState([]);
  const [selected,  setSelected]  = useState(null);
  const [items,     setItems]     = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [pushing,   setPushing]   = useState(false);

  useEffect(() => {
    window.ss.db.getSessions().then(setSessions);
  }, []);

  async function open(session) {
    setLoading(true);
    setSelected(session);
    const rows = await window.ss.db.getSessionItems(session.session_id);
    setItems(rows);
    setLoading(false);
  }

  async function exportCSV() {
    if (!selected) return;
    const csv = toCSV(selected, items);
    const fn  = `ScaleSync_${selected.session_id}_${new Date().toISOString().slice(0,10)}.csv`;
    await window.ss.report.saveCsv(fn, csv);
    toast('CSV saved to Downloads', 'success');
  }

  // Push an offline-saved session to Dutchie
  async function pushToDutchie() {
    if (!selected || items.length === 0) return;
    const alreadyPushed = items.every(i => i.pushed_to_pos === 1);
    if (alreadyPushed) { toast('All items already pushed to Dutchie', 'info'); return; }
    setPushing(true);
    try {
      const svc    = await dutchieFromSettings();
      await svc.authenticate();
      const unpushed = items.filter(i => !i.pushed_to_pos);
      const result   = await svc.pushCounts(unpushed, selected.session_id);
      if (result.ok) {
        await window.ss.db.markPushed(selected.session_id);
        // Refresh items to show updated pushed_to_pos flags
        const refreshed = await window.ss.db.getSessionItems(selected.session_id);
        setItems(refreshed);
        toast(`${result.pushed.length} items pushed to Dutchie ✓`, 'success', 5000);
      } else {
        toast(`Push partially failed — ${result.errors.length} errors`, 'warn', 6000);
      }
    } catch (e) {
      toast(`Push failed: ${e.message}`, 'error', 6000);
    }
    setPushing(false);
  }

  if (selected) return (
    <div style={S.page}>
      <div style={S.header}>
        <div>
          <button onClick={() => setSelected(null)} style={S.back}>← All Sessions</button>
          <h1 style={S.title}>{selected.session_id}</h1>
          <div style={S.meta}>{selected.location_name} · {selected.started_by} · {selected.started_at}</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {selected.status === 'completed' && items.some(i => !i.pushed_to_pos) && (
            <button onClick={pushToDutchie} style={S.btnPrimary} disabled={pushing}>
              {pushing ? 'Pushing…' : '↑ Push to Dutchie'}
            </button>
          )}
          <button onClick={exportCSV} style={S.btnGhost}>⬇ Export CSV</button>
        </div>
      </div>

      {/* Summary row */}
      <div style={S.sumRow}>
        {[
          ['Total SKUs',  items.length,                                          'var(--text-hi)'],
          ['Matched',     items.filter(i => i.variance === 0).length,            'var(--green)'],
          ['Short',       items.filter(i => (i.variance||0) < 0).length,         'var(--red)'],
          ['Over',        items.filter(i => (i.variance||0) > 0).length,         'var(--amber)'],
        ].map(([l,v,c]) => (
          <div key={l} style={S.sumCard}>
            <div style={{ fontSize: 28, fontWeight: 700, color: c, fontFamily: 'var(--font-mono)' }}>{v}</div>
            <div style={{ fontSize: 11, color: 'var(--text-lo)' }}>{l}</div>
          </div>
        ))}
      </div>

      {loading
        ? <div style={S.empty}>Loading…</div>
        : <div style={S.table}>
            <div style={S.tHead}>
              {['Product','Category','Tare g','Gross g','Net g','Avg g/unit','Counted','Book','Variance','Notes'].map(h => (
                <div key={h} style={{ ...S.th, ...(h==='Variance'?{color:'var(--amber)'}:{}) }}>{h}</div>
              ))}
            </div>
            {items.map(i => (
              <div key={i.id} style={S.tRow}>
                <div style={S.tdMain}><div style={S.tdName}>{i.sku_name}</div><div style={S.tdId}>{i.sku_id}</div></div>
                <div style={S.td}>{i.category||'—'}</div>
                <div style={{ ...S.td, fontFamily:'var(--font-mono)' }}>{i.tare_weight}</div>
                <div style={{ ...S.td, fontFamily:'var(--font-mono)' }}>{i.gross_weight}</div>
                <div style={{ ...S.td, fontFamily:'var(--font-mono)' }}>{i.net_weight}</div>
                <div style={{ ...S.td, fontFamily:'var(--font-mono)' }}>{i.avg_unit_weight}</div>
                <div style={{ ...S.td, fontFamily:'var(--font-mono)', fontWeight:700, color:'var(--text-hi)' }}>{i.counted_units}</div>
                <div style={{ ...S.td, fontFamily:'var(--font-mono)' }}>{i.book_units??'—'}</div>
                <div style={{ ...S.td, fontFamily:'var(--font-mono)', fontWeight:700, color: i.variance===0?'var(--green)':i.variance<0?'var(--red)':'var(--amber)' }}>
                  {i.variance==null?'—':i.variance>0?`+${i.variance}`:i.variance}
                </div>
                <div style={{ ...S.td, fontSize:11, color:'var(--text-lo)' }}>{i.notes||'—'}</div>
              </div>
            ))}
          </div>
      }
    </div>
  );

  return (
    <div style={S.page}>
      <h1 style={S.title}>Session History</h1>
      {sessions.length === 0
        ? <div style={S.empty}>No sessions recorded yet.</div>
        : sessions.map(s => (
          <button key={s.session_id} onClick={() => open(s)} style={S.sessionCard}>
            <div>
              <div style={S.sId}>{s.session_id}</div>
              <div style={S.sMeta}>{s.location_name||'No location'} · {s.started_by} · {s.started_at}</div>
            </div>
            <div style={{ display:'flex', gap:10, alignItems:'center' }}>
              <span style={S.pill}>{s.sku_count} SKUs</span>
              {s.variance_count > 0 && <span style={{ ...S.pill, color:'var(--red)', borderColor:'var(--red)33' }}>{s.variance_count} var</span>}
              <span style={{ ...S.pill, color: s.status==='completed'?'var(--green)':'var(--amber)', borderColor:'transparent' }}>{s.status}</span>
              <span style={{ color:'var(--text-lo)', fontSize:18 }}>›</span>
            </div>
          </button>
        ))
      }
    </div>
  );
}

const S = {
  page:    { padding:36, maxWidth:1100, margin:'0 auto', animation:'fadeUp .25s ease' },
  header:  { display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 },
  title:   { fontSize:24, fontWeight:700, color:'var(--text-hi)', marginBottom:4 },
  sub:     { fontSize:13, color:'var(--text-lo)', marginBottom:24 },
  meta:    { fontSize:12, color:'var(--text-lo)' },
  back:    { background:'none', border:'none', color:'var(--text-lo)', fontSize:12, cursor:'pointer', padding:'0 0 10px', display:'block' },
  btnPrimary:{ background:'var(--teal-dim)', border:'none', borderRadius:8, padding:'9px 18px', color:'#fff', fontWeight:600, fontSize:13, cursor:'pointer' },
  btnGhost:{ background:'none', border:'1px solid var(--border)', borderRadius:8, padding:'9px 18px', color:'var(--text-mid)', fontSize:13, cursor:'pointer' },
  sumRow:  { display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:24 },
  sumCard: { background:'var(--bg-panel)', border:'1px solid var(--border)', borderRadius:10, padding:'18px 20px', textAlign:'center' },
  table:   { background:'var(--bg-panel)', border:'1px solid var(--border)', borderRadius:10, overflow:'auto' },
  tHead:   { display:'grid', gridTemplateColumns:'2fr 1fr .6fr .7fr .7fr .7fr .6fr .6fr .7fr 1fr', padding:'10px 16px', background:'var(--bg-deep)', borderBottom:'1px solid var(--border)' },
  th:      { fontSize:10, color:'var(--text-lo)', textTransform:'uppercase', letterSpacing:'.06em' },
  tRow:    { display:'grid', gridTemplateColumns:'2fr 1fr .6fr .7fr .7fr .7fr .6fr .6fr .7fr 1fr', padding:'11px 16px', borderBottom:'1px solid var(--border)', alignItems:'center' },
  tdMain:  { gridColumn:'1' },
  tdName:  { fontSize:13, fontWeight:600, color:'var(--text-hi)', marginBottom:2 },
  tdId:    { fontSize:10, color:'var(--text-lo)', fontFamily:'var(--font-mono)' },
  td:      { fontSize:13, color:'var(--text-mid)' },
  sessionCard:{ display:'flex', justifyContent:'space-between', alignItems:'center', width:'100%', background:'var(--bg-panel)', border:'1px solid var(--border)', borderRadius:10, padding:'14px 18px', marginBottom:10, cursor:'pointer', textAlign:'left' },
  sId:     { fontSize:12, fontFamily:'var(--font-mono)', color:'var(--teal)', marginBottom:4 },
  sMeta:   { fontSize:11, color:'var(--text-lo)' },
  pill:    { fontSize:11, padding:'3px 9px', borderRadius:20, background:'var(--bg-card)', border:'1px solid var(--border)', color:'var(--text-mid)' },
  empty:   { textAlign:'center', color:'var(--text-lo)', padding:'60px 0', fontSize:14 },
};
