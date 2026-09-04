#!/usr/bin/env node

require('dotenv').config();

const value = String(process.env.INTEGRATION_DATABASE_URL || '').trim();
if (!value) {
  console.error('❌ Integration environment check failed: INTEGRATION_DATABASE_URL is missing.');
  process.exit(1);
}

try {
  const parsed = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('INTEGRATION_DATABASE_URL must use postgres:// or postgresql://');
  }
} catch (error) {
  console.error(`❌ Integration environment check failed: ${error.message}`);
  process.exit(1);
}

if (value === String(process.env.DATABASE_URL || '').trim()) {
  console.error('❌ Refusing to run integration tests against DATABASE_URL. Use a disposable database.');
  process.exit(1);
}

console.log('✅ Integration environment check passed.');
