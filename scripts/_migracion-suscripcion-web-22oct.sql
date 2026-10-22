-- 2026-10-22: tablas nuevas SuscripcionWeb y PagoWeb (suscripción Multidigital sitio web + correos,
-- cobro automático en Flow; ver src/routes/suscripcionWeb.js). Aditivas: no tocan ninguna tabla
-- existente. DEBEN correrse en CADA base ANTES de desplegar el código que las usa. El repo no usa
-- `prisma migrate`, así que esta es la migración (mismo método que las columnas anteriores).
--
-- Uso (Shell de Render):
--   npx prisma db execute --file scripts/_migracion-suscripcion-web-22oct.sql --schema prisma/schema.prisma

CREATE TABLE IF NOT EXISTS "SuscripcionWeb" (
  "id" TEXT NOT NULL,
  "ref" TEXT NOT NULL,
  "nombreCliente" TEXT NOT NULL,
  "emailCliente" TEXT NOT NULL,
  "dominio" TEXT,
  "plan" TEXT NOT NULL,
  "montoConIva" INTEGER NOT NULL,
  "fechaPrimerCobro" TIMESTAMP(3),
  "fechaInicioContrato" TIMESTAMP(3),
  "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
  "razonSocial" TEXT,
  "rut" TEXT,
  "domicilio" TEXT,
  "emailAceptacion" TEXT,
  "nombreQuienAcepta" TEXT,
  "versionContrato" TEXT,
  "fechaAceptacion" TIMESTAMP(3),
  "ipAceptacion" TEXT,
  "userAgentAceptacion" TEXT,
  "flowCustomerId" TEXT,
  "flowSubscriptionId" TEXT,
  "flowSubscriptionIdHosting" TEXT,
  "tarjetaTipo" TEXT,
  "tarjetaUltimos4" TEXT,
  "fechaUltimoPago" TIMESTAMP(3),
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizadoEn" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SuscripcionWeb_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SuscripcionWeb_ref_key" ON "SuscripcionWeb"("ref");
CREATE UNIQUE INDEX IF NOT EXISTS "SuscripcionWeb_flowCustomerId_key" ON "SuscripcionWeb"("flowCustomerId");
CREATE UNIQUE INDEX IF NOT EXISTS "SuscripcionWeb_flowSubscriptionId_key" ON "SuscripcionWeb"("flowSubscriptionId");
CREATE UNIQUE INDEX IF NOT EXISTS "SuscripcionWeb_flowSubscriptionIdHosting_key" ON "SuscripcionWeb"("flowSubscriptionIdHosting");

CREATE TABLE IF NOT EXISTS "PagoWeb" (
  "id" TEXT NOT NULL,
  "suscripcionWebId" TEXT NOT NULL,
  "tipo" TEXT NOT NULL,
  "monto" INTEGER NOT NULL,
  "estado" TEXT NOT NULL,
  "flowToken" TEXT NOT NULL,
  "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PagoWeb_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PagoWeb_suscripcionWebId_fkey" FOREIGN KEY ("suscripcionWebId") REFERENCES "SuscripcionWeb"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "PagoWeb_flowToken_key" ON "PagoWeb"("flowToken");
CREATE INDEX IF NOT EXISTS "PagoWeb_suscripcionWebId_idx" ON "PagoWeb"("suscripcionWebId");
