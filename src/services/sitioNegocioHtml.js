// Mini-sitio autogenerado para cada negocio cliente — funcionalidad
// adicional de Totemsystem, sin depender de Shopify ni ninguna plataforma
// externa. Se arma 100% a partir de datos que el negocio ya carga en el
// panel (Información del negocio, Configuración de agenda, Productos) —
// no hay edición manual todavía, eso queda para una versión futura.

function escaparHtml(texto) {
  if (!texto) return '';
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatearTelefonoWhatsApp(telefono) {
  if (!telefono) return null;
  const soloDigitos = telefono.replace(/\D/g, '');
  return soloDigitos.length >= 8 ? soloDigitos : null;
}

function renderSitioNegocio({ empresa, servicios, productos, esAgendamiento }) {
  const nombreCompleto = empresa.sucursal ? `${empresa.nombre} — ${empresa.sucursal}` : empresa.nombre;
  const telefonoWa = formatearTelefonoWhatsApp(empresa.telefonoContacto);

  const bloqueDireccion = empresa.direccion
    ? `<p class="sitio-dato">📍 ${escaparHtml(empresa.direccion)}</p>`
    : '';

  const bloqueLista = esAgendamiento
    ? (servicios.length > 0
        ? `<div class="sitio-seccion">
             <p class="sitio-eyebrow">Servicios</p>
             <ul class="sitio-lista">
               ${servicios.map((s) => `<li>${escaparHtml(s.nombre)}</li>`).join('')}
             </ul>
           </div>`
        : '')
    : (productos.length > 0
        ? `<div class="sitio-seccion">
             <p class="sitio-eyebrow">Algunos de nuestros productos</p>
             <ul class="sitio-lista">
               ${productos.map((p) => `<li>${escaparHtml(p.nombre)}${p.precio ? ` — $${p.precio.toLocaleString('es-CL')}` : ''}</li>`).join('')}
             </ul>
           </div>`
        : '');

  const bloqueInfo = empresa.informacionAdicional
    ? `<div class="sitio-seccion"><p class="sitio-eyebrow">Sobre nosotros</p><p class="sitio-info">${escaparHtml(empresa.informacionAdicional)}</p></div>`
    : '';

  const botonWhatsApp = telefonoWa
    ? `<a class="sitio-cta" href="https://wa.me/${telefonoWa}?text=${encodeURIComponent(`Hola, escribo desde su página web`)}" target="_blank" rel="noopener">
         💬 Escríbenos por WhatsApp
       </a>`
    : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escaparHtml(nombreCompleto)}</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{--paper:#F0EEE2;--card:#FAF8EF;--ink:#16241F;--teal:#2F6F62;--teal-deep:#1F4E44;--brass:#B8863B;--line:#DAD4C0;--muted:#6B7770;}
  *{box-sizing:border-box;}
  body{margin:0;background:var(--paper);color:var(--ink);font-family:'Inter',sans-serif;}
  .sitio-wrap{max-width:600px;margin:0 auto;padding:0 20px 60px;}
  header{background:var(--ink);color:var(--paper);padding:44px 20px 36px;text-align:center;}
  header .sitio-logo{max-width:120px;max-height:80px;margin-bottom:14px;border-radius:8px;}
  header h1{font-family:'Fraunces',serif;font-size:1.7rem;margin:0;}
  .sitio-dato{color:#CBD6D0;font-size:.9rem;margin:10px 0 0;}
  .sitio-seccion{margin-top:32px;}
  .sitio-eyebrow{font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:var(--brass);font-weight:700;margin:0 0 10px;}
  .sitio-lista{list-style:none;padding:0;margin:0;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden;}
  .sitio-lista li{padding:12px 16px;font-size:.9rem;border-bottom:1px solid var(--line);}
  .sitio-lista li:last-child{border-bottom:none;}
  .sitio-info{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;font-size:.88rem;line-height:1.6;color:#3A4842;white-space:pre-line;}
  .sitio-cta{display:block;text-align:center;background:var(--teal-deep);color:#fff;text-decoration:none;padding:16px;border-radius:10px;font-weight:600;margin-top:34px;font-size:1rem;}
  footer{text-align:center;color:var(--muted);font-size:.72rem;margin-top:40px;}
</style>
</head>
<body>
<header>
  ${empresa.logoUrl ? `<img class="sitio-logo" src="${escaparHtml(empresa.logoUrl)}" alt="${escaparHtml(empresa.nombre)}">` : ''}
  <h1>${escaparHtml(nombreCompleto)}</h1>
  ${bloqueDireccion}
</header>
<div class="sitio-wrap">
  ${bloqueLista}
  ${bloqueInfo}
  ${botonWhatsApp}
  <footer>Sitio generado automáticamente con Totemsystem</footer>
</div>
</body>
</html>`;
}

module.exports = { renderSitioNegocio };