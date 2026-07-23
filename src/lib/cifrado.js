// Cifrado en reposo (AES-256-GCM) para campos sensibles — whatsappToken,
// googleRefreshToken, RUT — exigido por la Ley 21.719 (rige desde el 1 de
// diciembre de 2026). La clave vive en la variable de entorno
// ENCRYPTION_KEY (32 bytes en base64), nunca en el código.
//
// Formato guardado: "enc:v1:<iv-hex>:<authTag-hex>:<ciphertext-hex>"
// El prefijo "enc:v1:" permite distinguir un valor ya cifrado de uno en
// texto plano (dato viejo, previo a este cambio) — ver esValorCifrado().

const crypto = require('crypto');

const ALGORITMO = 'aes-256-gcm';
const PREFIJO = 'enc:v1:';

function obtenerClave() {
  const claveBase64 = process.env.ENCRYPTION_KEY;
  if (!claveBase64) {
    throw new Error('Falta ENCRYPTION_KEY en las variables de entorno — no se puede cifrar/descifrar.');
  }
  const clave = Buffer.from(claveBase64, 'base64');
  if (clave.length !== 32) {
    throw new Error('ENCRYPTION_KEY debe decodificar a exactamente 32 bytes (256 bits).');
  }
  return clave;
}

function cifrar(textoPlano) {
  const clave = obtenerClave();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITMO, clave, iv);
  const cifrado = Buffer.concat([cipher.update(textoPlano, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${PREFIJO}${iv.toString('hex')}:${authTag.toString('hex')}:${cifrado.toString('hex')}`;
}

function descifrar(valorCifrado) {
  const clave = obtenerClave();
  const sinPrefijo = valorCifrado.slice(PREFIJO.length);
  const [ivHex, authTagHex, cifradoHex] = sinPrefijo.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const cifrado = Buffer.from(cifradoHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITMO, clave, iv);
  decipher.setAuthTag(authTag);
  const textoPlano = Buffer.concat([decipher.update(cifrado), decipher.final()]);
  return textoPlano.toString('utf8');
}

function esValorCifrado(valor) {
  return typeof valor === 'string' && valor.startsWith(PREFIJO);
}

module.exports = { cifrar, descifrar, esValorCifrado };