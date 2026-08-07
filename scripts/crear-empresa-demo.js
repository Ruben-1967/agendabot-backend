/**
 * Crea la empresa Ahorróptica (empresa real, no demo)
 * 
 * Uso:
 *   node scripts/crear-empresa-ahorroptica.js
 */
const prisma = require('../src/lib/prisma');

async function main() {
  try {
    // Buscar o crear rubro Óptica
    let rubro = await prisma.rubroTemplate.findUnique({ 
      where: { clave: 'optica' } 
    });

    if (!rubro) {
      console.error('No existe RubroTemplate con clave "optica"');
      process.exit(1);
    }

    // Crear empresa Ahorróptica
    const empresa = await prisma.empresa.create({
      data: {
        id: 'ahoroptica-lautaro-seed-id',
        nombre: 'Ahorróptica',
        sucursal: 'Sucursal Lautaro',
        modoOperacion: 'AGENDAMIENTO',
        direccion: "Av. O'Higgins #546, comuna de Lautaro",
        emailContacto: 'contacto@ahorroptica.cl',
        tonoComunicacion: 'Neutral',
        requiereRut: true,
        esDemo: false,
        rubroTemplateId: rubro.id
      }
    });

    // Crear cliente de prueba CON LOS 3 CAMPOS NUEVOS
    const cliente = await prisma.cliente.create({
      data: {
        empresaId: empresa.id,
        nombre: 'Rubén González',
        rut: '1234567890',
        telefono: '927272707',
        fichaJson: {
          od: { esfera: -2, cilindro: -1.5, eje: 80, adicion: 2 },
          oi: {}
        },
        fechaProximaCita: new Date('2026-09-15'),
        profesionalAtendio: 'Dr. Jorge López',
        diagnostico: 'Miopía + astigmatismo moderado'
      }
    });

    console.log('✅ Empresa Ahorróptica creada');
    console.log('ID Empresa:', empresa.id);
    console.log('Cliente:', cliente.nombre);
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();