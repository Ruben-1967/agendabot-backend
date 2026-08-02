\# AgendaBot Backend



\## Flujo de Desarrollo



\### Branch Strategy

\- `main` → Producción (Ahorróptica en vivo)

\- `develop` → Staging (prueba segura)

\- `feature/\*` → Rama de desarrollo



\### Code Review Checklist



Antes de hacer `git push`, responde estas 10 preguntas (3 min):



\- \[ ] ¿Cambios en schema Prisma? → Testear en develop primero

\- \[ ] ¿Cambios en auth/seguridad? → Claude revisa

\- \[ ] ¿Cambios en API/rutas? → Testear con curl

\- \[ ] ¿Commits tienen mensaje claro?

\- \[ ] ¿Los logs muestran cambios? (git diff antes de push)

\- \[ ] ¿Probé en develop? (no directo a main)

\- \[ ] ¿Variables de entorno configuradas?

\- \[ ] ¿Hay breaking changes? (documentar en commit)

\- \[ ] ¿Rollback es fácil?

\- \[ ] ¿Tests pasan?



\### Flujo Seguro



1\. Branch `feature/nombre`

2\. Push a `develop` 

3\. Render redeploy automático a STAGING

4\. Prueba en https://agendabot-backend-staging.onrender.com

5\. Si OK → merge a `main`

6\. Redeploy automático a PRODUCCIÓN

