-- 2026-10-23: columna nueva Empresa.guionAtencion (aditiva y retrocompatible: NULL, ninguna
-- empresa existente cambia). DEBE correrse en CADA base ANTES de desplegar el código que la usa;
-- si no, fallan las consultas de Empresa de todos los clientes. El repo no usa `prisma migrate`,
-- así que esta es la migración (mismo método que las columnas anteriores).
--
-- Uso (Shell de Render):
--   npx prisma db execute --file scripts/_migracion-guion-atencion-23oct.sql --schema prisma/schema.prisma
ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "guionAtencion" TEXT;
