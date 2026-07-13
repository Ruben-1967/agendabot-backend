// Genera el HTML de la página de selección de plan + aceptación de contrato,
// y la página de confirmación tras aceptar. No requiere frontend aparte:
// todo se sirve como HTML directo desde el mismo backend.

const PLANES = {
  PLAN_A: {
    etiqueta: 'Plan A',
    montoMensual: 9900,
    citasIncluidas: 100,
    precioCitaExcedente: 150,
  },
  PLAN_B: {
    etiqueta: 'Plan B',
    montoMensual: 19900,
    citasIncluidas: 250,
    precioCitaExcedente: 110,
  },
  PLAN_C: {
    etiqueta: 'Plan C',
    montoMensual: 49900,
    citasIncluidas: 700,
    precioCitaExcedente: 90,
  },
};

const ESTILOS = `
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #F0EEE2; color: #16241F; margin: 0; padding: 0; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 40px 24px 80px; }
  h1 { font-size: 1.6rem; margin-bottom: 4px; }
  .sub { color: #6B7770; font-size: 0.95rem; margin-bottom: 32px; }
  .planes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 32px; }
  .plan-card { background: #FAF8EF; border: 2px solid #DAD4C0; border-radius: 8px; padding: 16px; cursor: pointer; }
  .plan-card:has(input:checked) { border-color: #2F6F62; background: #E4EDE9; }
  .plan-card input { margin-right: 6px; }
  .plan-nombre { font-weight: 600; font-size: 1.1rem; margin-bottom: 4px; }
  .plan-precio { font-size: 1.3rem; color: #1F4E44; margin: 6px 0; }
  .plan-detalle { font-size: 0.82rem; color: #6B7770; line-height: 1.5; }
  fieldset { border: 1px solid #DAD4C0; border-radius: 8px; padding: 16px 20px; margin-bottom: 20px; background: #FAF8EF; }
  legend { font-weight: 600; padding: 0 8px; }
  label { display: block; margin-bottom: 12px; font-size: 0.92rem; }
  input[type=text], input[type=email] { width: 100%; padding: 8px; border: 1px solid #DAD4C0; border-radius: 4px; margin-top: 4px; box-sizing: border-box; }
  .checkbox-row { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 14px; }
  .checkbox-row input { margin-top: 3px; }
  .aviso { background: #F3E7D2; border: 1px solid #E0C89A; border-radius: 6px; padding: 12px 16px; font-size: 0.85rem; margin-bottom: 24px; }
  .pendiente { background: #F3E1DC; border: 1px solid #E0BDB4; border-radius: 6px; padding: 12px 16px; font-size: 0.85rem; margin-bottom: 24px; }
  button { background: #16241F; color: #F0EEE2; border: none; padding: 14px 28px; border-radius: 6px; font-size: 1rem; cursor: pointer; }
  button:hover { background: #2F6F62; }
  .ok { text-align: center; padding: 60px 24px; }
  .ok h1 { color: #1F4E44; }
`;

function renderFormulario(empresa) {
  const opciones = Object.entries(PLANES)
    .map(
      ([clave, p], i) => `
    <label class="plan-card">
      <input type="radio" name="plan" value="${clave}" ${i === 0 ? 'checked' : ''} required>
      <div class="plan-nombre">${p.etiqueta}</div>
      <div class="plan-precio">$${p.montoMensual.toLocaleString('es-CL')}<span style="font-size:0.7rem;">/mes</span></div>
      <div class="plan-detalle">
        ${p.citasIncluidas} citas incluidas<br>
        Excedente: $${p.precioCitaExcedente}/cita<br>
        + 1 UF hosting/año
      </div>
    </label>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Contrato de servicio - AgendaBot</title>
<style>${ESTILOS}</style>
</head>
<body>
<div class="wrap">
  <h1>Contrato de servicio - AgendaBot</h1>
  <p class="sub">${empresa.nombre}${empresa.sucursal ? ' - ' + empresa.sucursal : ''}</p>

  <form method="POST" action="/contrato/${empresa.id}/aceptar">
    <fieldset>
      <legend>1. Elige tu plan</legend>
      <div class="planes">${opciones}</div>
      <p style="font-size:0.8rem;color:#6B7770;">
        El hosting (1 UF/año) se cobra junto con el primer pago, y luego una vez al año en la fecha
        de aniversario del contrato, convertido de UF a CLP al valor del día.
      </p>
    </fieldset>

    <fieldset>
      <legend>2. Tus datos</legend>
      <label>Nombre completo de quien acepta
        <input type="text" name="nombreQuienAcepta" required>
      </label>
      <label>Correo electrónico
        <input type="email" name="emailQuienAcepta" required>
      </label>
    </fieldset>

    <fieldset>
      <legend>3. Condiciones del servicio</legend>
      <p style="font-size:0.88rem; line-height:1.6;">
        El proveedor del servicio es Ruben Gonzalez Erazo, operando bajo el nombre comercial
        "Multidigital" (persona natural, RUT pendiente de registro formal ante el SII).
        El servicio contratado es AgendaBot: agendamiento de citas y atencion automatizada
        via WhatsApp con inteligencia artificial, para el negocio arriba indicado.
      </p>
      <p style="font-size:0.88rem; line-height:1.6;">
        La mensualidad se cobra todos los meses de forma automatica. El primer cobro incluye
        la mensualidad del plan elegido mas el hosting anual (1 UF). El plan puede cambiarse
        de categoria (A/B/C) en cualquier momento, avisando con al menos 5 dias de anticipacion
        al proximo ciclo de cobro.
      </p>
      <div class="pendiente">
        <b>Clausulas pendientes de incorporar como anexo:</b> reajuste anual del precio mensual
        segun IPC, y ajuste del precio de excedente segun costos de proveedores (WhatsApp/Meta,
        Claude/Anthropic). Se agregaran con valores concretos cuando Meta publique sus nuevas
        tarifas (esperadas octubre 2026), y se notificaran por escrito antes de aplicarse.
      </div>

      <div class="checkbox-row">
        <input type="checkbox" name="aceptoTerminos" value="true" required id="terminos">
        <label for="terminos" style="margin:0;">Acepto los terminos comerciales descritos arriba.</label>
      </div>
      <div class="checkbox-row">
        <input type="checkbox" name="aceptoDatosPacientes" value="true" required id="datos">
        <label for="datos" style="margin:0;">
          Autorizo el tratamiento de los datos de mis pacientes/clientes (ej. recetas opticas,
          historial de compras) conforme a la Ley 19.628 sobre Proteccion de la Vida Privada,
          exclusivamente para la prestacion del servicio contratado.
        </label>
      </div>
    </fieldset>

    <div class="aviso">
      Este documento es un borrador de condiciones comerciales. Se recomienda revision legal
      antes de considerarlo un contrato vinculante definitivo.
    </div>

    <button type="submit">Aceptar y confirmar plan</button>
  </form>
</div>
</body>
</html>`;
}

function renderConfirmacion({ empresa, plan, nombreQuienAcepta }) {
  const p = PLANES[plan];
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Contrato aceptado</title>
<style>${ESTILOS}</style>
</head>
<body>
<div class="wrap ok">
  <h1>Contrato aceptado ✓</h1>
  <p>Gracias, ${nombreQuienAcepta}.</p>
  <p>${empresa.nombre} quedo registrada en <b>${p.etiqueta}</b> ($${p.montoMensual.toLocaleString('es-CL')}/mes,
  ${p.citasIncluidas} citas incluidas).</p>
  <p style="color:#6B7770; font-size:0.9rem;">Puedes cerrar esta ventana.</p>
</div>
</body>
</html>`;
}

module.exports = { renderFormulario, renderConfirmacion, PLANES };
