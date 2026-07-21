// Página estática (self-hosted, sin depender de servicios externos) que
// muestra un recorrido visual del panel de administración de Totemsystem.
// Se envía como link dentro del chat de demo — WhatsApp no permite mostrar
// HTML interactivo dentro del chat mismo, así que esto abre en el navegador.

function renderPanelDemo() {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Totemsystem · Panel de administración</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{--paper:#F0EEE2;--card:#FAF8EF;--ink:#16241F;--teal:#2F6F62;--teal-deep:#1F4E44;--teal-soft:#E4EDE9;--brass:#B8863B;--line:#DAD4C0;--muted:#6B7770;}
  *{box-sizing:border-box;}
  body{margin:0;background:var(--paper);color:var(--ink);font-family:'Inter',sans-serif;}
  .wrap{max-width:720px;margin:0 auto;padding:0 20px 60px;}
  header{background:var(--ink);color:var(--paper);padding:40px 20px 32px;text-align:center;}
  header .brand{font-family:'Fraunces',serif;font-weight:700;font-size:1.3rem;}
  header .brand .accent{color:var(--brass);}
  header h1{font-family:'Fraunces',serif;font-size:1.6rem;margin:10px 0 6px;}
  header p{color:#CBD6D0;font-size:.92rem;max-width:480px;margin:0 auto;}
  section{margin-top:34px;}
  .eyebrow{font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:var(--brass);font-weight:700;margin:0 0 6px;}
  h2{font-family:'Fraunces',serif;font-size:1.25rem;margin:0 0 6px;}
  .sub{color:var(--muted);font-size:.88rem;margin:0 0 16px;}
  .mockup{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:20px;box-shadow:0 2px 10px rgba(0,0,0,.04);}
  .mock-row{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--line);font-size:.85rem;}
  .mock-row:last-child{border-bottom:none;}
  .badge{font-size:.68rem;font-weight:700;padding:3px 9px;border-radius:12px;background:var(--teal-soft);color:var(--teal-deep);}
  .badge.warn{background:#F3E7D2;color:var(--brass);}
  .cta{display:block;text-align:center;background:var(--teal-deep);color:#fff;text-decoration:none;padding:14px;border-radius:8px;font-weight:600;margin-top:30px;}
</style>
</head>
<body>
<header>
  <div class="brand">totem<span class="accent">system</span></div>
  <h1>Así se ve el panel por dentro</h1>
  <p>El bot conversa con tus clientes por WhatsApp — tú administras todo desde acá, sin salir de tu celular o computador.</p>
</header>
<div class="wrap">
  <section>
    <p class="eyebrow">Agenda del día</p>
    <h2>Todas tus citas de hoy, de un vistazo</h2>
    <p class="sub">Generada sola a partir de lo que se agendó por WhatsApp — nada que cargar a mano.</p>
    <div class="mockup">
      <div class="mock-row"><span>09:00 · María Pérez — Control anual</span><span class="badge">Confirmada</span></div>
      <div class="mock-row"><span>10:30 · Javier Soto — Examen de la vista</span><span class="badge">Confirmada</span></div>
      <div class="mock-row"><span>12:00 · Antonia Vidal — Adaptación lentes</span><span class="badge warn">Pendiente</span></div>
    </div>
  </section>
  <section>
    <p class="eyebrow">Configuración de agenda</p>
    <h2>Tu horario, tus servicios, tus reglas</h2>
    <p class="sub">Define horario semanal, bloquea vacaciones o feriados, y activa/desactiva servicios cuando quieras.</p>
    <div class="mockup">
      <div class="mock-row"><span>Lunes a viernes</span><span>09:30 – 19:00</span></div>
      <div class="mock-row"><span>Sábado</span><span>10:00 – 14:00</span></div>
      <div class="mock-row"><span>Fiestas Patrias</span><span class="badge warn">Bloqueado</span></div>
    </div>
  </section>
  <section>
    <p class="eyebrow">Información del negocio</p>
    <h2>El bot usa tus datos reales, no genéricos</h2>
    <p class="sub">Dirección, precios, promociones — tú lo escribes una vez, el bot lo cita tal cual cuando un cliente pregunta.</p>
  </section>
  <section>
    <p class="eyebrow">Campañas</p>
    <h2>Manda promociones segmentadas, sin elegir cliente por cliente</h2>
    <p class="sub">Ej. solo a quienes ya compraron antes, o a quienes no vienen hace 60 días.</p>
  </section>
  <a class="cta" href="https://multidigital.cl/totemsystem#contratar">¿Seguimos? Hablemos de tu negocio 👉</a>
</div>
</body>
</html>`;
}

module.exports = { renderPanelDemo };