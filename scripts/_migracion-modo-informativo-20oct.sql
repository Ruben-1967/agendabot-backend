-- 2026-10-20: columna nueva Empresa.modoInformativo (aditiva y retrocompatible: DEFAULT false,
-- ninguna empresa existente cambia). DEBE correrse en CADA base ANTES de desplegar el código que
-- la usa; si no, fallan las consultas de Empresa de todos los clientes. El repo no usa
-- `prisma migrate`, así que esta es la migración (mismo método que las columnas anteriores).
--
-- Uso (Shell de Render):
--   echo 'ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "modoInformativo" BOOLEAN NOT NULL DEFAULT false;' | npx prisma db execute --stdin --schema prisma/schema.prisma
ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "modoInformativo" BOOLEAN NOT NULL DEFAULT false;
