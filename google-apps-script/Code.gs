/**
 * Norvu Inventory Intake — Google Sheets persistence endpoint.
 *
 * Setup:
 * 1. Create a Google Sheet with sheets: Captura, Export_Norvu_Catalogo, Export_Norvu_StockInicial.
 * 2. Extensions → Apps Script → paste this file.
 * 3. Set SHEET_ID below.
 * 4. Deploy → New deployment → Web app.
 *    Execute as: Me.
 *    Who has access: Anyone with the link (or restricted if using Google auth wrapper later).
 * 5. Paste the Web App URL in the SPA.
 *
 * Do not put secrets in the frontend.
 */
const SHEET_ID = '1pTPLiz3KqGl54Llx7g3Pp3__ztkwRHNR5685ZIxdZKA';

const CAPTURE_HEADERS = ['categoria','producto','cantidad','ubicacion','proveedor_marca','codigo_barras','costo_cop','precio_cop','notas','actualizado'];
const CATALOG_HEADERS = ['sku','name','barcode','price','cost','tax_class','reorder_point','category'];
const STOCK_HEADERS = ['sku','name','qty','warehouse','unit_cost','lote','expiry','reason'];

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || '{}');
    const ss = SpreadsheetApp.openById(SHEET_ID);
    writeSheet_(ss, 'Captura', CAPTURE_HEADERS, (payload.items || []).map(i => [
      i.category || '', i.name || '', i.qty || 0, i.location || '', i.source || '', i.barcode || '', i.cost || 0, i.price || 0, i.notes || '', new Date().toISOString()
    ]));
    writeSheet_(ss, 'Export_Norvu_Catalogo', CATALOG_HEADERS, (payload.catalog || []).map(r => CATALOG_HEADERS.map(h => r[h] ?? '')));
    writeSheet_(ss, 'Export_Norvu_StockInicial', STOCK_HEADERS, (payload.stock || []).map(r => STOCK_HEADERS.map(h => r[h] ?? '')));
    return json_({ ok: true, updatedAt: new Date().toISOString() });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) }, 500);
  }
}

function doGet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName('Captura');
  if (!sh) return json_({ items: [] });
  const values = sh.getDataRange().getValues();
  const rows = values.slice(1);
  const items = rows.filter(r => r.some(Boolean)).map(r => ({
    category: r[0], name: r[1], qty: r[2], location: r[3], source: r[4], barcode: r[5], cost: r[6], price: r[7], notes: r[8]
  }));
  return json_({ items });
}

function writeSheet_(ss, name, headers, rows) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.clearContents();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  if (rows.length) sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sh.autoResizeColumns(1, headers.length);
}

function json_(obj, status) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
