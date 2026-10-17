#!/usr/bin/env node
// Uso puntual (2026-10-17): registrar el +56 9 6610 8858 en Cloud API falló con
// "(#10) Application does not have permission for this action". SOLO LECTURA:
// revisa qué permisos tiene realmente el token guardado en la Empresa Multidigital
// (debug_token de Meta) y en qué estado está el registro del número. No imprime el
// token ni manda mensajes.
//
// USO (Shell de Render, producción):
//   node scripts/_diagnostico-token-numero-multidigital-17oct.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');

const EMPRESA_ID = 'b087c530-5f89-4ecd-8cfb-9fda7069a426';
const APP_ID = '1064842162565759'; // AgendaBot Producción
const GRAPH = 'v21.0';
const limpiar = (t) => String(t || '').replace(/EAA[A-Za-z0-9]+/g, '***');

async function main() {
  const e = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID } });
  if (!e || !/multidigital/i.test(e.nombre)) throw new Error('No es la Empresa Multidigital.');
  if (!e.whatsappToken || !e.whatsappNumeroId) throw new Error('Falta el token o el número en la Empresa.');

  console.log('[1] Permisos del token (debug_token)');
  const secreto = process.env.WHATSAPP_APP_SECRET;
  if (!secreto) {
    console.log('  WHATSAPP_APP_SECRET no está definida aquí: no se puede ejecutar debug_token.');
  } else {
    const url = `https://graph.facebook.com/${GRAPH}/debug_token?input_token=${encodeURIComponent(e.whatsappToken)}&access_token=${encodeURIComponent(`${APP_ID}|${secreto}`)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok || !data.data) {
      console.log('  ERROR:', limpiar(JSON.stringify(data)));
    } else {
      const d = data.data;
      console.log(`  válido=${d.is_valid} | tipo=${d.type} | app_id=${d.app_id} | vence=${d.expires_at === 0 ? 'nunca' : d.expires_at} | usuario=${d.user_id || '-'}`);
      console.log('  scopes:', JSON.stringify(d.scopes));
      console.log('  granular_scopes:', JSON.stringify(d.granular_scopes));
    }
  }

  console.log('\n[2] Registro del número en Meta');
  const url2 = `https://graph.facebook.com/${GRAPH}/${e.whatsappNumeroId}?fields=display_phone_number,status,platform_type,code_verification_status,last_onboarded_time,account_mode,is_pin_enabled,name_status`;
  const r2 = await fetch(url2, { headers: { Authorization: `Bearer ${e.whatsappToken}` } });
  const d2 = await r2.json();
  console.log(r2.ok ? JSON.stringify(d2, null, 1) : `ERROR ${r2.status}: ${limpiar(d2?.error?.message)}`);
}

main()
  .catch((err) => { console.error('❌ Error:', limpiar(err.message)); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
