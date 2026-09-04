#!/usr/bin/env node

require('dotenv').config();

const required = [
  'DATABASE_URL',
  'WHATSAPP_TOKEN',
  'WHATSAPP_PHONE_ID',
  'WHATSAPP_VERIFY_TOKEN',
  'DASHBOARD_PASSWORD',
];

const missing = required.filter((name) => !String(process.env[name] || '').trim());

if (missing.length) {
  console.error('❌ Environment check failed. Missing required variables:');
  for (const name of missing) console.error(`   - ${name}`);
  console.error('\nINTEGRATION_DATABASE_URL is intentionally not checked here; it is only required for the destructive integration suite.');
  process.exit(1);
}

const databaseUrl = String(process.env.DATABASE_URL).trim();
try {
  const parsed = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('DATABASE_URL must use postgres:// or postgresql://');
  }
} catch (error) {
  console.error(`❌ Environment check failed: ${error.message}`);
  process.exit(1);
}

const apiVersion = String(process.env.WHATSAPP_API_VERSION || 'v19.0').trim();
if (!/^v\d+(?:\.\d+)?$/.test(apiVersion)) {
  console.error('❌ Environment check failed: WHATSAPP_API_VERSION must look like v19.0');
  process.exit(1);
}

if (!String(process.env.ADMIN_IDS || '').trim()) {
  console.warn('⚠️ ADMIN_IDS is not set. Admin-only WhatsApp commands will be unavailable.');
}

console.log('✅ Environment check passed.');
console.log(`   DATABASE_URL: configured`);
console.log(`   WHATSAPP_TOKEN: configured`);
console.log(`   WHATSAPP_PHONE_ID: configured`);
console.log(`   WHATSAPP_VERIFY_TOKEN: configured`);
console.log(`   DASHBOARD_PASSWORD: configured`);
console.log(`   WHATSAPP_API_VERSION: ${apiVersion}`);
console.log(`   ADMIN_IDS: ${String(process.env.ADMIN_IDS || '').trim() ? 'configured' : 'not configured'}`);
