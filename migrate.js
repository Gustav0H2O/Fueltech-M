const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const Database = require('better-sqlite3');

require('dotenv').config();

if (!process.env.DATABASE_URL) {
  console.error("❌ Faltan credenciales de Postgres. Define DATABASE_URL en tu .env");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const fueltechDb = new Database(path.join(__dirname, 'fueltech.db'), { readonly: true });
const statsDb = new Database(path.join(__dirname, 'stats.db'), { readonly: true });

async function migrateTable(tableName, dbSource, idFields = ['id']) {
  console.log(`Migrando tabla: ${tableName}...`);
  try {
    const rows = dbSource.prepare(`SELECT * FROM ${tableName}`).all();
    if (rows.length === 0) return;

    const cols = Object.keys(rows[0]);
    
    // Preparar el query de Postgres: INSERT INTO ... VALUES ($1, $2, ...)
    const valuesPlaceholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const updatePlaceholders = cols.filter(c => !idFields.includes(c)).map(c => `${c} = EXCLUDED.${c}`).join(', ');
    
    let query = `INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${valuesPlaceholders})`;
    
    if (idFields.length > 0) {
      query += ` ON CONFLICT (${idFields.join(', ')}) DO UPDATE SET ${updatePlaceholders}`;
      if (updatePlaceholders === '') {
        query = query.replace(/DO UPDATE SET.*/, 'DO NOTHING');
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of rows) {
        const values = cols.map(c => row[c]);
        await client.query(query, values);
      }
      
      // Update sequences if there is an id column
      if (cols.includes('id')) {
        await client.query(`SELECT setval('${tableName}_id_seq', (SELECT MAX(id) FROM ${tableName}))`);
      }
      
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    console.log(`✅ ${rows.length} registros insertados en ${tableName}.`);
  } catch (e) {
    if (e.message.includes('no such table')) {
      console.log(`⚠️ Tabla ${tableName} no existe en SQLite local, omitida.`);
    } else {
      console.error(`❌ Error migrando ${tableName}:`, e.message);
    }
  }
}

async function run() {
  console.log('Iniciando migración a PostgreSQL...');
  
  // 1. Crear el esquema
  const schema = fs.readFileSync(path.join(__dirname, 'schema-pg.sql'), 'utf8');
  await pool.query(schema);
  console.log('✅ Esquema creado en PostgreSQL.');

  // 2. Migrar tablas de catálogos (orden importa por llaves foráneas)
  await migrateTable('injection_types', fueltechDb);
  await migrateTable('brands', fueltechDb);
  await migrateTable('vehicles', fueltechDb);
  await migrateTable('fuel_modules', fueltechDb);
  await migrateTable('fuel_pumps', fueltechDb);
  await migrateTable('vehicle_modules', fueltechDb, ['vehicle_id', 'module_id']);
  await migrateTable('module_pumps', fueltechDb, ['module_id', 'pump_id']);

  // 3. Migrar estadísticas
  await migrateTable('visit_days', statsDb, ['day', 'visitor_hash']);
  await migrateTable('meta', statsDb, ['key']);
  await migrateTable('chat_limits', statsDb, ['day', 'device_id']);
  await migrateTable('missing_searches', statsDb, ['day', 'q']);

  console.log('🎉 Migración completada.');
  process.exit(0);
}

run().catch(e => {
  console.error("Fallo general:", e);
  process.exit(1);
});
