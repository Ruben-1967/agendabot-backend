const express = require("express");
const { PrismaClient } = require("@prisma/client");
const { Resend } = require("resend");
const router = express.Router();
const prisma = new PrismaClient();
const resend = new Resend(process.env.RESEND_API_KEY);

// CORS permisivo solo para /website-leads (endpoint público, multi-tenant)
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

/**
 * Extrae el dominio del request.
 * Ejemplos:
 *   - req.get('host') = "ahorroptica.cl"
 *   - req.get('host') = "ahorroptica.cl:3000" → devuelve "ahorroptica.cl"
 *   - req.get('host') = "localhost" → devuelve "localhost"
 */
function extraerDominio(req) {
  const host = req.get('host') || '';
  return host.split(':')[0].toLowerCase();
}

/**
 * Busca la empresa por dominio (sitioWeb).
 * Si no la encuentra por sitioWeb, intenta por nombre parcial como fallback.
 */
async function buscarEmpresaPorDominio(dominio) {
  // Primero intenta por sitioWeb exacto
  let empresa = await prisma.empresa.findFirst({
    where: { sitioWeb: dominio },
  });

  // Si no encuentra por sitioWeb, intenta por dominio como fallback (para localhost, etc.)
  if (!empresa && dominio !== 'localhost') {
    console.warn(`[websiteLeads] Dominio "${dominio}" no encontrado en sitioWeb. Consultando BD...`);
  }

  return empresa;
}

router.post("/", async (req, res) => {
  try {
    const { nombre, email, telefono, mensaje } = req.body;
    
    // Validación de campos requeridos
    if (!nombre || !email || !telefono) {
      return res.status(400).json({
        error: "Campos requeridos: nombre, email, telefono",
      });
    }
    
    // Validación de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Email inválido" });
    }

    // ========================================
    // MULTI-TENANT: Detectar empresa por dominio
    // ========================================
    const dominio = extraerDominio(req);
    console.log(`[websiteLeads] Dominio detectado: ${dominio}`);

    const empresa = await buscarEmpresaPorDominio(dominio);
    
    if (!empresa) {
      console.error(`[websiteLeads] Empresa no encontrada para dominio: ${dominio}`);
      return res.status(404).json({
        error: `No se encontró empresa configurada para este dominio (${dominio})`,
      });
    }

    // Verificar que la empresa tenga email de contacto
    if (!empresa.emailContacto) {
      console.error(`[websiteLeads] Empresa ${empresa.nombre} no tiene emailContacto configurado`);
      return res.status(500).json({
        error: "Empresa no tiene email de contacto configurado",
      });
    }

    console.log(`[websiteLeads] Empresa detectada: ${empresa.nombre} (${empresa.id})`);
    console.log(`[websiteLeads] Email destino: ${empresa.emailContacto}`);

    // ========================================
    // Guardar lead en BD
    // ========================================
    const lead = await prisma.websiteLeads.create({
      data: {
        nombre: nombre.trim(),
        email: email.trim().toLowerCase(),
        telefono: telefono.trim(),
        mensaje: mensaje.trim() || "",
        empresaId: empresa.id, // ← Multi-tenant: usa ID dinámico de la empresa
      },
    });
    
    console.log(`[websiteLeads] Lead creado: ${lead.id}`);

    // ========================================
    // Enviar email vía Resend
    // ========================================
    console.log(`[websiteLeads] Enviando email a: ${empresa.emailContacto}`);
    
    const emailResponse = await resend.emails.send({
      from: "noreply@ohparis.cl",
      to: empresa.emailContacto, // ← Multi-tenant: email desde BD
      subject: `📬 Nuevo lead del sitio web: ${nombre}`,
      html: `
        <h2>Nuevo mensaje del sitio web</h2>
        <p><strong>Negocio:</strong> ${empresa.nombre}</p>
        <p><strong>Nombre:</strong> ${nombre}</p>
        <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
        <p><strong>Teléfono:</strong> <a href="tel:${telefono}">${telefono}</a></p>
        <p><strong>Mensaje:</strong></p>
        <p style="background: #f5f5f5; padding: 15px; border-left: 4px solid #2F6F62;">
          ${(mensaje || "").replace(/\n/g, "<br>")}
        </p>
      `,
    });
    
    console.log(`[websiteLeads] Resend response:`, emailResponse);
    
    if (emailResponse.error) {
      console.error(`[websiteLeads] Resend error:`, emailResponse.error);
      return res.status(500).json({
        error: "Error al enviar email: " + JSON.stringify(emailResponse.error),
      });
    }
    
    console.log(`[websiteLeads] Email enviado correctamente. ID: ${emailResponse.id}`);
    
    // ========================================
    // Respuesta exitosa
    // ========================================
    res.status(200).json({
      exito: true,
      id: lead.id,
      mensaje: "Formulario enviado correctamente.",
      empresa: empresa.nombre, // ← Útil para debugging
    });
    
  } catch (error) {
    console.error(`[websiteLeads] Error:`, error.message, error);
    res.status(500).json({
      error: "Error al procesar el formulario. " + error.message,
    });
  }
});

/**
 * GET /website-leads/admin - Listar todos los leads (sin autenticación, solo para debug)
 * NOTA: Desactivar en producción si no está protegido
 */
router.get("/website-leads/admin", async (req, res) => {
  try {
    const leads = await prisma.websiteLeads.findMany({
      include: {
        empresa: {
          select: {
            nombre: true,
            emailContacto: true,
          },
        },
      },
      orderBy: { creadoEn: "desc" },
      take: 100,
    });
    res.status(200).json({ leads });
  } catch (error) {
    console.error(`[websiteLeads] Error en GET admin:`, error);
    res.status(500).json({ error: "Error al obtener leads" });
  }
});

module.exports = router;