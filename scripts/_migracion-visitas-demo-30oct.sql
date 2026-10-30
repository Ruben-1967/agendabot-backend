-- 2026-10-30: tabla nueva VisitaDemo (visitas a las demos de muestras.multidigital.cl, ver
-- src/routes/visitasDemo.js). Aditiva: no toca ninguna tabla existente. Correrla en CADA base
-- ANTES de desplegar el código que la usa (el repo no usa `prisma migrate`).
--
-- Uso (Shell de Render):
--   npx prisma db execute --file scripts/_migracion-visitas-demo-30oct.sql --schema prisma/schema.prisma

CREATE TABLE IF NOT EXISTS "VisitaDemo" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "dispositivo" TEXT NOT NULL,
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VisitaDemo_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "VisitaDemo_slug_creadoEn_idx" ON "VisitaDemo"("slug", "creadoEn");
