// Subida de imágenes del Catálogo Visual a Cloudinary. Render no persiste
// disco entre deploys, así que las imágenes no pueden guardarse localmente.
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Sube una imagen (data URI base64, ej. "data:image/png;base64,...") a la
 * carpeta indicada en Cloudinary y devuelve la URL segura resultante.
 *
 * @param {string} base64DataUri
 * @param {string} folder - ej. "catalogo/<empresaId>" (catálogo real) o
 *   "catalogo-demo/<rubroTemplateId>" (catálogo de la demo por rubro).
 * @returns {Promise<{ url: string, publicId: string }>}
 */
async function subirImagenCatalogo(base64DataUri, folder) {
  const resultado = await cloudinary.uploader.upload(base64DataUri, {
    folder,
    resource_type: 'image',
  });

  return { url: resultado.secure_url, publicId: resultado.public_id };
}

/**
 * Elimina una imagen de Cloudinary por su public_id. No lanza si la imagen
 * ya no existe (borrado ya es idempotente del lado de Cloudinary).
 */
async function eliminarImagenCatalogo(publicId) {
  if (!publicId) return;
  await cloudinary.uploader.destroy(publicId);
}

/**
 * Extrae el public_id de una URL de Cloudinary (ej.
 * ".../upload/v1234567890/catalogo/<empresaId>/abc123.jpg" → "catalogo/<empresaId>/abc123").
 * No se guarda un campo publicId aparte en CatalogoItem — se deriva de
 * imagenUrl al momento de borrar. Devuelve null si la URL no calza con el
 * patrón esperado (ej. no es de Cloudinary), y quien llama decide si igual
 * borra el registro sin limpiar la imagen remota.
 */
function extraerPublicIdDesdeUrl(url) {
  const match = /\/upload\/(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+$/.exec(url || '');
  return match ? match[1] : null;
}

module.exports = { subirImagenCatalogo, eliminarImagenCatalogo, extraerPublicIdDesdeUrl };
