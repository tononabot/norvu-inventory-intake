const ALLOWED_ORIGINS = new Set([
  'https://tononabot.github.io',
  'http://127.0.0.1:4199',
  'http://localhost:4199'
]);

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : 'https://tononabot.github.io';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Workspace-Key, X-Intake-Key',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'Cache-Control': 'no-store'
  };
}

function json(request, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function randomToken(bytes = 18) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function workspaceIdFromUrl(url) {
  const raw = url.searchParams.get('u') || url.searchParams.get('workspace') || '';
  return slugify(raw);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function emailWorkspaceId(email) {
  return `email-${(await sha256(email)).slice(0, 24)}`;
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function emptyData() {
  return { version: 1, updatedAt: null, updatedBy: '', items: [] };
}

function workspaceKey(id) {
  return `workspace:${id}`;
}

function normalizePayload(payload) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    updatedBy: String(payload.deviceLabel || '').slice(0, 80),
    items: items.map((item) => ({
      id: String(item.id || crypto.randomUUID()),
      category: String(item.category || '').slice(0, 120),
      name: String(item.name || '').slice(0, 220),
      qty: Number.isFinite(Number(item.qty)) ? Number(item.qty) : 0,
      source: String(item.source || '').slice(0, 120),
      location: String(item.location || 'Principal').slice(0, 120),
      barcode: String(item.barcode || '').slice(0, 64),
      cost: Math.max(0, Math.round(Number(item.cost || 0))),
      price: Math.max(0, Math.round(Number(item.price || 0))),
      notes: String(item.notes || '').slice(0, 500),
      createdAt: String(item.createdAt || new Date().toISOString()),
      updatedAt: String(item.updatedAt || new Date().toISOString())
    }))
  };
}

async function readWorkspace(env, id) {
  return env.INVENTORY_KV.get(workspaceKey(id), 'json');
}

async function writeWorkspace(env, id, record) {
  await env.INVENTORY_KV.put(workspaceKey(id), JSON.stringify(record));
}

async function authorize(request, env, id) {
  const record = await readWorkspace(env, id);
  if (!record) return { ok: false, status: 404, error: 'No encontramos ese espacio de trabajo. Revisa el link o crea uno nuevo.' };

  const legacyExpected = env.INTAKE_KEY || '';
  const legacyProvided = request.headers.get('X-Intake-Key') || '';
  if (legacyExpected && legacyProvided && legacyExpected === legacyProvided) return { ok: true, record };

  const provided = request.headers.get('X-Workspace-Key') || '';
  if (!provided) return { ok: false, status: 401, error: 'No se encontró la llave de sincronización de esta cuenta. Inicia sesión nuevamente con el correo.' };
  const providedHash = await sha256(`${id}:${provided}`);
  if (providedHash !== record.secretHash) return { ok: false, status: 401, error: 'La llave de sincronización no coincide. Cierra sesión e inicia nuevamente con el correo correcto.' };
  return { ok: true, record };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(request) });
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json(request, { ok: true, service: 'norvu-inventory-intake-api', storage: 'cloudflare-kv', auth: 'email-or-workspace-key' });
    }

    if (url.pathname === '/login' && request.method === 'POST') {
      let payload = {};
      try { payload = await request.json(); } catch { payload = {}; }
      const email = normalizeEmail(payload.email);
      if (!isValidEmail(email)) return json(request, { ok: false, error: 'Correo inválido.' }, 400);
      const id = await emailWorkspaceId(email);
      let record = await readWorkspace(env, id);
      const now = new Date().toISOString();
      const key = email;
      if (!record) {
        record = {
          id,
          label: email,
          email,
          createdAt: now,
          createdBy: String(payload.deviceLabel || '').slice(0, 80),
          secretHash: await sha256(`${id}:${key}`),
          data: emptyData()
        };
        await writeWorkspace(env, id, record);
      }
      return json(request, { ok: true, workspace: { id, key, label: record.label || email, email } }, record.createdAt === now ? 201 : 200);
    }

    if (url.pathname === '/workspace' && request.method === 'POST') {
      let payload = {};
      try { payload = await request.json(); } catch { payload = {}; }
      let id = slugify(payload.workspaceId || payload.name || payload.label);
      if (!id || id.length < 3) id = `equipo-${randomToken(4)}`;

      let finalId = id;
      let suffix = 1;
      while (await readWorkspace(env, finalId)) {
        suffix += 1;
        finalId = `${id}-${suffix}`.slice(0, 56);
      }

      const secret = randomToken(24);
      const now = new Date().toISOString();
      const record = {
        id: finalId,
        label: String(payload.label || payload.name || finalId).slice(0, 80),
        createdAt: now,
        createdBy: String(payload.deviceLabel || '').slice(0, 80),
        secretHash: await sha256(`${finalId}:${secret}`),
        data: emptyData()
      };
      await writeWorkspace(env, finalId, record);
      return json(request, { ok: true, workspace: { id: finalId, key: secret, label: record.label } }, 201);
    }

    if (url.pathname !== '/inventory') return json(request, { ok: false, error: 'Not found' }, 404);

    const id = workspaceIdFromUrl(url);
    if (!id) return json(request, { ok: false, error: 'Falta el código del equipo en la URL. Usa un link con ?u=nombre-del-equipo.' }, 400);

    const auth = await authorize(request, env, id);
    if (!auth.ok) return json(request, { ok: false, error: auth.error }, auth.status);

    if (request.method === 'GET') {
      return json(request, { ok: true, workspace: { id, label: auth.record.label || id }, data: auth.record.data || emptyData() });
    }

    if (request.method === 'POST') {
      let payload;
      try { payload = await request.json(); }
      catch { return json(request, { ok: false, error: 'JSON inválido.' }, 400); }
      const normalized = normalizePayload(payload || {});
      const record = { ...auth.record, data: normalized, updatedAt: normalized.updatedAt };
      await writeWorkspace(env, id, record);
      return json(request, { ok: true, workspace: { id, label: record.label || id }, data: { updatedAt: normalized.updatedAt, count: normalized.items.length } });
    }

    return json(request, { ok: false, error: 'Método no permitido.' }, 405);
  }
};
