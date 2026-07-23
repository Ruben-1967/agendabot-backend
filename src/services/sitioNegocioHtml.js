// Mini-sitio autogenerado para cada negocio cliente — funcionalidad
// adicional de Totemsystem, sin depender de Shopify ni ninguna plataforma
// externa. Se arma 100% a partir de datos que el negocio ya carga en el
// panel (Información del negocio, Configuración de agenda, Productos).
//
// Pensado para servirse desde un subdominio propio vía DNS del reseller de
// BlueHosting (ej. ahorroptica.totemsystem.cl) apuntando a este mismo
// endpoint de Render — el hosting del contenido sigue siendo Node/Express,
// BlueHosting solo resuelve el dominio bonito.

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

function iconoParaItem(nombre) {
  const n = nombre.toLowerCase();
  if (/vista|ocular|lente|ópti/.test(n)) return '👁️';
  if (/facial|piel|estétic/.test(n)) return '✨';
  if (/masaje|relaj/.test(n)) return '💆';
  if (/pan|torta|past|dulce|croissant|brownie/.test(n)) return '🥐';
  if (/pizza|hambur|sushi|comida|menú|almuerzo/.test(n)) return '🍽️';
  if (/carne|vacuno|pollo|cerdo/.test(n)) return '🥩';
  if (/repar|mantenc|técnic/.test(n)) return '🔧';
  return '•';
}

function renderSitioNegocio({ empresa, servicios, productos, esAgendamiento }) {
  const nombreCompleto = empresa.sucursal ? `${empresa.nombre} — ${empresa.sucursal}` : empresa.nombre;
  const telefonoWa = formatearTelefonoWhatsApp(empresa.telefonoContacto);
  const items = esAgendamiento ? servicios.map((s) => s.nombre) : productos.map((p) => p.nombre);
  const etiquetaSeccion = esAgendamiento ? 'Atendemos' : 'Lo que encuentras';

  const bloqueItems = items.length > 0
    ? `<section class="s-seccion">
        <p class="s-eyebrow">${etiquetaSeccion}</p>
        <div class="s-grid-items">
          ${items.slice(0, 8).map((nombre) => `
            <div class="s-item-card">
              <span class="s-item-icono">${iconoParaItem(nombre)}</span>
              <span class="s-item-nombre">${escaparHtml(nombre)}</span>
            </div>`).join('')}
        </div>
      </section>`
    : '';

  const bloqueInfo = empresa.informacionAdicional
    ? `<section class="s-seccion s-seccion-info">
        <p class="s-eyebrow">Sobre nosotros</p>
        <p class="s-info">${escaparHtml(empresa.informacionAdicional)}</p>
      </section>`
    : '';

  const mensajePrellenado = encodeURIComponent(`Hola, escribo desde su página web 👋`);
  const botonWhatsApp = telefonoWa
    ? `<a class="s-cta" href="https://wa.me/${telefonoWa}?text=${mensajePrellenado}" target="_blank" rel="noopener">
         Escríbenos por WhatsApp
       </a>`
    : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escaparHtml(nombreCompleto)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root{
    --navy:#12203a; --navy-deep:#0b1526; --blue:#389cf5; --amber:#E8A23D;
    --paper:#F7F4EE; --card:#FFFFFF; --ink:#16213a; --muted:#69707f; --line:#E4E0D6;
  }
  *{box-sizing:border-box;}
  body{margin:0;background:var(--paper);color:var(--ink);font-family:'Inter',sans-serif;-webkit-font-smoothing:antialiased;}
  h1,h2,.s-eyebrow{font-family:'Space Grotesk',sans-serif;}

  .s-hero{
    background:linear-gradient(160deg,var(--navy) 0%,var(--navy-deep) 100%);
    color:#fff; padding:56px 22px 44px; text-align:center;
    position:relative; overflow:hidden;
  }
  .s-hero::before{
    content:""; position:absolute; top:-60px; right:-60px; width:220px; height:220px;
    background:radial-gradient(circle, rgba(56,156,245,0.25) 0%, transparent 70%);
  }
  .s-hero-inner{max-width:520px;margin:0 auto;position:relative;}
  .s-logo{max-width:96px;max-height:70px;margin:0 auto 18px;display:block;border-radius:10px;}
  .s-hero h1{font-size:1.9rem;font-weight:700;margin:0 0 8px;line-height:1.2;}
  .s-hero .s-direccion{color:#A9B6CE;font-size:.9rem;margin:0 0 30px;}

  .s-chat{
    background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1);
    border-radius:16px; padding:20px; text-align:left; backdrop-filter:blur(4px);
  }
  .s-chat-burbuja{
    background:rgba(255,255,255,0.1); border-radius:12px; padding:11px 15px;
    margin-bottom:9px; font-size:.85rem; line-height:1.5; max-width:85%; color:#E8EDF5;
  }
  .s-chat-burbuja.propio{background:var(--blue); color:#fff; margin-left:auto; max-width:80%;}
  .s-chat-label{
    font-size:.68rem; letter-spacing:.06em; text-transform:uppercase; color:#7C8AA8;
    margin-bottom:12px; display:flex; align-items:center; gap:6px;
  }
  .s-chat-label::before{content:"";width:7px;height:7px;border-radius:50%;background:#3ecf7d;display:inline-block;}

  .s-wrap{max-width:560px;margin:0 auto;padding:0 22px 70px;}
  .s-seccion{margin-top:38px;}
  .s-eyebrow{
    font-size:.72rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
    color:var(--amber);margin:0 0 14px;
  }

  .s-grid-items{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;}
  @media(max-width:420px){.s-grid-items{grid-template-columns:1fr;}}
  .s-item-card{
    background:var(--card);border:1px solid var(--line);border-radius:12px;
    padding:14px 16px;display:flex;align-items:center;gap:10px;font-size:.87rem;font-weight:500;
    box-shadow:0 1px 3px rgba(18,32,58,0.04);
  }
  .s-item-icono{font-size:1.15rem;flex-shrink:0;}

  .s-seccion-info .s-info{
    background:var(--card);border-left:3px solid var(--blue);border-radius:0 12px 12px 0;
    padding:18px 20px;font-size:.9rem;line-height:1.65;color:#3A4152;white-space:pre-line;
  }

  .s-cta{
    display:block;text-align:center;background:var(--navy);color:#fff!important;
    text-decoration:none;padding:17px;border-radius:12px;font-weight:600;font-size:.98rem;
    margin-top:40px;transition:background .2s;
  }
  .s-cta:hover{background:var(--navy-deep);}

  footer{text-align:center;color:var(--muted);font-size:.72rem;margin-top:46px;}
</style>
</head>
<body>

  <div class="s-hero">
    <div class="s-hero-inner">
      ${empresa.logoUrl ? `<img class="s-logo" src="${escaparHtml(empresa.logoUrl)}" alt="${escaparHtml(empresa.nombre)}">` : ''}
      <h1>${escaparHtml(nombreCompleto)}</h1>
      ${empresa.direccion ? `<p class="s-direccion">📍 ${escaparHtml(empresa.direccion)}</p>` : ''}

      <div class="s-chat">
        <p class="s-chat-label">Así te responden por WhatsApp</p>
        <div class="s-chat-burbuja propio">${esAgendamiento ? 'Hola, ¿tienen hora para esta semana?' : 'Hola, ¿qué tienen disponible hoy?'}</div>
        <div class="s-chat-burbuja">${esAgendamiento ? '¡Claro! Estos son los próximos días con hora disponible 👇' : 'Esto es lo que tenemos disponible hoy 👇'}</div>
      </div>
    </div>
  </div>

  <div class="s-wrap">
    ${bloqueItems}
    ${bloqueInfo}
    ${botonWhatsApp}
    <footer>Sitio generado automáticamente con Totemsystem</footer>
  </div>

</body>
</html>`;
}

module.exports = { renderSitioNegocio };