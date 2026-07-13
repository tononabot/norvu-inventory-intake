# Norvu Inventory Intake

Aplicación web para consolidar y cargar inventario hacia Norvu. Permite iniciar sesión por correo, importar el Excel operativo existente, completar la captura manual, evitar duplicados y exportar archivos limpios para migración.

## Qué hace

- Importa Excel/CSV existente.
- Fallback probado para el formato visto en imagen:
  - B: categoría
  - C: producto
  - E: cantidad
  - F: proveedor/marca
- Permite iniciar y cerrar sesión por correo para separar inventarios por cuenta.
- Permite continuar capturando desde la web.
- Guarda automáticamente en `localStorage` y sincroniza contra el Worker/KV configurado.
- Detecta posibles duplicados por código de barras o categoría + producto + proveedor/marca.
- Exporta:
  - Excel completo con hoja de captura.
  - CSV catálogo compatible con import actual de Norvu.
  - CSV stock inicial para migración posterior.
  - Respaldo de datos.

## Persistencia y sesión

La app es local-first y sincroniza por cuenta de correo. El correo activo identifica el inventario en curso; cerrar sesión limpia el contexto visible del navegador y permite entrar con otra cuenta sin mezclar datos.

El frontend nunca debe incluir tokens privados. La persistencia remota vive en Cloudflare Worker/KV.

## Campos visibles para el cliente

- Categoría
- Producto
- Cantidad contada
- Proveedor / marca
- Ubicación
- Código de barras opcional
- Notas

Los campos técnicos como SKU se generan solo al exportar para Norvu.
