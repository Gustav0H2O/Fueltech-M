const fs = require('fs');

function refactorFile(filename) {
  let code = fs.readFileSync(filename, 'utf8');

  // 1. Line 144
  code = code.replace(
    /statsDb\.prepare\(`INSERT OR IGNORE INTO visit_days \(day, visitor_hash\) VALUES \(\?, \?\)`\)\n\s*\.run\(day, hash\)/g, 
    'await statsDb.run(`INSERT OR IGNORE INTO visit_days (day, visitor_hash) VALUES (?, ?)`, [day, hash])'
  );
  
  // 2. Generic prepare().all/get/run()
  const regex = /(db|statsDb)\.prepare\(\s*(`[^`]*`|'[^']*'|"[^"]*")\s*\)\.(all|get|run)\(([^)]*)\)/g;
  code = code.replace(regex, (match, dbVar, sql, method, params) => {
    let p = params.trim();
    if (method === 'run') {
       return 'await ' + dbVar + '.' + method + '(' + sql + (p ? ', [' + p + ']' : '') + ')';
    } else {
       return 'await ' + dbVar + '.' + method + '(' + sql + (p ? ', ' + p : '') + ')';
    }
  });

  // 3. Stored statements
  code = code.replace(/(?<!await\s)(vehicleForPage|getChatCount|bumpTotal|bumpMissing|bumpChatCount)\.(get|all|run)\(/g, 'await $1.$2(');

  // 4. Nested map in api/vehicles/:id
  code = code.replace(
    /compatible_pumps:\s*pumpsStmt\.all\(m\.id\)\.map\(p\s*=>\s*\(\{([\s\S]*?)\}\)\)/g,
    "compatible_pumps: (await db.all(`SELECT p.*, mp.fitment, mp.is_oem, mp.notes AS fitment_notes FROM module_pumps mp JOIN fuel_pumps p ON p.id = mp.pump_id WHERE mp.module_id = ? ORDER BY mp.is_oem DESC`, m.id)).map(p => ({$1}))"
  );

  // 5. Outer Promise.all for modules
  code = code.replace(/modules:\s*modules\.map\(m\s*=>\s*\(\{/g, 'modules: await Promise.all(modules.map(async m => ({');

  fs.writeFileSync(filename, code);
  console.log('Refactored ' + filename);
}
refactorFile('server-pg.js');
