#!/usr/bin/env node
const https = require('https');
const { PrismaClient } = require('@prisma/client');

const TOKEN = 'EAAPIdZBLXcn8BSEJCnQp1Qj9UPb3tCY6XvpdqgeSNr8G9V3lOZARv8RgyHud1lGCCsIOnV2z401WiQd2jQxZBgDlFGUhNmpxkPFJk35CuHhZBQZCppdDzBzdvnvSOx8hwlhsWH6Lb1cfTLuPhTknH21RrdKtSWipRIk5dIsBemF5qeOzNOG3LtFkHNZC5z7wZDZD'; // ← PEGA TU TOKEN AQUI
const WABA_ID = '2156101751629995';

function validateToken() {
  return new Promise((resolve, reject) => {
    const url = `https://graph.instagram.com/${WABA_ID}/phone_numbers?access_token=${TOKEN}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            reject(`Meta error: ${json.error.message}`);
          } else {
            resolve(json);
          }
        } catch (e) {
          reject(e.message);
        }
      });
    }).on('error', reject);
  });
}

async function saveToken() {
  console.log('🔍 Validando token en Meta...');
  try {
    const result = await validateToken();
    console.log('✅ Token VÁLIDO');
    console.log(`   Números: ${result.data.length}`);
    result.data.forEach(n => console.log(`   - ${n.display_phone_number}`));

    console.log('\n💾 Guardando en BD...');
    const prisma = new PrismaClient();
    await prisma.empresa.update({
      where: { id: 'ahoroptica-lautaro-seed-id' },
      data: { whatsappToken: TOKEN },
    });
    console.log('✅ Token guardado');
    await prisma.$disconnect();
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}

saveToken();