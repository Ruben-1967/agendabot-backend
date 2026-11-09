-- 2026-11-09: anuncio de origen de los contactos de WhatsApp (tabla nueva OrigenAnuncio + columna
-- ClienteWeb.anuncioOrigen). Aditiva y retrocompatible: ninguna fila existente cambia. DEBE correrse
-- en CADA base ANTES de desplegar el código que la usa; si no, fallan las consultas de ClienteWeb.
-- El repo no usa `prisma migrate`, así que esta es la migración (mismo método que las anteriores).
--
-- Uso (Shell de Render):
--   npx prisma db execute --file scripts/_migracion-origen-anuncio-09nov.sql --schema prisma/schema.prisma
CREATE TABLE IF NOT EXISTS "OrigenAnuncio" (
  "id" TEXT NOT NULL,
  "phoneNumberId" TEXT NOT NULL,
  "telefono" TEXT NOT NULL,
  "sourceId" TEXT,
  "sourceType" TEXT,
  "sourceUrl" TEXT,
  "titulo" TEXT,
  "texto" TEXT,
  "ctwaClid" TEXT,
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrigenAnuncio_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "OrigenAnuncio_phoneNumberId_telefono_idx" ON "OrigenAnuncio"("phoneNumberId", "telefono");
ALTER TABLE "ClienteWeb" ADD COLUMN IF NOT EXISTS "anuncioOrigen" JSONB;
