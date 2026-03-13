import { useState, useEffect } from 'react';
import { useApp } from '../App.jsx';
import { DutchieService } from '../services/dutchie.js';

export default function Settings() {
  const { settings, setSettings, toast } = useApp();

  const [tab,      setTab]      = useState('dutchie');
  const [dutchie,  setDutchie]  = useState({ clientId: '', clientSecret: '', dispensaryId: '' });
  const [user,     setUser]     = useState({ userName: '', locationName: '' });
  const [saving,   setSaving]   = useState(false);
  const [testing,  setTesting]  = useState(false);
  const [testResult,setTestResult]=useState(null);
  const [showSec,  setShowSec]  = useState(false);

  useEffect(() => {
    window.ss.settings.get('dutchie').then(d => d && setDutchie(d));
    window.ss.settings.get('userName').then(v => v && setUser(u => ({ ...u, userName: v })));
    window.ss.settings.get('locationName').then(v => v && setUser(u => ({ ...u, locationName: v })));
  }, []);

  async function saveDutchie() {
    setSaving(true);
    await window.ss.settings.setMany({ dutchie, userName: user.userName, locationName: user.locationName });
    setSettings({ dutchie, userName: user.userName, locationName: user.locationName });
    toast('Dutchie credentials saved', 'success');
    setSaving(false);
  }

  async function testDutchie() {
    if (!dutchie.clientId || !dutchie.clientSecret || !dutchie.dispensaryId) {
      toast('Fill in all three fields first', 'warn'); return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const svc   = new DutchieService(dutchie);
      const auth  = await svc.authenticate();
      if (!auth.ok) throw new Error(auth.error);
      const disp  = await svc.getDispensary();
      if (!disp.ok) throw new Error(disp.error);
      setTestResult({ ok: true, msg: `Connected → ${disp.dispensary.name}, ${disp.dispensary.address?.city} ${disp.dispensary.address?.state}` });
    } catch (e) {
      setTestResult({ ok: false, msg: e.message });
    }
    setTesting(false);
  }

  async function saveUser() {
    setSaving(true);
    await window.ss.settings.setMany({ userName: user.userName, locationName: user.locationName });
    setSettings({ userName: user.userName, locationName: user.locationName });
    toast('User settings saved', 'success');
    setSaving(false);
  }

  return (
    <div style={S.page}>
      <h1 style={S.title}>Settings</h1>

      <div style={S.tabs}>
        {[['dutchie','Dutchie POS'],['user','User & Location'],['about','About']].map(([id,label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ ...S.tab, ...(tab === id ? S.tabActive : {}) }}>{label}</button>
        ))}
      </div>

      {/* ── Dutchie ─────────────────────────────────────────────────────────── */}
      {tab === 'dutchie' && (
        <div style={S.section}>
          <div style={S.callout}>
            <strong style={{ color: 'var(--teal)' }}>Where to get credentials</strong><br />
            Log into your Dutchie Back Office → Settings → API Access → Create Application.<br />
            Copy the <em>Client ID</em> and <em>Client Secret</em>. Your <em>Dispensary ID</em> is in<br />
            Back Office → Settings → General → About This Dispensary.
          </div>

          {[
            { key: 'clientId',     label: 'Client ID',      placeholder: 'dutchie_client_xxxxxxxx',           type: 'text' },
            { key: 'clientSecret', label: 'Client Secret',  placeholder: '••••••••••••••••••••••••',          type: showSec ? 'text' : 'password' },
            { key: 'dispensaryId', label: 'Dispensary ID',  placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', type: 'text' },
          ].map(f => (
            <div key={f.key} style={S.field}>
              <div style={S.fieldLabel}>{f.label}</div>
              <div style={{ position: 'relative' }}>
                <input
                  type={f.type}
                  value={dutchie[f.key]}
                  onChange={e => setDutchie(d => ({ ...d, [f.key]: e.target.value }))}
                  style={S.input}
                  placeholder={f.placeholder}
                  spellCheck={false}
                  autoComplete="off"
                />
                {f.key === 'clientSecret' && (
                  <button onClick={() => setShowSec(s => !s)} style={S.showBtn}>{showSec ? 'Hide' : 'Show'}</button>
                )}
              </div>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button onClick={testDutchie} style={S.btnGhost} disabled={testing}>{testing ? 'Testing…' : 'Test Connection'}</button>
            <button onClick={saveDutchie} style={S.btnPrimary} disabled={saving}>{saving ? 'Saving…' : 'Save Credentials'}</button>
          </div>

          {testResult && (
            <div style={{ ...S.testResult, background: testResult.ok ? '#0D2A1A' : '#2A0D0D', borderColor: testResult.ok ? 'var(--green)44' : 'var(--red)44' }}>
              <span style={{ color: testResult.ok ? 'var(--green)' : 'var(--red)', marginRight: 8 }}>{testResult.ok ? '✓' : '✗'}</span>
              {testResult.msg}
            </div>
          )}

          <div style={S.secNote}>
            Credentials are stored in your OS-level encrypted settings store. They never leave your machine except when making direct HTTPS calls to Dutchie's API servers.
          </div>
        </div>
      )}

      {/* ── User ─────────────────────────────────────────────────────────────── */}
      {tab === 'user' && (
        <div style={S.section}>
          {[
            { key: 'userName',     label: 'Your Name',      placeholder: 'Used on count audit trail' },
            { key: 'locationName', label: 'Location Name',  placeholder: 'e.g. Main Street Dispensary' },
          ].map(f => (
            <div key={f.key} style={S.field}>
              <div style={S.fieldLabel}>{f.label}</div>
              <input value={user[f.key]} onChange={e => setUser(u => ({ ...u, [f.key]: e.target.value }))} style={S.input} placeholder={f.placeholder} />
            </div>
          ))}
          <button onClick={saveUser} style={S.btnPrimary} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      )}

      {/* ── About ─────────────────────────────────────────────────────────────── */}
      {tab === 'about' && (
        <div style={S.section}>
          <div style={S.aboutCard}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>⬡</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--teal)', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>ScaleSync v1.0</div>
            <div style={{ fontSize: 13, color: 'var(--text-lo)', marginBottom: 20 }}>Cannabis Inventory Automation — Phase 1 MVP</div>
            <div style={{ fontSize: 13, color: 'var(--text-mid)', lineHeight: 1.8 }}>
              Scale: <strong style={{ color: 'var(--teal)' }}>OHAUS Ranger Count 3000</strong><br />
              POS:   <strong style={{ color: 'var(--teal)' }}>Dutchie Enterprise API</strong><br />
              Local DB: SQLite · Encrypted settings: electron-store
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const S = {
  page:      { padding: 40, maxWidth: 600, margin: '0 auto', animation: 'fadeUp .25s ease' },
  title:     { fontSize: 24, fontWeight: 700, color: 'var(--text-hi)', marginBottom: 24 },
  tabs:      { display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 28 },
  tab:       { background: 'none', border: 'none', padding: '10px 20px', color: 'var(--text-lo)', fontSize: 13, fontWeight: 500, borderBottom: '2px solid transparent', marginBottom: -1, cursor: 'pointer' },
  tabActive: { color: 'var(--teal)', borderBottomColor: 'var(--teal)' },
  section:   {},
  callout:   { background: 'var(--bg-panel)', border: '1px solid var(--teal-glow)', borderRadius: 10, padding: '14px 18px', fontSize: 12, color: 'var(--text-mid)', lineHeight: 1.8, marginBottom: 24 },
  field:     { marginBottom: 18 },
  fieldLabel:{ fontSize: 11, color: 'var(--text-lo)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6, fontFamily: 'var(--font-mono)' },
  input:     { width: '100%', background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', color: 'var(--text-hi)', fontSize: 13, boxSizing: 'border-box' },
  showBtn:   { position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-lo)', fontSize: 12, cursor: 'pointer' },
  btnPrimary:{ background: 'var(--teal-dim)', border: 'none', borderRadius: 8, padding: '10px 24px', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' },
  btnGhost:  { background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 20px', color: 'var(--text-mid)', fontSize: 13, cursor: 'pointer' },
  testResult:{ marginTop: 14, padding: '12px 16px', borderRadius: 8, border: '1px solid', fontSize: 13 },
  secNote:   { marginTop: 20, fontSize: 11, color: 'var(--text-lo)', lineHeight: 1.7 },
  aboutCard: { textAlign: 'center', padding: '48px 32px', background: 'var(--bg-panel)', borderRadius: 12, border: '1px solid var(--border)' },
};
