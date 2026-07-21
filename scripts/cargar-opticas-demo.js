// Script de carga masiva para la base nacional de ópticas — crea una
// DemoAsignada SIN vendedor (vendedorId: null) para cada teléfono, cada una
// apuntando a su propia Empresa PRIVADA nueva llamada "Óptica Demo" (nunca
// la razón social real — ver decisión de sesión del 21 de julio: sin
// contacto previo, usar siempre el nombre genérico del rubro).
//
// Es idempotente: si el teléfono ya tiene una DemoAsignada (de cualquier
// origen — vendedor, menú genérico, u otra corrida de este script), se
// salta sin tocarlo, para no arriesgar el mismo incidente de sobrescritura
// que tuvimos con Luxvision/QROLLS.
//
// Uso: node scripts/cargar-opticas-demo.js /ruta/al/archivo-telefonos.txt
// El archivo debe tener un teléfono por línea (9 dígitos, sin +56).

const fs = require('fs');
const prisma = require('../src/lib/prisma');
const { parsePhoneNumberFromString } = require('libphonenumber-js');

async function main() {
  const rutaArchivo = process.argv[2];
  if (!rutaArchivo) {
    console.error('Uso: node scripts/cargar-opticas-demo.js /ruta/al/archivo.txt');
    process.exit(1);
  }

  const contenido = fs.readFileSync(rutaArchivo, 'utf-8');
  const telefonosCrudos = contenido
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && /^\d+$/.test(l));

  console.log(`Leídos ${telefonosCrudos.length} teléfonos del archivo.`);

  const rubroTemplate = await prisma.rubroTemplate.findUnique({ where: { clave: 'optica' } });
  if (!rubroTemplate) {
    console.error('No existe RubroTemplate con clave "optica".');
    process.exit(1);
  }

  let creados = 0;
  let saltados = 0;
  let invalidos = 0;

  for (const crudo of telefonosCrudos) {
    const numero = parsePhoneNumberFromString(crudo, 'CL');
    if (!numero || !numero.isValid()) {
      console.warn(`Teléfono inválido, se salta: ${crudo}`);
      invalidos++;
      continue;
    }
    const telefono = numero.number.replace('+', '');

    const existente = await prisma.demoAsignada.findUnique({ where: { telefono } });
    if (existente) {
      saltados++;
      continue;
    }

    try {
      await prisma.$transaction(async (tx) => {
        const empresa = await tx.empresa.create({
          data: { nombre: 'Óptica Demo', rubroTemplateId: rubroTemplate.id, esDemo: true },
        });
        await tx.demoAsignada.create({
          data: { telefono, empresaDemoId: empresa.id, vendedorId: null },
        });
      });
      creados++;
    } catch (error) {
      if (error.code === 'P2002') {
        saltados++;
      } else {
        console.error(`Error creando demo para ${telefono}:`, error.message);
      }
    }
  }

  console.log(`\nListo.\nCreados: ${creados}\nYa existían (saltados): ${saltados}\nInválidos: ${invalidos}`);
  process.exit(0);
}

main();