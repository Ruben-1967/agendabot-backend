/**
 * src/services/catalogoGestionVenta.js
 *
 * Catálogo cerrado del árbol de gestión de ventas (arbol-gestion-ventas-DISENO.md).
 * Vive en código, no en la base de datos — así se puede extender sin migración,
 * pero sigue siendo un catálogo cerrado: el backend valida cualquier
 * `resultado`/`motivoDescarte` que llegue contra estas listas y rechaza lo que
 * no esté acá. Nunca texto libre.
 *
 * `reseteaTimer` por resultado fue confirmado explícitamente por Ruben,
 * resultado por resultado — no es una decisión tomada acá.
 *
 * `cerrado_perdido` aparece como resultado válido en los 5 canales (decisión
 * confirmada: reutilizar la estructura existente en vez de un mecanismo
 * transversal aparte). Cuando resultado === 'cerrado_perdido', el endpoint que
 * crea el evento puebla DemoAsignada.cerradaEn automáticamente, en la misma
 * transacción — eso saca el caso del radar de aging/SLA (slaService.js) sin
 * tocar el ranking ni liberar el teléfono.
 */

const CATALOGO_RESULTADOS = {
  WHATSAPP: [
    { clave: 'contactado_interesado', etiqueta: 'Contactado — interesado, avanza', reseteaTimer: true },
    { clave: 'contactado_info', etiqueta: 'Contactado — pidió más información (catálogo/precio)', reseteaTimer: true },
    { clave: 'contactado_no_interesado', etiqueta: 'Contactado — no interesado', reseteaTimer: true },
    { clave: 'contactado_sin_respuesta', etiqueta: 'Contactado — sin respuesta aún (esperando)', reseteaTimer: false },
    { clave: 'sin_respuesta_rescate', etiqueta: 'Sin respuesta — requiere rescate', reseteaTimer: false, canalSugerido: 'LLAMADA' },
    { clave: 'venta_cerrada', etiqueta: 'Venta cerrada por WhatsApp', reseteaTimer: true },
    { clave: 'cerrado_perdido', etiqueta: 'Cerrado — perdido', reseteaTimer: false, esCierre: true },
  ],
  LLAMADA: [
    { clave: 'contesta_duda_tecnica', etiqueta: 'Contesta — aclaró duda técnica', reseteaTimer: true },
    { clave: 'contesta_negocio_presupuesto', etiqueta: 'Contesta — negoció presupuesto/condiciones', reseteaTimer: true },
    { clave: 'contesta_rescate_exitoso', etiqueta: 'Contesta — rescate exitoso (retomó interés tras silencio en WhatsApp)', reseteaTimer: true },
    { clave: 'contesta_no_interesado', etiqueta: 'Contesta — no interesado', reseteaTimer: true },
    { clave: 'no_contesta_buzon', etiqueta: 'No contesta — buzón de voz', reseteaTimer: false },
    { clave: 'no_contesta_ocupado', etiqueta: 'No contesta — ocupado', reseteaTimer: false },
    { clave: 'no_contesta_numero_invalido', etiqueta: 'No contesta — número equivocado/inválido', reseteaTimer: false },
    { clave: 'cerrado_perdido', etiqueta: 'Cerrado — perdido', reseteaTimer: false, esCierre: true },
  ],
  CORREO: [
    { clave: 'cotizacion_enviada', etiqueta: 'Cotización enviada', reseteaTimer: true },
    { clave: 'comprobante_enviado', etiqueta: 'Comprobante/factura enviada', reseteaTimer: true },
    { clave: 'cotizacion_reenviada', etiqueta: 'Cotización reenviada (sin respuesta previa)', reseteaTimer: false },
    { clave: 'encuesta_enviada', etiqueta: 'Encuesta de satisfacción enviada', reseteaTimer: true },
    { clave: 'cerrado_perdido', etiqueta: 'Cerrado — perdido', reseteaTimer: false, esCierre: true },
  ],
  VISITA: [
    { clave: 'visita_agendada', etiqueta: 'Visita agendada', reseteaTimer: true },
    { clave: 'visita_cierre', etiqueta: 'Visita realizada — cierre', reseteaTimer: true },
    { clave: 'visita_cotizacion_pendiente', etiqueta: 'Visita realizada — cotización pendiente', reseteaTimer: true },
    { clave: 'visita_reagendada', etiqueta: 'Visita reagendada', reseteaTimer: true },
    { clave: 'visita_no_show', etiqueta: 'No se presentó el cliente', reseteaTimer: false },
    { clave: 'cerrado_perdido', etiqueta: 'Cerrado — perdido', reseteaTimer: false, esCierre: true },
  ],
  OTRO: [
    { clave: 'referido_cliente', etiqueta: 'Referido de otro cliente', reseteaTimer: false },
    { clave: 'reunion_interna', etiqueta: 'Reunión interna', reseteaTimer: false },
    { clave: 'derivado_supervisor', etiqueta: 'Caso derivado a supervisor', reseteaTimer: false },
    { clave: 'cerrado_perdido', etiqueta: 'Cerrado — perdido', reseteaTimer: false, esCierre: true },
  ],
};

const CATALOGO_MOTIVOS_DESCARTE = [
  { clave: 'precio', etiqueta: 'Precio' },
  { clave: 'eligio_competencia', etiqueta: 'Eligió competencia' },
  { clave: 'no_es_el_momento', etiqueta: 'No es el momento' },
  { clave: 'no_calificaba', etiqueta: 'No calificaba' },
  { clave: 'otro', etiqueta: 'Otro' },
];

function obtenerResultado(canal, resultado) {
  const lista = CATALOGO_RESULTADOS[canal];
  if (!lista) return null;
  return lista.find((r) => r.clave === resultado) || null;
}

function esMotivoDescarteValido(motivoDescarte) {
  return CATALOGO_MOTIVOS_DESCARTE.some((m) => m.clave === motivoDescarte);
}

module.exports = {
  CATALOGO_RESULTADOS,
  CATALOGO_MOTIVOS_DESCARTE,
  obtenerResultado,
  esMotivoDescarteValido,
};
