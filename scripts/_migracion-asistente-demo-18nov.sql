-- 2026-11-18: asistente de las DEMOS de sitios web (una sola empresa "Demos Multidigital" con
-- una clave por demo). Ver src/lib/asistenteWeb.js#empresaParaAsistente y
-- scripts/alta-asistente-demo.js.
--
-- Aditiva para los asistentes que ya existen: columnas nuevas con valor por defecto, y el
-- índice de empresaId deja de ser único (los asistentes actuales siguen igual).
-- Correrla en CADA base ANTES de desplegar el código que la usa: el código nuevo lee estas
-- columnas y, sin ellas, los asistentes de la base (Nexia, Puna Travel...) dejarían de cargar.
--
-- Uso (Shell de Render):
--   npx prisma db execute --file scripts/_migracion-asistente-demo-18nov.sql --schema prisma/schema.prisma

ALTER TABLE "AsistenteWeb" ADD COLUMN IF NOT EXISTS "demo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AsistenteWeb" ADD COLUMN IF NOT EXISTS "informacion" TEXT;
ALTER TABLE "AsistenteWeb" ADD COLUMN IF NOT EXISTS "guion" TEXT;
ALTER TABLE "AsistenteWeb" ADD COLUMN IF NOT EXISTS "venceEn" TIMESTAMP(3);

DROP INDEX IF EXISTS "AsistenteWeb_empresaId_key";
CREATE INDEX IF NOT EXISTS "AsistenteWeb_empresaId_idx" ON "AsistenteWeb"("empresaId");
