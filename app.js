const STORAGE_KEY = 'norvu.inventory.intake.v1';
const WORKSPACE_KEY = 'norvu.inventory.workspace.v2';
const SESSION_KEY = 'norvu.inventory.emailSession.v1';
const DEVICE_KEY = 'norvu.inventory.deviceLabel.v1';
const API_BASE = window.NORVU_API_BASE || 'https://norvu-inventory-intake-api.edwardramosp.workers.dev';

let items = [];
let search = '';
let filterCategory = '';
let filterStatus = '';
let workspace = null;
let isBooting = true;
let syncTimer = null;
let lastRemoteSignature = '';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function uid(){ return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()+Math.random()); }
function clean(v){ return String(v ?? '').trim(); }
function normalizeEmail(v){ return clean(v).toLowerCase(); }
function storageKey(){ return workspace?.id ? `${STORAGE_KEY}.${workspace.id}` : STORAGE_KEY; }
function titleCase(v){
  const minor = new Set(['y','de','del','la','las','el','los','para','por','con']);
  return clean(v).toLowerCase().replace(/\p{L}+/gu, (w, offset) => (offset > 0 && minor.has(w)) ? w : w.charAt(0).toUpperCase()+w.slice(1));
}
function normalizeKey(v){ return clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim(); }
function slugify(v){ return normalizeKey(v).replace(/\s+/g,'-').replace(/^-+|-+$/g,'').slice(0,48); }
function numeric(v){ const n = Number(String(v ?? '').replace(/[$,.\s]/g, m => m === ',' ? '.' : '')); return Number.isFinite(n) ? n : 0; }
function todayStamp(){ return new Date().toISOString().slice(0,19).replace(/[:T]/g,'-'); }
function deviceLabel(){
  let value = localStorage.getItem(DEVICE_KEY);
  if(!value){ value = `Dispositivo ${new Date().toLocaleDateString('es-CO')}`; localStorage.setItem(DEVICE_KEY, value); }
  return value;
}

function accessFromUrl(){
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const id = slugify(url.searchParams.get('u') || url.searchParams.get('workspace') || '');
  const key = clean(hash.get('k') || hash.get('key') || url.searchParams.get('k') || '');
  return { id, key };
}
function loadWorkspace(){
  const fromUrl = accessFromUrl();
  if(fromUrl.id && fromUrl.key){
    workspace = { id: fromUrl.id, key: fromUrl.key, label: fromUrl.id, email: fromUrl.id };
    localStorage.setItem(SESSION_KEY, JSON.stringify(workspace));
    return workspace;
  }
  try { workspace = JSON.parse(localStorage.getItem(SESSION_KEY) || localStorage.getItem(WORKSPACE_KEY) || 'null'); } catch { workspace = null; }
  return workspace;
}
function saveWorkspace(next){
  workspace = next;
  localStorage.setItem(SESSION_KEY, JSON.stringify(workspace));
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace));
  renderWorkspace();
  renderSession();
}
function teamLink(){
  if(!workspace?.id) return '';
  return `cuenta:${workspace.email || workspace.label || workspace.id} · espacio:${workspace.id}`;
}
function currentRouteHash(){
  const route = routeFromHash();
  return route ? `#${route}` : '#captura';
}
function apiUrl(path){
  const url = new URL(path, API_BASE.endsWith('/') ? API_BASE : `${API_BASE}/`);
  if(workspace?.id) url.searchParams.set('u', workspace.id);
  return url.toString();
}
function authHeaders(){ return workspace?.key ? {'X-Workspace-Key': workspace.key} : {}; }
function dataSignature(list=items){ return JSON.stringify(list.map(i => [i.id,i.category,i.name,i.qty,i.source,i.location,i.barcode,i.cost,i.price,i.notes,i.updatedAt])); }

function load(){
  loadWorkspace();
  try { items = workspace?.id ? JSON.parse(localStorage.getItem(storageKey()) || '[]') : []; } catch { items = []; }
  renderSession();
  render();
  renderWorkspace();
  isBooting = false;
  if(workspace?.id && workspace?.key) pullRemote();
}
function save(){
  if(workspace?.id) localStorage.setItem(storageKey(), JSON.stringify(items));
  const now = new Date();
  const savedAt = now.toLocaleString('es-CO');
  $('#last-save').textContent = savedAt;
  const headerLastSave = $('#header-last-save');
  if(headerLastSave) headerLastSave.textContent = savedAt;
  const statusText = workspace?.id ? `Guardado local + nube activo para ${workspace.email || workspace.label}` : 'Inicia sesión para guardar';
  $('#autosave-status').textContent = statusText;
  const headerStatus = $('#header-save-status');
  if(headerStatus) headerStatus.textContent = workspace?.id ? 'Guardado local + nube activo' : 'Inicia sesión para guardar';
  if(!isBooting) scheduleRemotePush();
}

function renderWorkspace(){
  const idText = workspace?.email || workspace?.label || 'Sin correo activo';
  $('#workspace-name').textContent = idText;
  $('#workspace-state').textContent = workspace?.id ? 'Este inventario está separado y sincronizado por correo.' : 'Inicia sesión con un correo para separar datos por usuario.';
  $('#team-link').value = teamLink();
  $('#workspace-panel').classList.toggle('is-connected', Boolean(workspace?.id));
  $('#setup-workspace-name').value = workspace?.email || workspace?.label || '';
}
function renderSession(){
  const logged = Boolean(workspace?.id && workspace?.key);
  const loginScreen = $('#login-screen');
  const main = $('#main');
  document.body.classList.toggle('is-logged-out', !logged);
  if(loginScreen) loginScreen.hidden = logged;
  if(main) main.hidden = !logged;
  const userEmail = workspace?.email || workspace?.label || 'Sin sesión';
  const chip = $('#session-email');
  if(chip){ chip.hidden = !logged; chip.textContent = logged ? `Correo: ${userEmail}` : 'Sin sesión'; }
  const headerSession = $('#header-session');
  if(headerSession) headerSession.hidden = !logged;
  const headerUser = $('#header-user-email');
  if(headerUser) headerUser.textContent = userEmail;
  const headerStatus = $('#header-save-status');
  if(headerStatus) headerStatus.textContent = logged ? 'Guardado local + nube activo' : 'Sin sesión activa';
  const menuBtn = $('#mobile-menu-button');
  if(menuBtn) menuBtn.hidden = !logged;
  const logoutBtn = $('#logout-button');
  if(logoutBtn) logoutBtn.hidden = !logged;
  if(!logged){ closeMobileMenu(); $('#login-email')?.focus({preventScroll:true}); }
}

const ROUTES = new Set(['captura','importar','exportar','equipo']);
function routeFromHash(){
  const raw = window.location.hash.replace(/^#/, '').split(/[&?]/)[0];
  return ROUTES.has(raw) ? raw : 'captura';
}
function setRoute(){
  const route = routeFromHash();
  $$('[data-route]').forEach((section) => { section.hidden = section.dataset.route !== route; });
  $$('[data-route-link]').forEach((link) => {
    const active = link.dataset.routeLink === route;
    link.classList.toggle('is-active', active);
    if(active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}
async function loginWithEmail(email){
  const normalized = normalizeEmail(email);
  if(!normalized) throw new Error('Escribe un correo válido.');
  showNotice('#login-result', 'Abriendo inventario de este correo…');
  const res = await fetch(new URL('/login', API_BASE), {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email:normalized, deviceLabel:deviceLabel()})});
  const body = await res.json().catch(() => ({}));
  if(!res.ok || !body.ok) throw new Error(body.error || 'No se pudo iniciar sesión.');
  saveWorkspace({id:body.workspace.id, key:body.workspace.key, label:body.workspace.label, email:body.workspace.email || normalized});
  try { items = JSON.parse(localStorage.getItem(storageKey()) || '[]'); } catch { items = []; }
  render();
  await pullRemote();
  showNotice('#login-result', 'Listo. Inventario cargado para ese correo.');
}
async function createWorkspace(){
  const email = normalizeEmail($('#setup-workspace-name').value || workspace?.email || '');
  if(!email) throw new Error('Inicia sesión con un correo primero.');
  return loginWithEmail(email);
}
async function copyTeamLink(){
  const link = teamLink();
  if(!link) return setSyncStatus('Primero inicia sesión con un correo.', true);
  await navigator.clipboard.writeText(link);
  setSyncStatus('Identificador copiado. Úsalo solo para soporte o revisión interna del inventario.');
}
function logout(){
  workspace = null;
  items = [];
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(WORKSPACE_KEY);
  renderSession();
  render();
  renderWorkspace();
}
function forgetWorkspace(){ logout(); }
function setSyncStatus(msg, error=false){
  const el = $('#sync-result');
  if(!el) return;
  el.hidden = false;
  el.textContent = msg;
  el.classList.toggle('error', error);
}
function scheduleRemotePush(){
  if(!workspace?.id || !workspace?.key) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => pushRemote(false), 850);
}
async function pullRemote(){
  if(!workspace?.id || !workspace?.key) return;
  try{
    setSyncStatus('Buscando cambios guardados en la nube…');
    const res = await fetch(apiUrl('/inventory'), {headers:authHeaders()});
    const body = await res.json().catch(() => ({}));
    if(!res.ok || !body.ok) throw new Error(body.error || 'No se pudo cargar la nube.');
    const remoteItems = Array.isArray(body.data?.items) ? body.data.items : [];
    const before = items.length;
    mergeRemoteItems(remoteItems);
    lastRemoteSignature = dataSignature(items);
    render();
    setSyncStatus(remoteItems.length ? `Nube cargada: ${items.length} productos (${Math.max(0, items.length-before)} nuevos en este correo).` : 'La nube está lista. Todavía no hay productos remotos.');
  }catch(err){ setSyncStatus(err.message, true); }
}
async function pushRemote(force=false){
  if(!workspace?.id || !workspace?.key) return;
  const signature = dataSignature(items);
  if(!force && signature === lastRemoteSignature) return;
  try{
    setSyncStatus('Sincronizando con la nube…');
    const res = await fetch(apiUrl('/inventory'), {method:'POST', headers:{'Content-Type':'application/json', ...authHeaders()}, body:JSON.stringify({items, deviceLabel:deviceLabel()})});
    const body = await res.json().catch(() => ({}));
    if(!res.ok || !body.ok) throw new Error(body.error || 'No se pudo sincronizar.');
    lastRemoteSignature = signature;
    setSyncStatus(`Sincronizado: ${items.length} productos guardados para ${workspace.email || workspace.label || workspace.id}.`);
  }catch(err){ setSyncStatus(err.message, true); }
}
function mergeRemoteItems(remoteItems){
  for(const remote of remoteItems){
    const byId = items.findIndex(i => i.id === remote.id);
    if(byId >= 0){
      const localTime = Date.parse(items[byId].updatedAt || '') || 0;
      const remoteTime = Date.parse(remote.updatedAt || '') || 0;
      if(remoteTime >= localTime) items[byId] = {...items[byId], ...remote};
      continue;
    }
    const byDuplicate = items.findIndex(i => duplicateKey(i) === duplicateKey(remote));
    if(byDuplicate >= 0){
      items[byDuplicate] = {...remote, ...items[byDuplicate], id:items[byDuplicate].id, qty:numeric(items[byDuplicate].qty) || numeric(remote.qty), updatedAt:new Date().toISOString()};
    } else {
      items.push(remote);
    }
  }
}

function itemFromForm(){
  const existing = items.find(i => i.id === $('#edit-id').value);
  const now = new Date().toISOString();
  return {
    id: $('#edit-id').value || uid(),
    category: titleCase($('#category').value),
    name: titleCase($('#name').value),
    qty: numeric($('#qty').value),
    source: clean($('#source').value).toUpperCase(),
    location: titleCase($('#location').value || 'Principal'),
    barcode: clean($('#barcode').value),
    cost: Math.max(0, Math.round(numeric($('#cost').value))),
    price: Math.max(0, Math.round(numeric($('#price').value))),
    notes: clean($('#notes').value),
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
}
function resetForm(){ $('#item-form').reset(); $('#edit-id').value=''; $('#location').value='Principal'; $('#category').focus(); }
function duplicateKey(item){ return item.barcode ? `barcode:${item.barcode}` : `name:${normalizeKey(item.category)}|${normalizeKey(item.name)}|${normalizeKey(item.source)}`; }
function duplicateMap(list=items){ const map = new Map(); for(const item of list){ const k = duplicateKey(item); map.set(k, (map.get(k)||0)+1); } return map; }
function upsertItem(item, mergeQty=false){
  const existingById = items.findIndex(x => x.id === item.id);
  if(existingById >= 0){ items[existingById] = {...items[existingById], ...item, updatedAt:new Date().toISOString()}; return 'updated'; }
  const key = duplicateKey(item);
  const existing = items.findIndex(x => duplicateKey(x) === key);
  if(existing >= 0 && mergeQty){
    items[existing] = {...items[existing], qty: numeric(items[existing].qty)+numeric(item.qty), notes: [items[existing].notes, item.notes].filter(Boolean).join(' | '), updatedAt:new Date().toISOString()};
    return 'merged';
  }
  items.push(item); return 'created';
}
function saveCurrentForm(){
  const form = $('#item-form');
  if(!form.reportValidity()) return;
  const item = itemFromForm();
  upsertItem(item, false);
  render();
  resetForm();
}

function render(){
  const dupes = duplicateMap();
  const q = normalizeKey(search);
  const filtered = items.filter(i => {
    const missing = !i.category || !i.name;
    const isDupe = dupes.get(duplicateKey(i)) > 1;
    const statusOk = !filterStatus || (filterStatus === 'ok' && !missing && !isDupe) || (filterStatus === 'dupe' && isDupe) || (filterStatus === 'missing' && missing);
    const categoryOk = !filterCategory || i.category === filterCategory;
    const searchOk = !q || [i.category,i.name,i.source,i.location,i.barcode,i.notes].some(v => normalizeKey(v).includes(q));
    return statusOk && categoryOk && searchOk;
  });
  const body = $('#items-body');
  body.innerHTML = '';
  if(!filtered.length){ body.innerHTML = '<tr><td colspan="6" class="empty">No hay productos para mostrar. Carga el Excel o agrega el primer producto.</td></tr>'; }
  for(const item of filtered){
    const isDupe = dupes.get(duplicateKey(item)) > 1;
    const missing = !item.category || !item.name;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(item.category || '—')}<br><small>${escapeHtml(item.location || 'Principal')}</small></td>
      <td><strong>${escapeHtml(item.name || '—')}</strong>${item.barcode ? `<br><small>Código: ${escapeHtml(item.barcode)}</small>`:''}${item.notes ? `<br><small>${escapeHtml(item.notes)}</small>`:''}</td>
      <td>${formatQty(item.qty)}</td>
      <td>${escapeHtml(item.source || '—')}</td>
      <td>${missing ? '<span class="pill error">Incompleto</span>' : isDupe ? '<span class="pill warn">Revisar duplicado</span>' : '<span class="pill ok">OK</span>'}</td>
      <td><div class="row-actions"><button type="button" class="ghost" data-edit="${item.id}">Editar</button><button type="button" class="ghost danger" data-delete="${item.id}">Eliminar</button></div></td>`;
    body.appendChild(tr);
  }
  $('#stat-products').textContent = String(items.length);
  $('#stat-units').textContent = formatQty(items.reduce((s,i)=>s+numeric(i.qty),0));
  $('#stat-dupes').textContent = String([...dupes.values()].filter(v=>v>1).reduce((s,v)=>s+v,0));
  $('#stat-missing').textContent = String(items.filter(i=>!i.category || !i.name).length);
  renderDatalists();
  renderFilterOptions();
  save();
}
function renderDatalists(){
  const cats = [...new Set(items.map(i=>i.category).filter(Boolean))].sort();
  $('#category-list').innerHTML = cats.map(c=>`<option value="${escapeAttr(c)}">`).join('');
}
function renderFilterOptions(){
  const select = $('#filter-category');
  if(!select) return;
  const cats = [...new Set(items.map(i=>i.category).filter(Boolean))].sort();
  const current = select.value || filterCategory;
  select.innerHTML = '<option value="">Todas</option>' + cats.map(c=>`<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('');
  if(cats.includes(current)){ select.value = current; filterCategory = current; }
  else { select.value = ''; filterCategory = ''; }
}
function escapeHtml(s){ return clean(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function escapeAttr(s){ return escapeHtml(s); }
function formatQty(n){ return new Intl.NumberFormat('es-CO', {maximumFractionDigits:3}).format(numeric(n)); }

function parseRowsFromSheet(ws){
  const matrix = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
  if(!matrix.length) return [];
  const headerIndex = matrix.findIndex(row => row.some(c => /categor|producto|nombre|cantidad|proveedor|marca/i.test(String(c))));
  if(headerIndex >= 0){
    const headers = matrix[headerIndex].map(h => normalizeKey(h));
    const idx = (...names) => headers.findIndex(h => names.some(n => h.includes(n)));
    const cCategory = idx('categoria','category');
    const cName = idx('producto','nombre','name','descripcion');
    const cQty = idx('cantidad','cant','qty','stock','existencia');
    const cSource = idx('proveedor','marca','fuente','supplier');
    const cBarcode = idx('codigo barras','barcode','ean');
    const cLocation = idx('ubicacion','bodega','location');
    return matrix.slice(headerIndex+1).map(row => rowToItem({
      category: row[cCategory], name: row[cName], qty: row[cQty], source: row[cSource], barcode: row[cBarcode], location: row[cLocation]
    })).filter(i => i.category || i.name || i.qty || i.source);
  }
  return matrix.map(row => {
    const fullShape = row[2] !== undefined && clean(row[2]) !== '';
    return rowToItem(fullShape
      ? {category: row[1], name: row[2], qty: row[4], source: row[5]}
      : {category: row[0], name: row[1], qty: row[3], source: row[4]});
  }).filter(i => i.category || i.name || i.qty || i.source);
}
function rowToItem(r){
  return {id:uid(), category:titleCase(r.category), name:titleCase(r.name), qty:numeric(r.qty), source:clean(r.source).toUpperCase(), location:titleCase(r.location || 'Principal'), barcode:clean(r.barcode), cost:0, price:0, notes:'Importado desde Excel', createdAt:new Date().toISOString(), updatedAt:new Date().toISOString()};
}
async function importFile(file){
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, {type:'array'});
  const ws = wb.Sheets[wb.SheetNames[0]];
  const imported = parseRowsFromSheet(ws);
  const merge = $('#merge-import').checked;
  if(!merge) items = [];
  let created=0, updated=0, skipped=0;
  for(const item of imported){
    if(!item.name && !item.category){ skipped++; continue; }
    const existing = items.findIndex(x => duplicateKey(x) === duplicateKey(item));
    if(existing >= 0){
      items[existing] = {
        ...items[existing],
        category: items[existing].category || item.category,
        name: items[existing].name || item.name,
        qty: numeric(items[existing].qty) || numeric(item.qty),
        source: items[existing].source || item.source,
        location: items[existing].location || item.location,
        barcode: items[existing].barcode || item.barcode,
        notes: items[existing].notes || item.notes,
        updatedAt: new Date().toISOString()
      };
      updated++;
    } else { items.push(item); created++; }
  }
  render();
  showNotice('#import-result', `Importado: ${created} nuevos, ${updated} ya existían y se conservaron sin duplicar cantidad, ${skipped} omitidos.`);
}
function showNotice(sel, msg, error=false){ const el=$(sel); el.hidden=false; el.textContent=msg; el.classList.toggle('error', error); }

function toCatalogRows(){
  return items.filter(i=>i.name).map((i,idx)=>({
    sku: makeSku(i, idx), name:i.name, barcode:i.barcode || '', price:i.price || 0, cost:i.cost || 0, tax_class:'gravado', reorder_point:0, category:i.category || 'Sin categoria'
  }));
}
function toStockRows(){
  return items.filter(i=>i.name).map((i,idx)=>({
    sku: makeSku(i, idx), name:i.name, qty:i.qty || 0, warehouse:i.location || 'Principal', unit_cost:i.cost || 0, lote:'', expiry:'', reason:'Inventario inicial desde conteo físico'
  }));
}
function makeSku(i, idx){
  const base = normalizeKey(i.category || 'GEN').toUpperCase().replace(/\s+/g,'').slice(0,3) || 'GEN';
  const name = normalizeKey(i.name || 'ITEM').toUpperCase().replace(/\s+/g,'').slice(0,4) || 'ITEM';
  return `${base}-${name}-${String(idx+1).padStart(4,'0')}`;
}
function downloadBlob(name, blob){ const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href), 1000); }
function downloadCsv(name, rows){
  if(!rows.length) return alert('No hay datos para exportar.');
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(','), ...rows.map(r => headers.map(h => csvCell(r[h])).join(','))].join('\n');
  downloadBlob(name, new Blob([csv], {type:'text/csv;charset=utf-8'}));
}
function csvCell(v){ const s=String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s; }
function exportXlsx(){
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(items.map(i=>({categoria:i.category, producto:i.name, cantidad:i.qty, ubicacion:i.location, proveedor_marca:i.source, codigo_barras:i.barcode, costo_cop:i.cost, precio_cop:i.price, notas:i.notes}))), 'Captura');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(toCatalogRows()), 'Export_Norvu_Catalogo');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(toStockRows()), 'Export_Norvu_StockInicial');
  XLSX.writeFile(wb, `norvu-inventario-${todayStamp()}.xlsx`);
}

function isMobileNav(){ return window.matchMedia('(max-width: 820px)').matches; }
function closeMobileMenu(){
  document.body.classList.remove('menu-open');
  const menuBtn = $('#mobile-menu-button');
  const menu = $('#top-actions');
  if(menuBtn){
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.setAttribute('aria-label', 'Abrir menú');
  }
  if(menu){
    menu.classList.remove('is-open');
    menu.inert = isMobileNav();
  }
}
function toggleMobileMenu(){
  const open = !document.body.classList.contains('menu-open');
  document.body.classList.toggle('menu-open', open);
  const menuBtn = $('#mobile-menu-button');
  const menu = $('#top-actions');
  if(menuBtn){
    menuBtn.setAttribute('aria-expanded', String(open));
    menuBtn.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
  }
  if(menu){
    menu.classList.toggle('is-open', open);
    menu.inert = isMobileNav() && !open;
  }
}

$('#login-form').addEventListener('submit', e => { e.preventDefault(); loginWithEmail($('#login-email').value).catch(err => showNotice('#login-result', err.message, true)); });
$('#item-form').addEventListener('submit', e => { e.preventDefault(); saveCurrentForm(); });
$('#file-input').addEventListener('change', e => { const f=e.target.files[0]; if(f) importFile(f).catch(err => showNotice('#import-result', `Error leyendo archivo: ${err.message}`, true)); e.target.value=''; });
$('#search').addEventListener('input', e => { search=e.target.value; render(); });
$('#filter-category').addEventListener('change', e => { filterCategory=e.target.value; render(); });
$('#filter-status').addEventListener('change', e => { filterStatus=e.target.value; render(); });
document.addEventListener('click', e => {
  const btn = e.target.closest('button,[data-action]'); if(!btn) return;
  const action = btn.dataset.action;
  if(btn.dataset.edit){ const item=items.find(i=>i.id===btn.dataset.edit); if(item){ for(const k of ['category','name','qty','source','location','barcode','cost','price','notes']) $(`#${k}`).value = item[k] ?? ''; $('#edit-id').value=item.id; $('#category').focus(); } }
  if(btn.dataset.delete){ if(confirm('¿Eliminar este producto?')){ items=items.filter(i=>i.id!==btn.dataset.delete); render(); } }
  if(action==='save-item') { e.preventDefault(); saveCurrentForm(); }
  if(action==='reset-form') resetForm();
  if(action==='clear-filters') { search=''; filterCategory=''; filterStatus=''; $('#search').value=''; $('#filter-status').value=''; $('#filter-category').value=''; render(); }
  if(action==='clear-all' && confirm('Esto borra el inventario de la cuenta activa en este navegador y sincroniza el cambio en la nube. ¿Continuar?')){ items=[]; render(); pushRemote(true); }
  if(action==='export-json') downloadBlob(`norvu-inventario-backup-${todayStamp()}.json`, new Blob([JSON.stringify({workspace:workspace?.id || null, items, exportedAt:new Date().toISOString()},null,2)], {type:'application/json'}));
  if(action==='export-xlsx') exportXlsx();
  if(action==='download-catalog') downloadCsv(`norvu-catalogo-${todayStamp()}.csv`, toCatalogRows());
  if(action==='download-stock') downloadCsv(`norvu-stock-inicial-${todayStamp()}.csv`, toStockRows());
  if(action==='create-workspace') createWorkspace().catch(err => setSyncStatus(err.message, true));
  if(action==='copy-team-link') copyTeamLink().catch(err => setSyncStatus(err.message, true));
  if(action==='pull-remote') pullRemote();
  if(action==='push-remote') pushRemote(true);
  if(action==='forget-workspace') forgetWorkspace();
  if(action==='logout') { closeMobileMenu(); logout(); }
});
$('#mobile-menu-button')?.addEventListener('click', toggleMobileMenu);
$('#top-actions')?.addEventListener('click', e => {
  if(e.target.closest('a,button')) closeMobileMenu();
});
document.addEventListener('keydown', e => {
  if(e.key === 'Escape') closeMobileMenu();
});

window.addEventListener('resize', () => {
  const menu = $('#top-actions');
  if(menu) menu.inert = isMobileNav() && !document.body.classList.contains('menu-open');
});

closeMobileMenu();
load();
setRoute();
window.addEventListener('hashchange', setRoute);
