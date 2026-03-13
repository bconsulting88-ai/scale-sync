import { useState, useEffect, useCallback, createContext, useContext, useRef } from 'react';
import Dashboard      from './components/Dashboard.jsx';
import CountSession   from './components/CountSession.jsx';
import Products       from './components/Products.jsx';
import History        from './components/History.jsx';
import ScaleSetup     from './components/ScaleSetup.jsx';
import Settings       from './components/Settings.jsx';

// ─── Global App Context ───────────────────────────────────────────────────────

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

// ─── SVG Icons (must be defined before NAV array) ─────────────────────────────
function HexLogo() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M12 2L21.196 7V17L12 22L2.804 17V7L12 2Z" stroke="var(--teal)" strokeWidth="1.5" fill="var(--teal-glow)" />
      <path d="M12 7L16.5 9.75V15.25L12 18L7.5 15.25V9.75L12 7Z" fill="var(--teal)" opacity=".7" />
    </svg>
  );
}
function IconDash()  { return <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>; }
function IconCount() { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 2"/></svg>; }
function IconProd()  { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="12" height="10" rx="1"/><path d="M5 3V2M11 3V2M2 7h12"/></svg>; }
function IconHist()  { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 4h12M2 8h8M2 12h5"/></svg>; }
function IconScale() { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2v1M8 3L5 9h6L8 3z"/><path d="M3 12h10M5 9l-2 3M11 9l2 3"/></svg>; }
function IconCog()   { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="2.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41"/></svg>; }

// ─── Nav items ────────────────────────────────────────────────────────────────

const NAV = [
  { id: 'dashboard', label: 'Dashboard',   icon: <IconDash /> },
  { id: 'count',     label: 'New Count',   icon: <IconCount /> },
  { id: 'products',  label: 'Products',    icon: <IconProd /> },
  { id: 'history',   label: 'History',     icon: <IconHist /> },
  { id: 'scale',     label: 'Scale Setup', icon: <IconScale /> },
  { id: 'settings',  label: 'Settings',    icon: <IconCog /> },
];

const VIEWS = {
  dashboard: Dashboard,
  count:     CountSession,
  products:  Products,
  history:   History,
  scale:     ScaleSetup,
  settings:  Settings,
};

// ─── Root App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [view,       setView]       = useState('dashboard');
  const [settings,   setSettings]   = useState({});
  const [scaleData,  setScaleData]  = useState(null);
  const [connected,  setConnected]  = useState(false);
  const [toasts,     setToasts]     = useState([]);
  const toastId = useRef(0);

  // ── Boot: load settings ───────────────────────────────────────────────────
  useEffect(() => {
    window.ss.settings.getAll().then(s => setSettings(s || {}));
  }, []);

  // ── Toast (defined before scale listeners useEffect so closure captures it) ─
  const toast = useCallback((msg, type = 'info', ms = 3500) => {
    const id = ++toastId.current;
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), ms);
  }, []);

  // ── Scale listeners ───────────────────────────────────────────────────────
  useEffect(() => {
    window.ss.scale.onData(d => {
      if (d.weight !== null) setScaleData(d);
    });
    window.ss.scale.onDisconnected(() => {
      setConnected(false);
      setScaleData(null);
      toast('Scale disconnected', 'warn');
    });
    window.ss.scale.onError(msg => toast(`Scale error: ${msg}`, 'error'));
    return () => window.ss.scale.offAll();
  }, [toast]);

  const ctx = {
    view, setView,
    settings, setSettings: (upd) => setSettings(s => ({ ...s, ...upd })),
    scaleData, connected, setConnected,
    toast
  };

  const ActiveView = VIEWS[view] || Dashboard;

  return (
    <Ctx.Provider value={ctx}>
      <div style={S.shell}>

        {/* ── Sidebar ── */}
        <aside style={S.sidebar}>
          <div style={S.brand}>
            <HexLogo />
            <span style={S.brandText}>ScaleSync</span>
          </div>

          <nav style={S.nav}>
            {NAV.map(item => (
              <button
                key={item.id}
                onClick={() => setView(item.id)}
                style={{ ...S.navBtn, ...(view === item.id ? S.navBtnActive : {}) }}
              >
                <span style={S.navIcon}>{item.icon}</span>
                <span style={S.navLabel}>{item.label}</span>
                {view === item.id && <span style={S.navPip} />}
              </button>
            ))}
          </nav>

          <div style={S.sideFooter}>
            {/* Scale status */}
            <div style={S.scaleStatus}>
              <span style={{ ...S.dot, background: connected ? 'var(--teal)' : 'var(--text-lo)' }} />
              <span style={{ color: connected ? 'var(--teal)' : 'var(--text-lo)', fontSize: 11 }}>
                {connected ? 'OHAUS Connected' : 'No Scale'}
              </span>
            </div>

            {/* Live weight readout */}
            {connected && scaleData && (
              <div style={S.weightBox}>
                <div style={S.weightNum}>
                  {scaleData.weight !== null ? scaleData.weight.toFixed(1) : '—'}
                </div>
                <div style={S.weightUnit}>grams</div>
                <div style={{
                  ...S.stabFlag,
                  color:      scaleData.stable ? 'var(--green)' : 'var(--amber)',
                  borderColor:scaleData.stable ? 'var(--green)' : 'var(--amber)',
                }}>
                  {scaleData.overload ? 'OVERLOAD' : scaleData.stable ? '● STABLE' : '○ MOTION'}
                </div>
              </div>
            )}

            {/* POS badge */}
            <div style={S.posBadge}>
              <span style={S.posLabel}>POS</span>
              <span style={S.posName}>{settings.dutchie?.dispensaryId ? 'DUTCHIE ✓' : 'NOT CONFIGURED'}</span>
            </div>
          </div>
        </aside>

        {/* ── Main ── */}
        <main style={S.main}>
          <ActiveView />
        </main>

        {/* ── Toasts ── */}
        <div style={S.toastStack}>
          {toasts.map(t => (
            <div key={t.id} style={{ ...S.toast, borderLeftColor: TOAST_COLOR[t.type] }}>
              <span style={{ color: TOAST_COLOR[t.type], marginRight: 8 }}>{TOAST_ICON[t.type]}</span>
              {t.msg}
            </div>
          ))}
        </div>

      </div>
    </Ctx.Provider>
  );
}

const TOAST_COLOR = { info: 'var(--teal)', success: 'var(--green)', warn: 'var(--amber)', error: 'var(--red)' };
const TOAST_ICON  = { info: '●', success: '✓', warn: '⚠', error: '✗' };

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = {
  shell: {
    display: 'flex', height: '100vh', overflow: 'hidden',
    background: 'var(--bg-deep)', fontFamily: 'var(--font-sans)'
  },
  sidebar: {
    width: 210, flexShrink: 0, display: 'flex', flexDirection: 'column',
    background: 'var(--bg-panel)', borderRight: '1px solid var(--border)',
    userSelect: 'none'
  },
  brand: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '24px 18px 22px', borderBottom: '1px solid var(--border)'
  },
  brandText: { fontSize: 15, fontWeight: 700, letterSpacing: '.04em', color: 'var(--text-hi)', fontFamily: 'var(--font-mono)' },
  nav: { flex: 1, padding: '12px 0' },
  navBtn: {
    display: 'flex', alignItems: 'center', gap: 10, width: '100%',
    padding: '10px 18px', background: 'none', border: 'none',
    color: 'var(--text-lo)', fontSize: 13, fontWeight: 500,
    position: 'relative', transition: 'color .15s, background .15s',
    cursor: 'pointer'
  },
  navBtnActive: { color: 'var(--text-hi)', background: 'var(--bg-card)' },
  navIcon: { width: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  navLabel: { flex: 1, textAlign: 'left' },
  navPip: {
    width: 3, height: '60%', background: 'var(--teal)',
    borderRadius: 2, position: 'absolute', left: 0, top: '20%'
  },
  sideFooter: { borderTop: '1px solid var(--border)', padding: '14px 0 0' },
  scaleStatus: { display: 'flex', alignItems: 'center', gap: 8, padding: '0 18px 12px' },
  dot: { width: 7, height: 7, borderRadius: '50%', flexShrink: 0 },
  weightBox: {
    margin: '0 12px 12px', background: 'var(--bg-card)', borderRadius: 8,
    padding: '12px', border: '1px solid var(--teal-glow)', textAlign: 'center'
  },
  weightNum: { fontSize: 32, fontWeight: 700, color: 'var(--teal)', fontFamily: 'var(--font-mono)', letterSpacing: '-.02em' },
  weightUnit: { fontSize: 11, color: 'var(--text-lo)', marginTop: 2 },
  stabFlag: { display: 'inline-block', marginTop: 8, fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600, padding: '2px 8px', border: '1px solid', borderRadius: 20, letterSpacing: '.06em' },
  posBadge: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    margin: '0 12px 12px', padding: '8px 12px', background: 'var(--bg-deep)',
    borderRadius: 6, border: '1px solid var(--border)'
  },
  posLabel: { fontSize: 9, color: 'var(--text-lo)', fontFamily: 'var(--font-mono)', letterSpacing: '.08em' },
  posName:  { fontSize: 10, fontWeight: 700, color: 'var(--teal-dim)', fontFamily: 'var(--font-mono)' },
  main: { flex: 1, overflow: 'auto', background: 'var(--bg-deep)' },
  toastStack: { position: 'fixed', bottom: 24, right: 24, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 9999 },
  toast: {
    background: 'var(--bg-card)', border: '1px solid var(--border)', borderLeft: '3px solid',
    borderRadius: 8, padding: '10px 16px', fontSize: 13, color: 'var(--text-hi)',
    display: 'flex', alignItems: 'center', animation: 'slideIn .2s ease',
    boxShadow: '0 4px 24px #000A', maxWidth: 360
  }
};



