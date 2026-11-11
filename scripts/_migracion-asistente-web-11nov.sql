-- 2026-11-11: tabla nueva AsistenteWeb (configuración del asistente 24/7 de cada sitio web, ver
-- src/lib/asistenteWeb.js). Aditiva: no toca ninguna tabla existente. Correrla en CADA base
-- ANTES de desplegar el código que la usa (el repo no usa `prisma migrate`).
--
-- Uso (Shell de Render):
--   npx prisma db execute --file scripts/_migracion-asistente-web-11nov.sql --schema prisma/schema.prisma

CREATE TABLE IF NOT EXISTS "AsistenteWeb" (
  "id" TEXT NOT NULL,
  "clave" TEXT NOT NULL,
  "empresaId" TEXT NOT NULL,
  "titulo" TEXT NOT NULL,
  "nombreNegocio" TEXT NOT NULL,
  "saludo" TEXT NOT NULL,
  "color" TEXT NOT NULL DEFAULT '#1D4ED8',
  "whatsapp" TEXT,
  "origenes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "correoAvisos" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "conversacionesMes" INTEGER NOT NULL DEFAULT 150,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "gratisHasta" TIMESTAMP(3),
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizadoEn" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AsistenteWeb_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AsistenteWeb_clave_key" ON "AsistenteWeb"("clave");
CREATE UNIQUE INDEX IF NOT EXISTS "AsistenteWeb_empresaId_key" ON "AsistenteWeb"("empresaId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AsistenteWeb_empresaId_fkey') THEN
    ALTER TABLE "AsistenteWeb" ADD CONSTRAINT "AsistenteWeb_empresaId_fkey"
      FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
