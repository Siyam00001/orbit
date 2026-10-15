// Orbit sync: one endpoint. Devices push changed keys and pull everything newer than their cursor.
// A "space" is SHA-256(sync code), so the raw code is never stored. Newest edit (t) wins per key.
const ORIGINS = ['https://siyam00001.github.io', 'http://localhost:4400', 'http://localhost:4401']; // + local test previews
const PAGE = 40;            // rows per pull (photos are large)
const MAX_VALUE = 1_900_000; // D1 row limit is ~2 MB; shrunk photos are far below this

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin') ?? '';
    const cors = {
      'access-control-allow-origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-methods': 'POST, OPTIONS',
      vary: 'origin',
    };
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/sync') return json({ error: 'not found' }, 404);

    const code = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!/^[A-Za-z0-9_-]{32,}$/.test(code)) return json({ error: 'missing or invalid sync code' }, 401);
    const space = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code)));

    const body = await request.json().catch(() => null);
    if (!body || !Number.isInteger(body.since) || !Array.isArray(body.changes) || body.changes.length > 100) return json({ error: 'bad request' }, 400);
    for (const c of body.changes) {
      if (typeof c?.k !== 'string' || c.k.length > 200 || !Number.isFinite(c.t)) return json({ error: 'bad change' }, 400);
      if (JSON.stringify(c.v ?? null).length > MAX_VALUE) return json({ error: `"${c.k}" is too large to sync` }, 413);
    }

    // seq is computed inside the batch (one D1 transaction), so it stays strictly increasing per space
    if (body.changes.length) {
      await env.DB.batch(body.changes.map(c => env.DB.prepare(
        `INSERT INTO docs (space, k, v, t, seq) VALUES (?1, ?2, ?3, ?4, (SELECT COALESCE(MAX(seq), 0) + 1 FROM docs WHERE space = ?1))
         ON CONFLICT (space, k) DO UPDATE SET v = excluded.v, t = excluded.t, seq = excluded.seq WHERE excluded.t > docs.t`,
      ).bind(space, c.k, JSON.stringify(c.v ?? null), Math.round(c.t))));
    }

    const { results } = await env.DB.prepare('SELECT k, v, t, seq FROM docs WHERE space = ?1 AND seq > ?2 ORDER BY seq LIMIT ?3')
      .bind(space, body.since, PAGE).all();
    return json({
      changes: results.map(r => ({ k: r.k, v: JSON.parse(r.v), t: r.t })),
      cursor: results.length ? results[results.length - 1].seq : body.since,
      more: results.length === PAGE,
    });
  },
};
