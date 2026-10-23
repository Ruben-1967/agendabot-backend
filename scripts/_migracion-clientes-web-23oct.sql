-- 2026-10-23: tablas nuevas ClienteWeb y MovimientoClienteWeb (panel Clientes Web de Multidigital,
-- ver src/routes/clientesWeb.js). Aditivas: no tocan tablas existentes, asi que el codigo puede
-- desplegarse antes o despues; igual conviene correrla ANTES. Idempotente (IF NOT EXISTS).
--
-- Uso (Shell de Render):
--   npx prisma db execute --file scripts/_migracion-clientes-web-23oct.sql --schema prisma/schema.prisma

CREATE TABLE IF NOT EXISTS "ClienteWeb" (
    "id" TEXT NOT NULL,
    "etapa" TEXT NOT NULL DEFAULT 'INTERESADO',
    "negocio" TEXT NOT NULL,
    "rubro" TEXT,
    "contactoNombre" TEXT,
    "telefono" TEXT,
    "email" TEXT,
    "comuna" TEXT,
    "dominio" TEXT,
    "linkMuestra" TEXT,
    "fechaEjemplo" TIMESTAMP(3),
    "plan" TEXT,
    "condiciones" TEXT,
    "notas" TEXT,
    "origen" TEXT NOT NULL DEFAULT 'MANUAL',
    "preferencia" TEXT,
    "horarioLlamada" TEXT,
    "fechaActivacion" TIMESTAMP(3),
    "fechaBaja" TIMESTAMP(3),
    "suscripcionWebId" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClienteWeb_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MovimientoClienteWeb" (
    "id" TEXT NOT NULL,
    "clienteWebId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "concepto" TEXT NOT NULL,
    "monto" INTEGER NOT NULL,
    "medio" TEXT,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nota" TEXT,
    "pagoWebId" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimientoClienteWeb_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ClienteWeb_suscripcionWebId_key" ON "ClienteWeb"("suscripcionWebId");

CREATE INDEX IF NOT EXISTS "ClienteWeb_etapa_idx" ON "ClienteWeb"("etapa");

CREATE INDEX IF NOT EXISTS "ClienteWeb_telefono_idx" ON "ClienteWeb"("telefono");

CREATE UNIQUE INDEX IF NOT EXISTS "MovimientoClienteWeb_pagoWebId_key" ON "MovimientoClienteWeb"("pagoWebId");

CREATE INDEX IF NOT EXISTS "MovimientoClienteWeb_clienteWebId_idx" ON "MovimientoClienteWeb"("clienteWebId");

DO $$ BEGIN
  ALTER TABLE "ClienteWeb" ADD CONSTRAINT "ClienteWeb_suscripcionWebId_fkey" FOREIGN KEY ("suscripcionWebId") REFERENCES "SuscripcionWeb"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "MovimientoClienteWeb" ADD CONSTRAINT "MovimientoClienteWeb_clienteWebId_fkey" FOREIGN KEY ("clienteWebId") REFERENCES "ClienteWeb"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
