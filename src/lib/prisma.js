const { PrismaClient } = require('@prisma/client');
const { cifrar, descifrar, esValorCifrado } = require('./cifrado');

// Reutilizamos una sola instancia de PrismaClient en toda la app,
// en vez de crear una nueva conexión por request.
const prismaBase = new PrismaClient();

// Campos sensibles cifrados en reposo, por modelo. La extensión de abajo
// cifra automáticamente antes de escribir y descifra automáticamente
// después de leer — el resto del código (rutas, claude.js, cron jobs)
// sigue usando estos campos como texto plano normal, sin saber que están
// cifrados en la base de datos.
const CAMPOS_CIFRADOS = {
  Empresa: ['whatsappToken', 'googleRefreshToken'],
  Cliente: ['rut'],
};

function cifrarCamposEnData(model, data) {
  const campos = CAMPOS_CIFRADOS[model];
  if (!campos || !data) return data;
  const resultado = { ...data };
  for (const campo of campos) {
    if (resultado[campo] != null && typeof resultado[campo] === 'string' && !esValorCifrado(resultado[campo])) {
      resultado[campo] = cifrar(resultado[campo]);
    }
  }
  return resultado;
}

function descifrarCamposEnResultado(model, resultado) {
  const campos = CAMPOS_CIFRADOS[model];
  if (!campos || !resultado) return resultado;

  const procesarUno = (fila) => {
    if (!fila) return fila;
    for (const campo of campos) {
      if (fila[campo] != null && typeof fila[campo] === 'string' && esValorCifrado(fila[campo])) {
        try {
          fila[campo] = descifrar(fila[campo]);
        } catch (error) {
          console.error(`[CIFRADO] Error descifrando ${model}.${campo}:`, error.message);
        }
      }
    }
    return fila;
  };

  return Array.isArray(resultado) ? resultado.map(procesarUno) : procesarUno(resultado);
}

const prisma = prismaBase.$extends({
  query: {
    $allModels: {
      async create({ model, args, query }) {
        args.data = cifrarCamposEnData(model, args.data);
        const resultado = await query(args);
        return descifrarCamposEnResultado(model, resultado);
      },
      async createMany({ model, args, query }) {
        if (Array.isArray(args.data)) {
          args.data = args.data.map((d) => cifrarCamposEnData(model, d));
        }
        return query(args);
      },
      async update({ model, args, query }) {
        args.data = cifrarCamposEnData(model, args.data);
        const resultado = await query(args);
        return descifrarCamposEnResultado(model, resultado);
      },
      async updateMany({ model, args, query }) {
        args.data = cifrarCamposEnData(model, args.data);
        return query(args);
      },
      async upsert({ model, args, query }) {
        if (args.create) args.create = cifrarCamposEnData(model, args.create);
        if (args.update) args.update = cifrarCamposEnData(model, args.update);
        const resultado = await query(args);
        return descifrarCamposEnResultado(model, resultado);
      },
      async findUnique({ model, args, query }) {
        const resultado = await query(args);
        return descifrarCamposEnResultado(model, resultado);
      },
      async findFirst({ model, args, query }) {
        const resultado = await query(args);
        return descifrarCamposEnResultado(model, resultado);
      },
      async findMany({ model, args, query }) {
        const resultado = await query(args);
        return descifrarCamposEnResultado(model, resultado);
      },
    },
  },
});

module.exports = prisma;