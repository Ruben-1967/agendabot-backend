const prisma = require('./prisma');

// WhatsApp/Instagram/Messenger entregan "al menos una vez" (at-least-once):
// Meta puede reintentar el mismo webhook si la respuesta tardó, si hubo un
// problema de red de su lado, etc. -- los duplicados son una condición
// normal de operación, no una excepción. Los reintentos tampoco llegan
// necesariamente en orden (2 pueden solaparse), así que "revisar primero,
// escribir después" tendría la misma condición de carrera que ya se
// corrigió en crearCita() (ver disponibilidad.js) -- acá se resuelve igual:
// se intenta CREAR primero, usando el id del mensaje (wamid de WhatsApp,
// mid de Instagram/Messenger -- ya únicos por plataforma) como clave
// primaria, y se captura la violación de unicidad (P2002, código conocido
// de Prisma) como la señal de "ya se procesó este mensaje, ignorar".
async function intentarMarcarProcesado(idMensaje, canal) {
  try {
    await prisma.mensajeEntranteProcesado.create({ data: { id: idMensaje, canal } });
    return true; // primera vez que se ve este id -- seguir procesando
  } catch (err) {
    if (err.code === 'P2002') {
      return false; // ya se había procesado (reintento/duplicado de Meta)
    }
    throw err;
  }
}

module.exports = { intentarMarcarProcesado };
