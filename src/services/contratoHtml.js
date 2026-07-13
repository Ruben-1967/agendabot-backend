// Genera el HTML de la página de selección de plan + aceptación de contrato,
// con la identidad visual de MultiDigital (acordeón de cláusulas, paleta
// teal/brass, tipografía Fraunces + Inter + IBM Plex Mono).

const PLANES = {
  PLAN_A: { etiqueta: 'Plan A', montoMensual: 9900, citasIncluidas: 100, precioCitaExcedente: 150 },
  PLAN_B: { etiqueta: 'Plan B', montoMensual: 19900, citasIncluidas: 250, precioCitaExcedente: 110 },
  PLAN_C: { etiqueta: 'Plan C', montoMensual: 49900, citasIncluidas: 700, precioCitaExcedente: 90 },
};

function renderFormulario(empresa) {
  const nombreEmpresa = empresa.sucursal ? `${empresa.nombre} · ${empresa.sucursal}` : empresa.nombre;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MultiDigital · Confirmar suscripción</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root{
    --paper:#F0EEE2;
    --card:#FAF8EF;
    --ink:#16241F;
    --teal:#2F6F62;
    --teal-deep:#1F4E44;
    --teal-soft:#E4EDE9;
    --brass:#B8863B;
    --brass-soft:#F3E7D2;
    --line:#DAD4C0;
    --muted:#6B7770;
  }
  *{box-sizing:border-box;}
  body{
    margin:0;background:var(--paper);color:var(--ink);
    font-family:'Inter',system-ui,sans-serif;-webkit-font-smoothing:antialiased;
    display:flex;justify-content:center;padding:36px 16px 80px;
  }
  .screen{width:100%;max-width:480px;}

  .brand-row{display:flex;align-items:center;gap:8px;margin-bottom:18px;}
  .brand{font-family:'Fraunces',serif;font-weight:600;font-size:1.05rem;}
  .brand .accent{color:var(--brass);}
  .step-tag{
    font-family:'IBM Plex Mono',monospace;font-size:.68rem;color:var(--muted);
    letter-spacing:.06em;text-transform:uppercase;margin-left:auto;
  }

  h1{font-family:'Fraunces',serif;font-weight:600;font-size:1.5rem;margin:0 0 4px;}
  .sub{color:var(--muted);font-size:.9rem;margin:0 0 22px;line-height:1.5;}

  /* ---------- SELECTOR DE PLAN ---------- */
  .plan-selector{display:flex;gap:8px;margin-bottom:14px;}
  .plan-option{
    flex:1;text-align:center;padding:11px 6px;border:1.5px solid var(--line);border-radius:8px;
    cursor:pointer;background:var(--card);transition:background .15s,border-color .15s;
  }
  .plan-option .name{font-weight:600;font-size:.85rem;}
  .plan-option .price{font-family:'IBM Plex Mono',monospace;font-size:.76rem;color:var(--muted);margin-top:2px;}
  .plan-option.active{background:var(--teal);border-color:var(--teal);}
  .plan-option.active .name,.plan-option.active .price{color:var(--paper);}

  /* ---------- PLAN CARD (detalle del plan elegido) ---------- */
  .plan-card{background:var(--ink);color:var(--paper);border-radius:10px;padding:20px 22px;margin-bottom:16px;}
  .plan-card .tag{
    font-family:'IBM Plex Mono',monospace;font-size:.66rem;letter-spacing:.08em;text-transform:uppercase;
    color:#9FB3AB;margin-bottom:6px;
  }
  .plan-card h2{font-family:'Fraunces',serif;font-weight:600;font-size:1.25rem;margin:0 0 14px;}
  .price-line{display:flex;justify-content:space-between;align-items:baseline;padding:7px 0;border-top:1px solid #2A3B34;}
  .price-line:first-of-type{border-top:none;}
  .price-line .lbl{font-size:.82rem;color:#CBD6D0;}
  .price-line .val{font-family:'IBM Plex Mono',monospace;font-weight:600;font-size:.95rem;}
  .price-line .val small{color:#9FB3AB;font-weight:400;font-size:.72rem;}
  .first-charge{margin-top:12px;padding:11px 13px;background:#22352E;border-radius:6px;font-size:.8rem;color:#CBD6D0;}
  .first-charge b{color:var(--brass);}

  /* ---------- SUMMARY ---------- */
  .summary{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px 20px;margin-bottom:14px;}
  .summary h3{font-family:'Fraunces',serif;font-size:1rem;margin:0 0 10px;font-weight:600;}
  .summary ul{margin:0;padding:0;list-style:none;}
  .summary li{display:flex;gap:9px;font-size:.86rem;padding:7px 0;border-bottom:1px solid var(--line);line-height:1.4;}
  .summary li:last-child{border-bottom:none;}
  .summary li::before{content:"✓";color:var(--teal);font-weight:700;flex-shrink:0;}

  /* ---------- TUS DATOS ---------- */
  .your-data{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px 20px;margin-bottom:14px;}
  .your-data h3{font-family:'Fraunces',serif;font-size:1rem;margin:0 0 12px;font-weight:600;}
  .your-data label{display:block;font-size:.83rem;color:#3A4842;margin-bottom:12px;}
  .your-data label:last-child{margin-bottom:0;}
  .your-data input{
    width:100%;margin-top:5px;padding:9px 10px;border:1px solid var(--line);border-radius:6px;
    font-family:'Inter',sans-serif;font-size:.88rem;background:#fff;
  }

  /* ---------- ACCORDION ---------- */
  .accordion{background:var(--card);border:1px solid var(--line);border-radius:10px;margin-bottom:14px;overflow:hidden;}
  .accordion-head{display:flex;justify-content:space-between;align-items:center;padding:15px 20px;cursor:pointer;user-select:none;}
  .accordion-head span.title{font-weight:600;font-size:.88rem;}
  .accordion-head .chev{transition:transform .2s;color:var(--muted);font-size:.8rem;}
  .accordion.open .chev{transform:rotate(180deg);}
  .accordion-body{max-height:0;overflow:hidden;transition:max-height .25s ease;padding:0 20px;font-size:.8rem;color:#3A4842;line-height:1.6;}
  .accordion.open .accordion-body{max-height:1200px;padding:0 20px 18px;overflow-y:auto;}
  .clause{margin-bottom:10px;}
  .clause b{color:var(--ink);}

  /* ---------- CONSENT ---------- */
  .consent{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px 18px;margin-bottom:18px;}
  .check-row{display:flex;gap:10px;align-items:flex-start;padding:8px 0;}
  .check-row input{margin-top:3px;width:16px;height:16px;accent-color:var(--teal);flex-shrink:0;}
  .check-row label{font-size:.83rem;line-height:1.45;color:#3A4842;}

  /* ---------- BUTTON ---------- */
  .subscribe-btn{
    width:100%;padding:15px;border:none;border-radius:8px;background:var(--line);color:#8B9188;
    font-weight:600;font-size:.95rem;cursor:not-allowed;transition:background .2s,color .2s;font-family:'Inter',sans-serif;
  }
  .subscribe-btn.enabled{background:var(--teal);color:var(--paper);cursor:pointer;}
  .subscribe-btn.enabled:hover{background:var(--teal-deep);}
  .fineprint{font-size:.72rem;color:var(--muted);text-align:center;margin-top:12px;line-height:1.5;}

  /* ---------- CONFIRMATION STATE ---------- */
  .confirm-box{
    display:none;background:var(--teal-soft);border:1.5px solid var(--teal);border-radius:10px;
    padding:22px 20px;text-align:center;margin-bottom:14px;
  }
  .confirm-box.show{display:block;}
  .confirm-box .check-icon{
    width:44px;height:44px;border-radius:50%;background:var(--teal);color:var(--paper);
    display:flex;align-items:center;justify-content:center;font-size:1.3rem;margin:0 auto 12px;
  }
  .confirm-box h3{font-family:'Fraunces',serif;margin:0 0 6px;font-size:1.1rem;color:var(--teal-deep);}
  .confirm-box p{margin:0 0 4px;font-size:.85rem;color:#3A4842;}
  .confirm-log{
    margin-top:12px;padding:10px 12px;background:#fff;border-radius:6px;
    font-family:'IBM Plex Mono',monospace;font-size:.7rem;color:var(--muted);text-align:left;
  }
  .error-msg{
    display:none;background:var(--brass-soft);border:1px solid var(--brass);border-radius:8px;
    padding:12px 14px;font-size:.82rem;color:#5C4A2E;margin-bottom:14px;
  }
  .error-msg.show{display:block;}
</style>
</head>
<body>

<div class="screen">

  <div class="brand-row">
    <span class="brand">multi<span class="accent">digital</span></span>
    <span class="step-tag">Suscripción AgendaBot</span>
  </div>

  <h1>Confirma tu suscripción</h1>
  <p class="sub">Elige tu plan, revisa el resumen, abre los términos completos si quieres leerlos, y confirma con un clic. Sin papel, sin firma manuscrita.</p>

  <div id="plan-section">

    <div class="plan-selector" id="plan-selector"></div>

    <div class="plan-card">
      <p class="tag">${nombreEmpresa}</p>
      <h2 id="sel-plan-name"></h2>
      <div class="price-line"><span class="lbl">Mensualidad</span><span class="val" id="sel-monto"></span></div>
      <div class="price-line"><span class="lbl">Citas incluidas</span><span class="val" id="sel-citas"></span></div>
      <div class="price-line"><span class="lbl">Excedente por cita</span><span class="val" id="sel-excedente"></span></div>
      <div class="price-line"><span class="lbl">Hosting (anual)</span><span class="val">1 UF<small> /año</small></span></div>
      <div class="first-charge" id="sel-first-charge"></div>
    </div>

    <div class="summary">
      <h3>En simple, esto significa</h3>
      <ul>
        <li>Agendamiento, chatbot IA, panel administrativo, panel profesional y ficha de pacientes incluidos</li>
        <li>Puedes cambiar de plan (A/B/C) en cualquier momento, avisando con anticipación</li>
        <li>Puedes cancelar cuando quieras, avisando con 30 días de anticipación</li>
        <li>Los datos de tus pacientes son tuyos — exportables si algún día te vas</li>
        <li>La cuenta de WhatsApp Business queda a tu nombre, no al de MultiDigital</li>
      </ul>
    </div>

    <div class="your-data">
      <h3>Quién acepta</h3>
      <label>Nombre completo
        <input type="text" id="nombreQuienAcepta" placeholder="Tu nombre completo">
      </label>
      <label>Correo electrónico
        <input type="email" id="emailQuienAcepta" placeholder="tu@correo.cl">
      </label>
    </div>

    <div class="accordion" id="accordion">
      <div class="accordion-head" onclick="toggleAccordion()">
        <span class="title">Leer términos completos del contrato</span>
        <span class="chev">▾</span>
      </div>
      <div class="accordion-body">
        <div class="clause"><b>1. Partes.</b> Multidigital, nombre comercial bajo el cual opera Ruben González Erazo (persona natural), en adelante "el proveedor", y ${nombreEmpresa}, en adelante "el cliente".</div>
        <div class="clause"><b>2. Objeto.</b> Agendamiento, chatbot IA, panel administrativo, panel profesional y administración de pacientes, según el plan elegido (A, B o C).</div>
        <div class="clause"><b>3. Plazo de implementación.</b> Aproximadamente 3 semanas desde la aceptación y la entrega de información por parte del cliente.</div>
        <div class="clause"><b>4. Duración.</b> Continua, sin permanencia mínima. Renovación automática mensual. Cualquiera de las partes puede terminar el contrato con 30 días de aviso previo.</div>
        <div class="clause"><b>5. Precio.</b> El precio mensual corresponde al plan elegido: Plan A ($9.900/mes, 100 citas incluidas, excedente $150/cita), Plan B ($19.900/mes, 250 citas incluidas, excedente $110/cita), o Plan C ($49.900/mes, 700 citas incluidas, excedente $90/cita). Incluye hosting anual de 1 UF, facturado junto al primer pago y luego una vez al año. El cliente puede cambiar de plan en cualquier momento, avisando con al menos 5 días de anticipación al próximo ciclo de cobro.</div>
        <div class="clause"><b>6. Cuentas de terceros.</b> La Business Manager y el WhatsApp Business Account quedan a nombre del cliente. Multidigital opera como partner técnico delegado.</div>
        <div class="clause"><b>7. Datos y privacidad.</b> El tratamiento de datos personales y de salud se rige por la Ley 19.628. Multidigital actúa como encargado del tratamiento, implementando medidas de seguridad razonables. El cliente es responsable de obtener el consentimiento de sus propios pacientes.</div>
        <div class="clause"><b>8. Propiedad intelectual y de datos.</b> El software es propiedad de Multidigital. Los datos del cliente (pacientes, citas, recetas) le pertenecen al cliente y son exportables al término del contrato.</div>
        <div class="clause"><b>9. Soporte.</b> Prioritario por WhatsApp en horario hábil. No incluye SLA de disponibilidad garantizado salvo acuerdo específico por escrito.</div>
        <div class="clause"><b>10. Responsabilidad limitada.</b> Multidigital no responde por interrupciones atribuibles a terceros (Meta/WhatsApp, proveedor de hosting). La responsabilidad total se limita al equivalente de 3 meses de facturación.</div>
        <div class="clause"><b>11. Terminación.</b> Por incumplimiento grave o falta de pago. El cliente conserva derecho a exportar sus datos.</div>
        <div class="clause"><b>12. Reajuste anual por costo de vida.</b> El valor mensual del plan podrá reajustarse una vez al año, en el mes de aniversario del contrato, según la variación del IPC del período, con aviso previo de 30 días al cliente.</div>
        <div class="clause"><b>13. Ajuste por costos de proveedores.</b> El precio del excedente por cita adicional, y/o el número de citas incluidas en el plan, podrán ajustarse si los costos de mensajería (WhatsApp Business Platform) o de procesamiento de inteligencia artificial (API de Claude/Anthropic) cambian de forma material por decisión de dichos proveedores, con aviso previo de 30 días al cliente. Este ajuste es independiente del reajuste anual de la cláusula 12.</div>
        <div class="clause"><b>14. Ley aplicable.</b> Leyes de la República de Chile.</div>
        <div class="clause"><b>15. Aceptación electrónica.</b> Este contrato se acepta electrónicamente conforme a la Ley 19.799 sobre documentos electrónicos y firma electrónica. La aceptación queda registrada con fecha, hora y usuario.</div>
      </div>
    </div>

    <div class="consent">
      <div class="check-row">
        <input type="checkbox" id="c1" onchange="checkForm()">
        <label for="c1">He leído y acepto los <b>Términos de Servicio</b> del plan elegido, incluyendo precio, duración y condiciones de cancelación.</label>
      </div>
      <div class="check-row">
        <input type="checkbox" id="c2" onchange="checkForm()">
        <label for="c2">Autorizo el tratamiento de datos de mis pacientes conforme a la <b>Ley 19.628</b>, entendiendo que ${nombreEmpresa} es responsable de obtener el consentimiento de cada paciente.</label>
      </div>
    </div>

    <div class="error-msg" id="error-msg"></div>

    <button class="subscribe-btn" id="subscribe-btn" onclick="subscribe()" disabled>Confirmar suscripción</button>
    <p class="fineprint">Al confirmar, se registra tu aceptación con fecha, hora y este dispositivo, con el mismo valor que una firma en papel.</p>
  </div>

  <div class="confirm-box" id="confirm-box">
    <div class="check-icon">✓</div>
    <h3>Suscripción confirmada</h3>
    <p id="confirm-empresa"></p>
    <p>Recibirás la confirmación y una copia de los términos por correo.</p>
    <div class="confirm-log" id="confirm-log"></div>
  </div>

</div>

<script>
  const EMPRESA_ID = ${JSON.stringify(empresa.id)};
  const NOMBRE_EMPRESA = ${JSON.stringify(nombreEmpresa)};
  const PLANES = ${JSON.stringify(PLANES)};
  let planActual = 'PLAN_A';

  function formatoCLP(n){ return '$' + n.toLocaleString('es-CL'); }

  function pintarSelector(){
    const cont = document.getElementById('plan-selector');
    cont.innerHTML = Object.entries(PLANES).map(([clave, p]) => \`
      <div class="plan-option \${clave === planActual ? 'active' : ''}" onclick="elegirPlan('\${clave}')">
        <div class="name">\${p.etiqueta}</div>
        <div class="price">\${formatoCLP(p.montoMensual)}/mes</div>
      </div>
    \`).join('');
  }

  function elegirPlan(clave){
    planActual = clave;
    pintarSelector();
    pintarDetalle();
    checkForm();
  }

  function pintarDetalle(){
    const p = PLANES[planActual];
    document.getElementById('sel-plan-name').textContent = p.etiqueta;
    document.getElementById('sel-monto').innerHTML = formatoCLP(p.montoMensual) + '<small> /mes</small>';
    document.getElementById('sel-citas').innerHTML = p.citasIncluidas + '<small> /mes</small>';
    document.getElementById('sel-excedente').innerHTML = formatoCLP(p.precioCitaExcedente) + '<small> /cita</small>';
    document.getElementById('sel-first-charge').innerHTML =
      'Primer cobro hoy: <b>1 UF + ' + formatoCLP(p.montoMensual) + '</b> — desde el mes 2 se factura solo la mensualidad.';
    document.getElementById('subscribe-btn').textContent = 'Confirmar suscripción — ' + formatoCLP(p.montoMensual) + '/mes';
  }

  function toggleAccordion(){
    document.getElementById('accordion').classList.toggle('open');
  }

  function checkForm(){
    const c1 = document.getElementById('c1').checked;
    const c2 = document.getElementById('c2').checked;
    const nombre = document.getElementById('nombreQuienAcepta').value.trim();
    const email = document.getElementById('emailQuienAcepta').value.trim();
    const btn = document.getElementById('subscribe-btn');
    if(c1 && c2 && nombre && email){
      btn.disabled = false;
      btn.classList.add('enabled');
    } else {
      btn.disabled = true;
      btn.classList.remove('enabled');
    }
  }

  async function subscribe(){
    const btn = document.getElementById('subscribe-btn');
    const errorBox = document.getElementById('error-msg');
    errorBox.classList.remove('show');
    btn.disabled = true;
    btn.textContent = 'Enviando...';

    const nombreQuienAcepta = document.getElementById('nombreQuienAcepta').value.trim();
    const emailQuienAcepta = document.getElementById('emailQuienAcepta').value.trim();

    try {
      const resp = await fetch('/contrato/' + EMPRESA_ID + '/aceptar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: planActual,
          nombreQuienAcepta,
          emailQuienAcepta,
          aceptoTerminos: true,
          aceptoDatosPacientes: true,
        }),
      });

      if(!resp.ok){
        throw new Error('El servidor respondió con un error');
      }

      const data = await resp.json();

      document.getElementById('plan-section').style.display = 'none';
      const box = document.getElementById('confirm-box');
      box.classList.add('show');
      document.getElementById('confirm-empresa').textContent =
        NOMBRE_EMPRESA + ' está suscrita al ' + PLANES[planActual].etiqueta + '.';

      const now = new Date();
      const fecha = now.toLocaleDateString('es-CL', {day:'2-digit', month:'long', year:'numeric'});
      const hora = now.toLocaleTimeString('es-CL', {hour:'2-digit', minute:'2-digit'});
      document.getElementById('confirm-log').textContent =
        'Registro de aceptación — ' + fecha + ', ' + hora + ' hrs · ' + PLANES[planActual].etiqueta + ' · ' + NOMBRE_EMPRESA;
    } catch (err) {
      errorBox.textContent = 'No pudimos registrar tu aceptación. Por favor intenta de nuevo en unos segundos.';
      errorBox.classList.add('show');
      btn.disabled = false;
      btn.classList.add('enabled');
      btn.textContent = 'Confirmar suscripción — ' + formatoCLP(PLANES[planActual].montoMensual) + '/mes';
    }
  }

  document.getElementById('nombreQuienAcepta').addEventListener('input', checkForm);
  document.getElementById('emailQuienAcepta').addEventListener('input', checkForm);

  pintarSelector();
  pintarDetalle();
</script>

</body>
</html>`;
}

module.exports = { renderFormulario, PLANES };
