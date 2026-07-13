const STORAGE_KEY = 'norvu.inventory.intake.v1';
const SYNC_URL_KEY = 'norvu.inventory.syncUrl.v1';
let items = [];
let search = '';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function uid(){ return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()+Math.random()); }
function clean(v){ return String(v ?? '').trim(); }
function titleCase(v){
  const minor = new Set(['y','de','del','la','las','el','los','para','por','con']);
  return clean(v).toLowerCase().replace(/\p{L}+/gu, (w, offset) => (offset > 0 && minor.has(w)) ? w : w.charAt(0).toUpperCase()+w.slice(1));
}
function normalizeKey(v){ return clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim(); }
function numeric(v){ const n = Number(String(v ?? '').replace(/[$,.\s]/g, m => m === ',' ? '.' : '')); return Number.isFinite(n) ? n : 0; }
function todayStamp(){ return new Date().toISOString().slice(0,19).replace(/[:T]/g,'-'); }

function load(){
  try { items = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { items = []; }
  $('#sync-url').value = localStorage.getItem(SYNC_URL_KEY) || '';
  render();
}
function save(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  const now = new Date();
  $('#last-save').textContent = now.toLocaleString('es-CO');
  $('#autosave-status').textContent = 'Guardado local activo';
}

function itemFromForm(){
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
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

function render(){
  const dupes = duplicateMap();
  const q = normalizeKey(search);
  const filtered = items.filter(i => !q || [i.category,i.name,i.source,i.location,i.barcode,i.notes].some(v => normalizeKey(v).includes(q)));
  const body = $('#items-body');
  body.innerHTML = '';
  if(!filtered.length){ body.innerHTML = '<tr><td colspan="6" class="empty">No hay productos para mostrar.</td></tr>'; }
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
  save();
}
function renderDatalists(){
  const cats = [...new Set(items.map(i=>i.category).filter(Boolean))].sort();
  $('#category-list').innerHTML = cats.map(c=>`<option value="${escapeAttr(c)}">`).join('');
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
  // Fallback específico de la imagen: B categoría, C producto, E cantidad, F proveedor/marca.
  // SheetJS recorta columnas vacías iniciales, así que soportamos tanto matriz completa (B=índice 1)
  // como matriz recortada (B pasa a índice 0).
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
      // Evitar duplicar cantidades: conservamos el registro existente y solo completamos vacíos útiles.
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
async function syncNow(){
  const url = clean($('#sync-url').value);
  if(!url) return showNotice('#sync-result','Pega primero la URL del Apps Script.', true);
  try{
    const res = await fetch(url, {method:'POST', mode:'cors', headers:{'Content-Type':'text/plain;charset=utf-8'}, body:JSON.stringify({items, catalog:toCatalogRows(), stock:toStockRows(), source:'norvu-inventory-intake', ts:new Date().toISOString()})});
    const txt = await res.text();
    if(!res.ok) throw new Error(txt || res.statusText);
    showNotice('#sync-result', 'Sincronizado con Google Sheet.');
  }catch(err){ showNotice('#sync-result', `No se pudo sincronizar: ${err.message}`, true); }
}

$('#item-form').addEventListener('submit', e => { e.preventDefault(); const item=itemFromForm(); upsertItem(item, false); render(); resetForm(); });
$('#file-input').addEventListener('change', e => { const f=e.target.files[0]; if(f) importFile(f).catch(err => showNotice('#import-result', `Error leyendo archivo: ${err.message}`, true)); e.target.value=''; });
$('#search').addEventListener('input', e => { search=e.target.value; render(); });
document.addEventListener('click', e => {
  const btn = e.target.closest('button,[data-action]'); if(!btn) return;
  const action = btn.dataset.action;
  if(btn.dataset.edit){ const item=items.find(i=>i.id===btn.dataset.edit); if(item){ for(const k of ['category','name','qty','source','location','barcode','cost','price','notes']) $(`#${k}`).value = item[k] ?? ''; $('#edit-id').value=item.id; $('#category').focus(); } }
  if(btn.dataset.delete){ if(confirm('¿Eliminar este producto?')){ items=items.filter(i=>i.id!==btn.dataset.delete); render(); } }
  if(action==='reset-form') resetForm();
  if(action==='clear-all' && confirm('Esto borra solo los datos guardados en este navegador. ¿Continuar?')){ items=[]; render(); }
  if(action==='export-json') downloadBlob(`norvu-inventario-backup-${todayStamp()}.json`, new Blob([JSON.stringify({items, exportedAt:new Date().toISOString()},null,2)], {type:'application/json'}));
  if(action==='export-xlsx') exportXlsx();
  if(action==='download-catalog') downloadCsv(`norvu-catalogo-${todayStamp()}.csv`, toCatalogRows());
  if(action==='download-stock') downloadCsv(`norvu-stock-inicial-${todayStamp()}.csv`, toStockRows());
  if(action==='save-sync-url'){ localStorage.setItem(SYNC_URL_KEY, clean($('#sync-url').value)); showNotice('#sync-result','URL guardada en este navegador.'); }
  if(action==='sync-now') syncNow();
});

load();
