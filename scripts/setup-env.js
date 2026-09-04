#!/usr/bin/env node

const fs = require('fs');

if (fs.existsSync('.env')) {
  console.log('ℹ️ .env already exists; leaving it unchanged.');
  process.exit(0);
}

fs.copyFileSync('.env.example', '.env');
console.log('✅ Created .env from .env.example. Replace placeholder values before starting Moxie.');
