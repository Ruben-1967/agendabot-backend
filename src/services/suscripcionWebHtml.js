// HTML de la suscripción web de Multidigital (sitio web + correos): la página
// que abre el cliente desde su link (resumen, contrato, datos y aceptación) y
// las páginas de resultado al volver de Flow. Ver src/routes/suscripcionWeb.js.

const URL_CONTRATO = 'https://multidigital.cl/contrato-sitio-web';
const WHATSAPP_MULTIDIGITAL = '56966108858';

function escapar(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatoCLP(monto) {
  return `$${Number(monto).toLocaleString('es-CL')}`;
}

function formatoFecha(fecha) {
  return new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: 'numeric', month: 'long', year: 'numeric' }).format(fecha);
}

const ESTILOS = `
  *{box-sizing:border-box}
  body{margin:0;font-family:'Inter',system-ui,-apple-system,sans-serif;background:#F1F5F9;color:#0B1D3A}
  .wrap{max-width:620px;margin:0 auto;padding:28px 16px 48px}
  .marca{font-weight:800;letter-spacing:.5px;color:#0B1D3A;margin-bottom:18px}
  .marca span{color:#2EA1FF}
  .card{background:#fff;border-radius:18px;padding:26px 22px;box-shadow:0 10px 30px rgba(11,29,58,.10)}
  h1{font-size:24px;line-height:1.2;margin:0 0 6px}
  .sub{color:#475569;font-size:14px;margin:0 0 20px}
  .resumen{background:#0B1D3A;color:#fff;border-radius:14px;padding:18px 18px;margin-bottom:20px}
  .resumen .plan{font-size:13px;opacity:.75;text-transform:uppercase;letter-spacing:1px;font-weight:700}
  .resumen .monto{font-size:30px;font-weight:800;margin:4px 0 2px}
  .resumen .monto small{font-size:15px;font-weight:600;opacity:.85}
  .resumen ul{margin:12px 0 0;padding-left:18px;font-size:14px;line-height:1.6;color:#DBEAFE}
  label.campo{display:block;font-size:13px;font-weight:700;margin:14px 0 5px}
  input[type=text],input[type=email]{width:100%;padding:11px 12px;border:1.5px solid #CBD5E1;border-radius:10px;font-size:15px;font-family:inherit}
  input:focus{outline:none;border-color:#2EA1FF}
  .acepto{display:flex;gap:10px;align-items:flex-start;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:12px;padding:12px;margin:20px 0 6px;font-size:14px;line-height:1.5}
  .acepto input{margin-top:3px;width:18px;height:18px;flex:none}
  a{color:#1D4ED8}
  button{width:100%;margin-top:16px;background:#16A34A;color:#fff;border:0;border-radius:999px;padding:15px;font-size:16px;font-weight:800;font-family:inherit;cursor:pointer}
  button:disabled{background:#94A3B8;cursor:not-allowed}
  .nota{font-size:12.5px;color:#64748B;line-height:1.5;margin-top:14px}
  .error{background:#FEF2F2;border:1px solid #FCA5A5;color:#991B1B;border-radius:10px;padding:10px 12px;font-size:14px;margin-bottom:14px}
  .ok{font-size:44px;margin-bottom:6px}
  .wa{display:inline-block;margin-top:16px;background:#16A34A;color:#fff;text-decoration:none;font-weight:800;padding:12px 18px;border-radius:999px}
`;

function pagina(titulo, cuerpo) {
  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapar(titulo)} · Multidigital</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>${ESTILOS}</style>
</head><body><div class="wrap">
<div class="marca">MULTI<span>DIGITAL</span></div>
<div class="card">${cuerpo}</div>
</div></body></html>`;
}

// Con fecha ya vencida, Flow cobra al registrar la tarjeta (trial 0), así que
// no se anuncia una fecha pasada.
function primerCobroFuturo(sw) {
  return sw.fechaPrimerCobro && sw.fechaPrimerCobro > new Date() ? sw.fechaPrimerCobro : null;
}

function textoPrimerCargo(sw) {
  if (!primerCobroFuturo(sw)) return 'El primer cargo se hace al registrar tu tarjeta.';
  return `Tu primer período ya está pagado. El primer cargo automático será el <b>${formatoFecha(sw.fechaPrimerCobro)}</b>.`;
}

function renderSuscribir(sw, { error, valores = {} } = {}) {
  const esAnual = sw.plan === 'ANUAL';
  const v = (campo, porDefecto = '') => escapar(valores[campo] ?? porDefecto);
  const cuerpo = `
<h1>Activa tu suscripción</h1>
<p class="sub">Sitio web + 2 correos corporativos${sw.dominio ? ` · ${escapar(sw.dominio)}` : ''}</p>

<div class="resumen">
  <div class="plan">${esAnual ? 'Plan anual' : 'Plan mensual'}</div>
  <div class="monto">${formatoCLP(sw.montoConIva)} <small>IVA incluido / ${esAnual ? 'año' : 'mes'}</small></div>
  <ul>
    <li>${textoPrimerCargo(sw)}</li>
    <li>Luego se cobra automáticamente cada ${esAnual ? 'año' : 'mes'} con la tarjeta que registres.</li>
    <li>Hosting: 1 UF + IVA al año, salvo condiciones especiales acordadas contigo.</li>
    <li>Sin permanencia: te das de baja cuando quieras, avisándonos por escrito.</li>
  </ul>
</div>

${error ? `<div class="error">${escapar(error)}</div>` : ''}

<form method="post" id="form-suscribir">
  <label class="campo" for="razonSocial">Nombre o razón social</label>
  <input type="text" id="razonSocial" name="razonSocial" required maxlength="150" value="${v('razonSocial')}">

  <label class="campo" for="rut">RUT</label>
  <input type="text" id="rut" name="rut" required maxlength="12" placeholder="12.345.678-9" value="${v('rut')}">

  <label class="campo" for="domicilio">Domicilio</label>
  <input type="text" id="domicilio" name="domicilio" required maxlength="200" value="${v('domicilio')}">

  <label class="campo" for="email">Correo (aquí te llegan los comprobantes)</label>
  <input type="email" id="email" name="email" required maxlength="150" value="${v('email', sw.emailCliente)}">

  <label class="campo" for="nombreQuienAcepta">Tu nombre (quien acepta)</label>
  <input type="text" id="nombreQuienAcepta" name="nombreQuienAcepta" required maxlength="120" value="${v('nombreQuienAcepta')}">

  <label class="acepto">
    <input type="checkbox" name="acepto" id="acepto" value="si" required>
    <span>He leído y acepto el <a href="${URL_CONTRATO}" target="_blank" rel="noopener">contrato de servicios</a> y autorizo a Multidigital SpA a cobrar el plan elegido con cargo automático a mi tarjeta, a través de Flow.</span>
  </label>

  <button type="submit" id="btn">Aceptar y registrar mi tarjeta</button>
</form>
<p class="nota">Serás dirigido a Flow, la plataforma de pagos, para registrar tu tarjeta de forma segura. Multidigital no ve ni guarda los datos de tu tarjeta. Flow puede hacer un cargo de prueba de $50 que se devuelve automáticamente.</p>
<script>
  // Sin JS igual funciona: el checkbox es required y el servidor lo valida.
  var c = document.getElementById('acepto'), b = document.getElementById('btn');
  b.disabled = !c.checked;
  c.addEventListener('change', function(){ b.disabled = !c.checked; });
  document.getElementById('form-suscribir').addEventListener('submit', function(){ b.disabled = true; b.textContent = 'Un momento…'; });
</script>`;
  return pagina('Activa tu suscripción', cuerpo);
}

function enlaceWhatsapp(texto) {
  return `https://wa.me/${WHATSAPP_MULTIDIGITAL}?text=${encodeURIComponent(texto)}`;
}

function renderResultado(tipo, sw) {
  if (tipo === 'exito') {
    const proximo = primerCobroFuturo(sw)
      ? `El primer cargo automático será el <b>${formatoFecha(sw.fechaPrimerCobro)}</b>.`
      : 'El cargo del primer período se procesa en los próximos minutos y Flow te enviará el comprobante por correo.';
    return pagina('Suscripción activa', `
<div class="ok">✅</div>
<h1>¡Listo! Tu suscripción quedó activa</h1>
<p class="sub">${sw.tarjetaUltimos4 ? `Tarjeta terminada en ${escapar(sw.tarjetaUltimos4)}. ` : ''}${proximo}</p>
<p class="nota">Guardamos el registro de tu aceptación del contrato. Si tienes cualquier duda, escríbenos.</p>
<a class="wa" href="${enlaceWhatsapp('Hola Multidigital, acabo de activar mi suscripción')}">Escribir por WhatsApp</a>`);
  }
  if (tipo === 'procesando') {
    return pagina('Procesando', `
<h1>Estamos terminando de activar tu suscripción</h1>
<p class="sub">Tu tarjeta ya quedó registrada. Si en unos minutos no recibes la confirmación, escríbenos.</p>
<a class="wa" href="${enlaceWhatsapp('Hola Multidigital, registré mi tarjeta y quiero confirmar mi suscripción')}">Escribir por WhatsApp</a>`);
  }
  if (tipo === 'cancelada') {
    return pagina('Suscripción cancelada', `
<h1>Esta suscripción está cancelada</h1>
<p class="sub">Si quieres reactivarla, escríbenos y te enviamos un link nuevo.</p>
<a class="wa" href="${enlaceWhatsapp('Hola Multidigital, quiero reactivar mi suscripción')}">Escribir por WhatsApp</a>`);
  }
  if (tipo === 'no-encontrada') {
    return pagina('Link no válido', `
<h1>Este link no es válido</h1>
<p class="sub">Revisa que lo hayas copiado completo, o escríbenos para enviarte uno nuevo.</p>
<a class="wa" href="${enlaceWhatsapp('Hola Multidigital, mi link de suscripción no funciona')}">Escribir por WhatsApp</a>`);
  }
  return pagina('No se pudo completar', `
<h1>No pudimos completar el registro</h1>
<p class="sub">Tu suscripción no quedó activa. Puedes volver a intentarlo desde el mismo link, o escribirnos y te ayudamos.</p>
${sw ? `<p><a href="${escapar(`/web/suscribir/${sw.ref}`)}">Volver a intentarlo</a></p>` : ''}
<a class="wa" href="${enlaceWhatsapp('Hola Multidigital, tuve un problema al registrar mi tarjeta')}">Escribir por WhatsApp</a>`);
}

module.exports = { renderSuscribir, renderResultado, URL_CONTRATO, formatoFecha };
