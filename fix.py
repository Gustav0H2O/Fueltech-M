import re

with open('server-pg.js', 'r', encoding='utf-8') as f:
    code = f.read()

code = code.replace('const getTotal = () => +(await statsDb.get', 'const getTotal = async () => +(await statsDb.get')
code = code.replace('getTotal()', 'await getTotal()')

# bumpTotal
code = re.sub(r'const bumpTotal = statsDb\.prepare\(`(.*?)`\)', r'const bumpTotal = { run: async () => statsDb.run(`\1`) }', code, flags=re.DOTALL)

# bumpMissing
code = re.sub(r'const bumpMissing = statsDb\.prepare\(`(.*?)`\)', r'const bumpMissing = { run: async (p1, p2) => statsDb.run(`\1`, [p1, p2]) }', code, flags=re.DOTALL)

# vehicleForPage
code = re.sub(r'const vehicleForPage = db\.prepare\(`(.*?)`\);', r'const vehicleForPage = { get: async (id) => db.get(`\1`, [id]) };', code, flags=re.DOTALL)
code = code.replace('const v = vehicleForPage.get(id);', 'const v = await vehicleForPage.get(id);')

# getChatCount
code = re.sub(r'const getChatCount = statsDb\.prepare\(`(.*?)`\);', r'const getChatCount = { get: async (day, device_id) => statsDb.get(`\1`, [day, device_id]) };', code, flags=re.DOTALL)
code = code.replace('const row = getChatCount.get(day, actualDeviceId);', 'const row = await getChatCount.get(day, actualDeviceId);')
code = code.replace('getChatCount.get(day, ipCapKey)', '(await getChatCount.get(day, ipCapKey))')

# bumpChatCount
code = re.sub(r'const bumpChatCount = statsDb\.prepare\(`(.*?)`\);', r'const bumpChatCount = { run: async (day, device_id) => statsDb.run(`\1`, [day, device_id]) };', code, flags=re.DOTALL)
code = code.replace('bumpChatCount.run(day, actualDeviceId);', 'await bumpChatCount.run(day, actualDeviceId);')
code = code.replace('bumpChatCount.run(day, ipCapKey);', 'await bumpChatCount.run(day, ipCapKey);')

# insModule
code = re.sub(r'const insModule = \(\) => db\.prepare\(`(.*?)`\);', r'const insModule = async (d) => db.insertReturningId(`\1`, d);', code, flags=re.DOTALL)
code = code.replace('const module_id = insModule().run(d.module).lastInsertRowid;', 'const module_id = await insModule(d.module);')

# createVehicle inserts
code = re.sub(r'const vehicle_id = db\.prepare\(`(.*?)`\)\.run\(d\.vehicle\)\.lastInsertRowid;', r'const vehicle_id = await db.insertReturningId(`\1`, d.vehicle);', code, flags=re.DOTALL)

# insPump
code = code.replace("const insPump = db.prepare('INSERT OR IGNORE INTO module_pumps (module_id,pump_id,is_oem,fitment) VALUES (?,?,?,?)');", 
                    "const insPump = { run: async (m, p, i, f) => db.run('INSERT OR IGNORE INTO module_pumps (module_id,pump_id,is_oem,fitment) VALUES (?,?,?,?)', [m, p, i, f]) };")

with open('server-pg.js', 'w', encoding='utf-8') as f:
    f.write(code)
