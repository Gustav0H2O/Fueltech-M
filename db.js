require('dotenv').config();
const { Pool } = require('pg');
const Database = require('better-sqlite3');
const path = require('path');

// Prioridad de backend: Turso (TURSO_URL) > PostgreSQL (DATABASE_URL) > SQLite local
const USE_TURSO = !!(process.env.TURSO_URL && process.env.TURSO_AUTH_TOKEN);
const USE_PG = !USE_TURSO && !!process.env.DATABASE_URL;

let pgPool = null;
let sqliteDb = null;
let sqliteStats = null;
let tursoClient = null;

if (USE_TURSO) {
  const { createClient } = require('@libsql/client');
  tursoClient = createClient({
    url: process.env.TURSO_URL,
    authToken: process.env.TURSO_AUTH_TOKEN
  });
  console.log('☁️  Conectado a Turso (libSQL)');
} else if (USE_PG) {
  const isInternal = process.env.DATABASE_URL.includes('.internal');
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isInternal ? false : { rejectUnauthorized: false }
  });
  pgPool.on('error', (err) => {
    console.error('❌ Error inesperado en PostgreSQL:', err);
  });
  console.log('🔗 Conectado a PostgreSQL');
} else {
  sqliteDb = new Database(path.join(__dirname, 'fueltech.db'));
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.pragma('foreign_keys = ON');

  sqliteStats = new Database(path.join(__dirname, 'stats.db'));
  sqliteStats.pragma('journal_mode = WAL');
  console.log('📦 Conectado a SQLite (Local)');
}

function parseQuery(sql, params) {
  if (!USE_PG) return { sql, params };
  if (!params) return { sql, arr: [] };

  if (Array.isArray(params) || typeof params !== 'object') {
    let i = 1;
    const arr = Array.isArray(params) ? params : [params];
    const pgSql = sql.replace(/\?/g, () => '$' + (i++));
    return { sql: pgSql, arr };
  }

  let i = 1;
  const arr = [];
  const pgSql = sql.replace(/@([a-zA-Z0-9_]+)/g, (_, key) => {
    arr.push(params[key]);
    return '$' + (i++);
  });

  return { sql: pgSql, arr };
}

class DBAdapter {
  constructor(sqliteInstance) {
    this.sqlite = sqliteInstance;
    this.tursoTx = null; // transacción perezosa activa (Turso)
  }

  // Ejecuta en Turso: si hay transacción activa, dentro de ella; si no, directo.
  async tursoExec(sql, params) {
    const args = Array.isArray(params) ? params : (params ? Object.values(params) : []);
    if (this.tursoTx) return this.tursoTx.execute({ sql, args });
    return tursoClient.execute({ sql, args });
  }

  async get(sql, params) {
    if (USE_TURSO) {
      const res = await this.tursoExec(sql, params);
      return res.rows[0] || null;
    }
    if (USE_PG) {
      const { sql: pgSql, arr } = parseQuery(sql, params);
      const res = await pgPool.query(pgSql, arr);
      return res.rows[0] || null;
    } else {
      return Array.isArray(params) ? this.sqlite.prepare(sql).get(...params) : this.sqlite.prepare(sql).get(params || {});
    }
  }

  async all(sql, params) {
    if (USE_TURSO) {
      const res = await this.tursoExec(sql, params);
      return res.rows;
    }
    if (USE_PG) {
      const { sql: pgSql, arr } = parseQuery(sql, params);
      const res = await pgPool.query(pgSql, arr);
      return res.rows;
    } else {
      return Array.isArray(params) ? this.sqlite.prepare(sql).all(...params) : this.sqlite.prepare(sql).all(params || {});
    }
  }

  async run(sql, params) {
    if (USE_TURSO) {
      const res = await this.tursoExec(sql, params);
      return { changes: res.rowsAffected, lastInsertRowid: res.lastInsertRowid ?? null };
    }
    if (USE_PG) {
      let pgSql = sql;
      let onConflict = '';
      if (pgSql.includes('INSERT OR IGNORE')) {
        pgSql = pgSql.replace('INSERT OR IGNORE', 'INSERT');
        onConflict = ' ON CONFLICT DO NOTHING';
      }
      pgSql = pgSql + onConflict;
      
      const { sql: finalSql, arr } = parseQuery(pgSql, params);
      const res = await pgPool.query(finalSql, arr);
      return { changes: res.rowCount, lastInsertRowid: null };
    } else {
      return Array.isArray(params) ? this.sqlite.prepare(sql).run(...params) : this.sqlite.prepare(sql).run(params || {});
    }
  }

  async exec(sql) {
    if (USE_TURSO) {
      // El cliente HTTP de Turso no admite multi-statement: quitar comentarios --
      // (el split por ';' dejaría el comentario pegado al statement y rompe el
      // parseo), dividir por ';' y ejecutar uno a uno. BEGIN/COMMIT/ROLLBACK se
      // traducen a una transacción perezosa real con client.transaction() para
      // que los BEGIN...COMMIT del código conserven su atomicidad.
      const t = sql.trim().toUpperCase();
      if (t === 'BEGIN') {
        this.tursoTx = await tursoClient.transaction('write');
        return;
      }
      if (t === 'COMMIT') {
        if (this.tursoTx) { await this.tursoTx.commit(); this.tursoTx = null; }
        return;
      }
      if (t === 'ROLLBACK') {
        if (this.tursoTx) { await this.tursoTx.rollback(); this.tursoTx = null; }
        return;
      }
      const clean = sql.split(/\r?\n/).filter(l => !l.trim().startsWith('--')).join('\n');
      const stmts = clean.split(';').map(s => s.trim()).filter(s => s.length > 0);
      for (const stmt of stmts) await tursoClient.execute(stmt);
      return;
    }
    if (USE_PG) {
      await pgPool.query(sql);
    } else {
      this.sqlite.exec(sql);
    }
  }

  async insertReturningId(sql, params) {
    if (USE_TURSO) {
      const res = await this.tursoExec(sql + ' RETURNING id', params);
      return res.rows[0]?.id ?? null;
    }
    if (USE_PG) {
      let pgSql = sql.replace(/INSERT OR IGNORE/g, 'INSERT') + ' RETURNING id';
      const { sql: finalSql, arr } = parseQuery(pgSql, params);
      const res = await pgPool.query(finalSql, arr);
      return res.rows[0]?.id || null;
    } else {
      const info = Array.isArray(params) ? this.sqlite.prepare(sql).run(...params) : this.sqlite.prepare(sql).run(params || {});
      return info.lastInsertRowid;
    }
  }

  prepare(sql) {
    return {
      get: async (params) => this.get(sql, params),
      all: async (params) => this.all(sql, params),
      run: async (params) => this.run(sql, params)
    };
  }
}

const db = new DBAdapter(sqliteDb);
const statsDb = new DBAdapter(sqliteStats);

module.exports = { db, statsDb, pgPool, tursoClient, USE_TURSO, USE_PG, DBAdapter };
