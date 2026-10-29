-- 2026-10-29: columnas nuevas en SuscripcionWeb para el cobro inicial combinado (plan + hosting del
-- primer año al registrar la tarjeta). Aditivas y retrocompatibles: los links existentes quedan con
-- hostingAlRegistrar = false y siguen con el flujo de siempre. DEBE correrse en CADA base ANTES de
-- desplegar el código que las usa; si no, fallan las consultas de SuscripcionWeb.
--
-- Uso (Shell de Render):
--   npx prisma db execute --file scripts/_migracion-cobro-inicial-web-29oct.sql --schema prisma/schema.prisma
ALTER TABLE "SuscripcionWeb" ADD COLUMN IF NOT EXISTS "hostingAlRegistrar" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SuscripcionWeb" ADD COLUMN IF NOT EXISTS "ordenComercioCollectPendiente" TEXT;
ALTER TABLE "SuscripcionWeb" ADD COLUMN IF NOT EXISTS "montoPlanCollect" INTEGER;
ALTER TABLE "SuscripcionWeb" ADD COLUMN IF NOT EXISTS "montoHostingCollect" INTEGER;
ALTER TABLE "SuscripcionWeb" ADD COLUMN IF NOT EXISTS "descuentoHostingPct" INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS "SuscripcionWeb_ordenComercioCollectPendiente_key" ON "SuscripcionWeb"("ordenComercioCollectPendiente");
