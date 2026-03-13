import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../App.jsx';

export default function Products() {
  const { toast } = useApp();
  const [products,  setProducts]  = useState([]);
  const [search,    setSearch]    = useState('');
  const [editing,   setEditing]   = useState(null);   // { sku_id, value }
  const [saving,    setSaving]    = useState(false);

  const load = useCallback(async (q = '') => {
    const prods = await window.ss.db.getProducts(q);
    setProducts(prods);
  }, []);

  useEffect(() => { load(); }, []);

  async function saveWeight(sku_id) {
    const val = parseFloat(editing.value);
    if (isNaN(val) || val <= 0) { toast('Enter a valid weight > 0', 'warn'); return; }
    setSaving(true);
    await window.ss.db.updateWeight({ sku_id, avg_unit_weight: val });
    setEditing(null);
    await load(search);
    toast('Unit weight updated', 'success');
    setSaving(false);
  }

  const cats    = [...new Set(products.map(p => p.category || 'Uncategorized'))].sort();
  const noWeight= products.filter(p => !p.avg_unit_weight).length;

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div>
          <h1 style={S.title}>Product Catalog</h1>
          <div style={S.sub}>{products.length} products · {noWeight > 0 && <span style={{ color: 'var(--amber)' }}>{noWeight} missing unit weight</span>}</div>
        </div>
      </div>

      {noWeight > 0 && (
        <div style={S.warning}>
          ⚠ {noWeight} products have no average unit weight set. These cannot be counted until a weight is entered below.
        </div>
      )}

      <input style={S.search} placeholder="Search name, category, SKU ID…" value={search} onChange={e => { setSearch(e.target.value); load(e.target.value); }} />

      {cats.map(cat => {
        const catProds = products.filter(p => (p.category || 'Uncategorized') === cat && (
          !search || p.sku_name.toLowerCase().includes(search.toLowerCase()) || p.sku_id.toLowerCase().includes(search.toLowerCase())
        ));
        if (catProds.length === 0) return null;
        return (
          <div key={cat} style={{ marginBottom: 28 }}>
            <div style={S.catHead}>{cat}</div>
            <div style={S.table}>
              <div style={S.tableHead}>
                <span style={{ flex: 2 }}>Product</span>
                <span style={{ flex: 1 }}>Brand</span>
                <span style={{ width: 80, textAlign: 'center' }}>Book Qty</span>
                <span style={{ width: 160, textAlign: 'center' }}>Avg Unit Weight</span>
              </div>
              {catProds.map(p => (
                <div key={p.sku_id} style={S.tableRow}>
                  <div style={{ flex: 2 }}>
                    <div style={S.prodName}>{p.sku_name}</div>
                    <div style={S.prodId}>{p.sku_id}</div>
                  </div>
                  <div style={{ flex: 1, fontSize: 12, color: 'var(--text-lo)' }}>{p.brand || '—'}</div>
                  <div style={{ width: 80, textAlign: 'center', fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text-mid)' }}>{p.book_quantity ?? '—'}</div>
                  <div style={{ width: 160, textAlign: 'center' }}>
                    {editing?.sku_id === p.sku_id
                      ? <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                          <input
                            type="number"
                            step="0.01"
                            value={editing.value}
                            onChange={e => setEditing(ed => ({ ...ed, value: e.target.value }))}
                            style={S.inlineInput}
                            autoFocus
                            onKeyDown={e => { if (e.key === 'Enter') saveWeight(p.sku_id); if (e.key === 'Escape') setEditing(null); }}
                          />
                          <button onClick={() => saveWeight(p.sku_id)} style={S.saveBtnSm} disabled={saving}>✓</button>
                          <button onClick={() => setEditing(null)} style={S.cancelBtnSm}>✗</button>
                        </div>
                      : <button
                          onClick={() => setEditing({ sku_id: p.sku_id, value: p.avg_unit_weight || '' })}
                          style={{ ...S.weightBtn, color: p.avg_unit_weight ? 'var(--teal)' : 'var(--amber)', borderColor: p.avg_unit_weight ? 'var(--teal)33' : 'var(--amber)33' }}
                        >
                          {p.avg_unit_weight ? `${p.avg_unit_weight}g` : 'Set weight'}
                        </button>
                    }
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {products.length === 0 && (
        <div style={S.empty}>
          No products loaded. Go to <strong>New Count → Sync Dutchie</strong> to import your catalog.
        </div>
      )}
    </div>
  );
}

const S = {
  page:      { padding: 36, maxWidth: 980, margin: '0 auto', animation: 'fadeUp .25s ease' },
  header:    { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  title:     { fontSize: 24, fontWeight: 700, color: 'var(--text-hi)', marginBottom: 4 },
  sub:       { fontSize: 13, color: 'var(--text-lo)' },
  warning:   { background: '#2A1A00', border: '1px solid var(--amber)44', borderRadius: 8, padding: '10px 16px', fontSize: 13, color: 'var(--amber)', marginBottom: 16 },
  search:    { width: '100%', background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', color: 'var(--text-hi)', fontSize: 13, marginBottom: 24, boxSizing: 'border-box' },
  catHead:   { fontSize: 11, color: 'var(--teal)', textTransform: 'uppercase', letterSpacing: '.08em', fontFamily: 'var(--font-mono)', marginBottom: 8 },
  table:     { background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' },
  tableHead: { display: 'flex', alignItems: 'center', padding: '9px 16px', background: 'var(--bg-deep)', borderBottom: '1px solid var(--border)', fontSize: 10, color: 'var(--text-lo)', textTransform: 'uppercase', letterSpacing: '.06em' },
  tableRow:  { display: 'flex', alignItems: 'center', padding: '11px 16px', borderBottom: '1px solid var(--border)' },
  prodName:  { fontSize: 13, fontWeight: 600, color: 'var(--text-hi)', marginBottom: 2 },
  prodId:    { fontSize: 10, color: 'var(--text-lo)', fontFamily: 'var(--font-mono)' },
  weightBtn: { background: 'none', border: '1px solid', borderRadius: 6, padding: '4px 12px', fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600, cursor: 'pointer' },
  inlineInput:{ width: 72, background: 'var(--bg-deep)', border: '1px solid var(--teal)', borderRadius: 6, padding: '4px 8px', color: 'var(--teal)', fontSize: 12, fontFamily: 'var(--font-mono)', textAlign: 'center' },
  saveBtnSm: { background: 'var(--teal-dim)', border: 'none', borderRadius: 6, padding: '4px 8px', color: '#fff', fontSize: 12, cursor: 'pointer' },
  cancelBtnSm:{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', color: 'var(--text-lo)', fontSize: 12, cursor: 'pointer' },
  empty:     { textAlign: 'center', color: 'var(--text-lo)', padding: '60px 0', fontSize: 14 },
};
