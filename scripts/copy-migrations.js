const fs = require('fs');
const path = require('path');
const source = path.join(__dirname, '..', 'src', 'infrastructure', 'database', 'migrations');
const target = path.join(__dirname, '..', 'dist', 'infrastructure', 'database', 'migrations');
fs.mkdirSync(target, { recursive: true });
for (const file of fs.readdirSync(source).filter(f => f.endsWith('.sql'))) {
  fs.copyFileSync(path.join(source, file), path.join(target, file));
}

const schema = path.join(__dirname, '..', 'src', 'infrastructure', 'database', 'schema.sql');
const schemaTarget = path.join(__dirname, '..', 'dist', 'infrastructure', 'database', 'schema.sql');
fs.copyFileSync(schema, schemaTarget);
