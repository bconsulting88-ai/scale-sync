// ─────────────────────────────────────────────────────────────────────────────
// Dutchie Enterprise API — GraphQL
//
// Auth:    OAuth2 client_credentials → Bearer token (24h, auto-refresh)
// Catalog: inventoryItems query — paginated at 100 items/page
// Push:    inventoryAdjustment mutation — reason: PHYSICAL_COUNT
//
// Credentials required (stored encrypted in electron-store via Settings UI):
//   clientId     — from Dutchie Partner Portal → API Access
//   clientSecret — from Dutchie Partner Portal → API Access
//   dispensaryId — your dispensary's Dutchie ID (Back Office → Settings → General)
// ─────────────────────────────────────────────────────────────────────────────

const AUTH_URL    = 'https://auth.dutchie.com/oauth/token';
const GQL_URL     = 'https://plus.dutchie.com/plus/2021-07/graphql';
const PAGE_SIZE   = 100;

export class DutchieService {
  constructor({ clientId, clientSecret, dispensaryId }) {
    this.clientId     = clientId;
    this.clientSecret = clientSecret;
    this.dispensaryId = dispensaryId;
    this.token        = null;
    this.tokenExp     = 0;
  }

  // ── Auth ────────────────────────────────────────────────────────────────────

  async authenticate() {
    try {
      const res = await fetch(AUTH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type:    'client_credentials',
          client_id:     this.clientId,
          client_secret: this.clientSecret,
          audience:      'https://api.dutchie.com'
        }).toString(),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) { const t = await res.text(); throw new Error(`HTTP ${res.status}: ${t}`); }
      const data    = await res.json();
      this.token    = data.access_token;
      this.tokenExp = Date.now() + (data.expires_in - 300) * 1000; // 5min buffer
      return { ok: true };
    } catch (e) {
      const msg = e.response?.data?.error_description || e.response?.data?.message || e.message;
      return { ok: false, error: `Dutchie auth failed: ${msg}` };
    }
  }

  async ensureToken() {
    if (!this.token || Date.now() >= this.tokenExp) {
      const r = await this.authenticate();
      if (!r.ok) throw new Error(r.error);
    }
  }

  // ── GraphQL with retry + auto re-auth ──────────────────────────────────────

  async gql(query, variables = {}, retries = 2) {
    await this.ensureToken();
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(GQL_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, variables }),
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) { const t = await res.text(); throw new Error(`HTTP ${res.status}: ${t}`); }
        const body = await res.json();
        if (body.errors?.length) {
          const msg = body.errors.map(e => e.message).join('; ');
          if ((msg.includes('Unauthorized') || msg.includes('401')) && attempt < retries) {
            await this.authenticate(); continue;
          }
          throw new Error(`Dutchie GQL: ${msg}`);
        }
        return body.data;
      } catch (e) {
        if (attempt === retries) throw e;
        await new Promise(r => setTimeout(r, 500 * 2 ** attempt));
      }
    }
  }

  // ── Validate dispensary ────────────────────────────────────────────────────

  async getDispensary() {
    const data = await this.gql(`
      query GetDispensary($id: ID!) {
        dispensary(id: $id) { id name address { city state } status }
      }
    `, { id: this.dispensaryId });
    const d = data?.dispensary;
    if (!d) return { ok: false, error: 'Dispensary not found. Check your Dispensary ID.' };
    return { ok: true, dispensary: d };
  }

  // ── Inventory — full paginated pull ───────────────────────────────────────
  //
  // Dutchie inventoryItems fields we care about:
  //   id            — inventory item ID (used for adjustment push)
  //   quantity      — book quantity on hand
  //   unit          — GRAM | EACH | MILLIGRAM
  //   product {
  //     id, name, category, subcategory
  //     brand { name }
  //     unitWeightGrams   — package weight in grams (most reliable for avg weight)
  //     unitValue         — numeric package size (e.g. 3.5 for an eighth)
  //     strainType        — INDICA | SATIVA | HYBRID | CBD | NA
  //   }

  async getInventory() {
    const QUERY = `
      query GetInventory($dispensaryId: ID!, $limit: Int!, $offset: Int!) {
        inventoryItems(dispensaryId: $dispensaryId, limit: $limit, offset: $offset) {
          totalCount
          items {
            id
            quantity
            unit
            product {
              id name category subcategory strainType
              brand { name }
              unitWeightGrams
              unitValue
            }
          }
        }
      }
    `;

    const all = [];
    let offset  = 0;
    let total   = null;

    do {
      const data = await this.gql(QUERY, { dispensaryId: this.dispensaryId, limit: PAGE_SIZE, offset });
      const page = data?.inventoryItems;
      if (!page) break;
      total = page.totalCount ?? 0;
      all.push(...(page.items || []));
      offset += PAGE_SIZE;
    } while (offset < total);

    return {
      ok:       true,
      products: all.map(item => this._normalise(item)),
      total:    all.length
    };
  }

  // Normalise Dutchie item → ScaleSync internal product format
  // avg_unit_weight priority:
  //   1. product.unitWeightGrams  (Dutchie's dedicated weight field)
  //   2. product.unitValue        (package size) when unit = GRAM
  //   3. null                     (staff enters manually)
  _normalise(raw) {
    const p   = raw.product || {};
    let   wt  = null;
    if (p.unitWeightGrams > 0)                    wt = +p.unitWeightGrams;
    else if (raw.unit === 'GRAM' && p.unitValue > 0) wt = +p.unitValue;

    return {
      sku_id:          raw.id,
      sku_name:        p.name || 'Unknown Product',
      category:        p.category || 'Uncategorized',
      subcategory:     p.subcategory || null,
      brand:           p.brand?.name || null,
      avg_unit_weight: wt,
      book_quantity:   typeof raw.quantity === 'number' ? raw.quantity : 0,
      unit_of_measure: raw.unit || 'EACH',
    };
  }

  // ── Push inventory count ───────────────────────────────────────────────────
  //
  // D-02 fix: caller must complete session AFTER this resolves successfully.
  // D-05 fix: accepts onItemPushed callback so caller can mark each item in DB
  //           as it succeeds, rather than all-or-nothing after the full batch.
  // P-03 fix: runs up to CONCURRENCY mutations in parallel instead of serial.

  async pushCounts(items, sessionId, { onItemPushed } = {}) {
    const CONCURRENCY = 5;
    const MUTATION = `
      mutation AdjustInventory(
        $dispensaryId:    ID!
        $inventoryItemId: ID!
        $quantity:        Float!
        $reason:          InventoryAdjustmentReason!
        $notes:           String
      ) {
        inventoryAdjustment(
          dispensaryId:    $dispensaryId
          inventoryItemId: $inventoryItemId
          quantity:        $quantity
          reason:          $reason
          notes:           $notes
        ) { id quantity adjustedAt }
      }
    `;

    const pushed = [], errors = [];

    // Process items in chunks of CONCURRENCY
    for (let i = 0; i < items.length; i += CONCURRENCY) {
      const chunk = items.slice(i, i + CONCURRENCY);
      await Promise.all(chunk.map(async item => {
        try {
          await this.gql(MUTATION, {
            dispensaryId:    this.dispensaryId,
            inventoryItemId: item.sku_id,
            quantity:        item.counted_units,
            reason:          'PHYSICAL_COUNT',
            notes:           `ScaleSync ${sessionId}${item.notes ? ' — ' + item.notes : ''}`
          });
          pushed.push(item.sku_id);
          // D-05: mark this specific item pushed immediately
          if (onItemPushed) await onItemPushed(item.sku_id);
        } catch (e) {
          errors.push({ sku_id: item.sku_id, name: item.sku_name, error: e.message });
        }
      }));
    }

    return { ok: errors.length === 0, pushed, errors, total: items.length };
  }
}

// ── Helper: build DutchieService from electron-store settings ─────────────────
export async function dutchieFromSettings() {
  const cfg = await window.ss.settings.get('dutchie');
  if (!cfg?.clientId || !cfg?.clientSecret || !cfg?.dispensaryId) {
    throw new Error('Dutchie credentials not configured. Go to Settings → POS.');
  }
  return new DutchieService(cfg);
}
