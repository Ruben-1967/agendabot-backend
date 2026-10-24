-- 2026-10-24: columna nueva Conversacion.botSilenciadoEn (aditiva y retrocompatible: NULL, ninguna
-- conversación existente cambia). DEBE correrse en CADA base ANTES de desplegar el código que la usa;
-- si no, fallan las consultas de Conversacion de todos los clientes. El repo no usa `prisma migrate`,
-- así que esta es la migración (mismo método que las columnas anteriores).
--
-- Uso (Shell de Render):
--   npx prisma db execute --file scripts/_migracion-bot-silenciado-24oct.sql --schema prisma/schema.prisma
ALTER TABLE "Conversacion" ADD COLUMN IF NOT EXISTS "botSilenciadoEn" TIMESTAMP(3);
