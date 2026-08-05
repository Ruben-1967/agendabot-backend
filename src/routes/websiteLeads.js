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

router.post("/", async (req, res) => {
  try {
    const { nombre, email, telefono, mensaje } = req.body;
    
    if (!nombre || !email || !telefono) {
      return res.status(400).json({
        error: "Campos requeridos: nombre, email, telefono",
      });
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Email inválido" });
    }
    
    const lead = await prisma.websiteLeads.create({
      data: {
        nombre: nombre.trim(),
        email: email.trim().toLowerCase(),
        telefono: telefono.trim(),
        mensaje: mensaje.trim() || "",
        empresaId: "ahoroptica-lautaro-seed-id",
      },
    });
    
    console.log("[websiteLeads] Lead creado:", lead.id);
    console.log("[websiteLeads] Enviando email a:", process.env.ADMIN_EMAIL);
    
    const emailResponse = await resend.emails.send({
      from: "noreply@ohparis.cl",
      to: process.env.ADMIN_EMAIL,
      subject: `📬 Nuevo lead del sitio web: ${nombre}`,
      html: `
        <h2>Nuevo mensaje del sitio web</h2>
        <p><strong>Nombre:</strong> ${nombre}</p>
        <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
        <p><strong>Teléfono:</strong> <a href="tel:${telefono}">${telefono}</a></p>
        <p><strong>Mensaje:</strong></p>
        <p style="background: #f5f5f5; padding: 15px; border-left: 4px solid #2F6F62;">
          ${(mensaje || "").replace(/\n/g, "<br>")}
        </p>
      `,
    });
    
    console.log("[websiteLeads] Resend response:", emailResponse);
    
    if (emailResponse.error) {
      console.error("[websiteLeads] Resend error:", emailResponse.error);
      return res.status(500).json({
        error: "Error al enviar email: " + JSON.stringify(emailResponse.error),
      });
    }
    
    console.log("[websiteLeads] Email enviado correctamente. ID:", emailResponse.id);
    
    res.status(200).json({
      exito: true,
      id: lead.id,
      mensaje: "Formulario enviado correctamente.",
    });
    
  } catch (error) {
    console.error("[websiteLeads] Error:", error.message, error);
    res.status(500).json({
      error: "Error al procesar el formulario. " + error.message,
    });
  }
});

router.get("/website-leads/admin", async (req, res) => {
  try {
    const leads = await prisma.websiteLeads.findMany({
      orderBy: { creadoEn: "desc" },
      take: 100,
    });
    res.status(200).json({ leads });
  } catch (error) {
    console.error("Error en GET /website-leads/admin:", error);
    res.status(500).json({ error: "Error al obtener leads" });
  }
});

module.exports = router;