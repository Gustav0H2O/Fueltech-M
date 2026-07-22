with open('server-pg.js', 'r', encoding='utf-8') as f:
    code = f.read()

code = code.replace('function createApp() {', 'async function createApp() {')

startup_code = """
  createApp().then(app => {
    const PORT = process.env.PORT || 3000;
    const server = app.listen(PORT, () => console.log(`FuelTech Master corriendo en http://localhost:${PORT}`));
    process.on('SIGTERM', () => { server.close(() => { process.exit(0); }); });
  });
"""

code = code.replace('const app = createApp();', startup_code)

old_startup = """  const PORT = process.env.PORT || 3000;
  const server = app.listen(PORT, () => console.log(`FuelTech Master corriendo en http://localhost:${PORT}`));

  process.on('SIGTERM', () => { server.close(() => { db.close(); statsDb.close(); process.exit(0); }); });"""

code = code.replace(old_startup, '')

with open('server-pg.js', 'w', encoding='utf-8') as f:
    f.write(code)
