/**
 * ACTUALIZACIÓN: src/server.js
 * 
 * Agregar esta línea en el lugar correcto (junto a otras rutas)
 * 
 * UBICACIÓN: Después de las otras rutas (agenda, clientes, etc.)
 * ANTES DE: app.listen() o export default app
 */

// ============================================================
// ROUTERS (agregar esta línea donde están las otras rutas)
// ============================================================

// Rutas existentes (ya deberían estar)
const agendaRouter = require('./routes/agenda');
const clientesRouter = require('./routes/clientes');
const serviciosRouter = require('./routes/servicios');
const authRouter = require('./routes/auth');
const campadasRouter = require('./routes/campanas');
// ... otras rutas

// NUEVA: Rutas de Lista de Espera
const listaEsperaRouter = require('./routes/listaEspera');

// ============================================================
// REGISTRAR ROUTERS
// ============================================================

app.use('/agenda', agendaRouter);
app.use('/clientes', clientesRouter);
app.use('/servicios', serviciosRouter);
app.use('/auth', authRouter);
app.use('/campanas', campadasRouter);

// NUEVA: Registrar lista de espera
app.use('/lista-espera', listaEsperaRouter);

// ... resto del código (middleware, error handling, etc.)

module.exports = app;