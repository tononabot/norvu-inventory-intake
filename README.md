# Norvu Inventory Intake

Herramienta web temporal para que un cliente capture inventario sin conocer SKU ni campos técnicos, reutilizando el Excel que ya tiene y preparando datos exportables para Norvu.

## Qué hace

- Importa Excel/CSV existente.
- Fallback probado para el formato visto en imagen:
  - B: categoría
  - C: producto
  - E: cantidad
  - F: proveedor/marca
- Permite continuar capturando desde la web.
- Guarda automáticamente en `localStorage` del navegador.
- Detecta posibles duplicados por código de barras o categoría + producto + proveedor/marca.
- Exporta:
  - Excel completo con hoja de captura.
  - CSV catálogo compatible con import actual de Norvu.
  - CSV stock inicial para migración posterior.
  - Backup JSON.

## Persistencia

Por defecto es local-first: no expone datos ni credenciales y funciona en GitHub Pages inmediatamente.

Para persistencia centralizada opcional, ver `google-apps-script/Code.gs`. Se debe desplegar como Google Apps Script Web App y pegar la URL en la app. El frontend nunca debe incluir tokens de Google.

## Campos visibles para el cliente

- Categoría
- Producto
- Cantidad contada
- Proveedor / marca
- Ubicación
- Código de barras opcional
- Notas

Los campos técnicos como SKU se generan solo al exportar para Norvu.
