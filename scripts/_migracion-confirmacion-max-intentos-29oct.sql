-- 2026-10-29: columna nueva Empresa.confirmacionMaxIntentos (aditiva y retrocompatible: DEFAULT 3 =
-- el ciclo actual, ninguna empresa cambia). DEBE correrse en CADA base ANTES de desplegar el código
-- que la usa; si no, fallan las consultas de Empresa de todos los clientes.
--
-- Uso (Shell de Render):
--   echo 'ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "confirmacionMaxIntentos" INTEGER NOT NULL DEFAULT 3;' | npx prisma db execute --stdin --schema prisma/schema.prisma
ALTER TABLE "Empresa" ADD COLUMN IF NOT EXISTS "confirmacionMaxIntentos" INTEGER NOT NULL DEFAULT 3;
