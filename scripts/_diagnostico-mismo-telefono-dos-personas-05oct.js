#!/usr/bin/env node
// Uso puntual: Diego (Ahorróptica, 2026-10-05) reportó que 2 familiares
// agendaron con el mismo teléfono, el bot les asignó el MISMO RUT a ambos, y
// al cambiar el RUT de uno en el panel también cambió el de la otra persona.
// Lista, para Ahorróptica, cada Cliente que tenga citas con 2 o más
// nombrePaciente DISTINTOS (misma persona-teléfono, varios pacientes), con
// el Cliente.rut y el snapshot Cita.rutPaciente de cada cita, para ver si el
// RUT repetido vive en Cliente.rut, en Cita.rutPaciente, o en ambos.
// RUT está cifrado en reposo (ver src/lib/prisma.js): Cita.rutPaciente viene
// descifrado por la extensión (consulta directa a Cita); Cliente.rut anidado
// se descifra a mano. Solo lectura -- no modifica nada.
//
// USO (Shell de Render, producción):
//   node scripts/_diagnostico-mismo-telefono-dos-personas-05oct.js

require('dotenv').config();
const prisma = require('../src/lib/prisma');
const { descifrarSiCorresponde } = require('../src/lib/cifrado');

const EMPRESA_ID = 'ahoroptica-lautaro-seed-id';

function norm(s) {
  return (s || '').trim().toLowerCase();
}

async function main() {
  const citas = await prisma.cita.findMany({
    where: { empresaId: EMPRESA_ID },
    include: { cliente: true },
    orderBy: { fechaHoraInicio: 'desc' },
  });

  const porCliente = new Map();
  for (const c of citas) {
    if (!porCliente.has(c.clienteId)) porCliente.set(c.clienteId, []);
    porCliente.get(c.clienteId).push(c);
  }

  let encontrados = 0;
  for (const [clienteId, lista] of porCliente) {
    const nombres = new Set(lista.map((c) => norm(c.nombrePaciente || c.cliente?.nombre)));
    if (nombres.size < 2) continue;

    // Solo los casos recientes (citas desde hace ~45 días) para no inundar.
    const hace45d = Date.now() - 45 * 24 * 60 * 60 * 1000;
    if (!lista.some((c) => c.fechaHoraInicio.getTime() >= hace45d)) continue;

    encontrados++;
    const cli = lista[0].cliente;
    console.log(`\n=== Cliente ${clienteId} ===`);
    console.log(`  Cliente.nombre="${cli.nombre}" | Cliente.rut=${descifrarSiCorresponde(cli.rut) || '(sin rut)'} | telefono=${cli.telefono} | telefonoContacto=${cli.telefonoContacto || '-'}`);
    for (const c of lista) {
      console.log(`  - Cita ${c.id} | ${c.fechaHoraInicio.toISOString()} | ${c.estado} | origen=${c.origenCanal} | nombrePaciente="${c.nombrePaciente || '(null)'}" | rutPaciente=${c.rutPaciente || '(null)'}`);
    }
  }
  console.log(`\n${encontrados} cliente(s) con 2+ pacientes distintos y citas recientes.`);
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
