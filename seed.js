const fs = require('fs');
const path = require('path');
const { db, statsDb, USE_PG } = require('./db');

async function runSeed() {
  if (!process.env.FORCE_SEED) {
    try {
      const row = await db.get('SELECT COUNT(*) c FROM vehicles');
      const n = row ? Number(row.c) : 0;
      if (n > 0) {
        console.log(`seed: la base ya tiene ${n} vehículos — omitido (usa FORCE_SEED=1 para reconstruir).`);
        process.exit(0);
      }
    } catch (e) {
      /* base inexistente/corrupta o sin tablas: reconstruimos abajo */
    }
  }

  console.log(`🌱 Sembrando base de datos en modo: ${USE_PG ? 'PostgreSQL' : 'SQLite'}`);

  if (process.env.FORCE_SEED) {
    try {
      if (USE_PG) {
        await db.exec(`
          DROP TABLE IF EXISTS module_pumps CASCADE;
          DROP TABLE IF EXISTS vehicle_modules CASCADE;
          DROP TABLE IF EXISTS fuel_pumps CASCADE;
          DROP TABLE IF EXISTS fuel_modules CASCADE;
          DROP TABLE IF EXISTS vehicle_comments CASCADE;
          DROP TABLE IF EXISTS vehicles CASCADE;
          DROP TABLE IF EXISTS brands CASCADE;
          DROP TABLE IF EXISTS injection_types CASCADE;
        `);
      } else {
        await db.exec(`
          PRAGMA foreign_keys = OFF;
          DROP TABLE IF EXISTS module_pumps;
          DROP TABLE IF EXISTS vehicle_modules;
          DROP TABLE IF EXISTS fuel_pumps;
          DROP TABLE IF EXISTS fuel_modules;
          DROP TABLE IF EXISTS vehicle_comments;
          DROP TABLE IF EXISTS vehicles;
          DROP TABLE IF EXISTS brands;
          DROP TABLE IF EXISTS injection_types;
          PRAGMA foreign_keys = ON;
        `);
      }
    } catch (e) {
      console.warn("Aviso al borrar tablas:", e.message);
    }
  }

  const schemaFile = USE_PG ? 'schema-pg.sql' : 'schema.sql';
  await db.exec(fs.readFileSync(path.join(__dirname, schemaFile), 'utf8'));

/* ---------- Textos por zona de acceso ---------- */
const ZONE_LOC = {
  rear_seat:   'Dentro del tanque; acceso por registro bajo el asiento trasero (levantar banqueta y retirar tapa).',
  trunk_access:'Dentro del tanque; registro de acceso bajo la alfombra de la cajuela.',
  tank_drop:   'Dentro del tanque; sin registro de acceso — requiere bajar el tanque de gasolina.',
  frame_rail:  'Bomba externa montada fuera del tanque, sobre el chasis/carrocería.'
};
const ZONE_ACCESS = {
  rear_seat:   'Desconectar batería y aliviar presión del sistema antes de abrir el registro. Reemplazar empaque de la tapa si está vencido.',
  trunk_access:'Desconectar batería y aliviar presión antes de abrir. Ventilar la cajuela por vapores.',
  tank_drop:   'Vaciar el tanque lo más posible, soportarlo con gato y soltar cinchos. Girar anillo de seguridad con botador de bronce (no acero: chispa). Aliviar presión por válvula Schrader si existe.',
  frame_rail:  'Aliviar presión y despresurizar líneas. Respetar sentido de flujo y polaridad de la bomba nueva.'
};

/* ---------- Catálogo de pilas ----------
   Reglas de banco de pruebas (pila sola, sin regulador, deadhead):
     - TBI puro:            60–70 PSI
     - Full inyección (MFI): > 90 PSI
     - Vortec / CSFI:        90 PSI exacto
   Fuente: especificación del taller + verificado contra rangos publicados
   (TBI 9–13 PSI regulado / Vortec 60–66 PSI en riel, 70–100 PSI de pila sin regular). */
// [code, fabricante, estilo, psiMaxDirecta, amperes, lphLibre, entrada, salida, polaridad, diagrama]
const PUMPS = [
  ['AIRTEX E3210', 'Airtex', 'Rodillos (TBI)', 65, 4.0, 95, 'Entrada lateral con cedazo cónico', 'Salida 3/8" a manguera con abrazadera', '(+) terminal gris, (−) terminal negro (arnés GM)', 'pump_lowpressure'],
  ['GEN-LP24 (genérica)', 'Genérica', 'Rodillos (TBI)', 62, 4.5, 90, 'Entrada lateral con cedazo', 'Salida 3/8" espiga', 'Terminales tipo espada: (+) marcado en carcasa', 'pump_lowpressure'],
  ['BOSCH 69100', 'Bosch', 'Turbina', 98, 5.5, 120, 'Entrada inferior con cedazo a presión', 'Salida superior 8mm con válvula check', 'Terminal (+) plano grande, (−) plano chico', 'pump_generic'],
  ['GEN-3802 (genérica)', 'Genérica', 'Turbina', 93, 6.0, 110, 'Entrada inferior con cedazo a presión', 'Salida superior 8mm', 'Terminales tipo espada: (+) junto a la salida', 'pump_generic'],
  ['DELPHI FE0115', 'Delphi', 'Turbina alta presión', 105, 9.0, 130, 'Entrada inferior con cedazo doble ala', 'Salida superior con check integrado', '(+) pin grande del conector sellado, (−) pin chico', 'pump_highpressure'],
  ['WALBRO GSS342', 'Walbro/TI', 'Turbina alta presión', 120, 10.0, 255, 'Entrada inferior 11mm con cedazo', 'Salida superior 10mm rosca M10 o espiga', '(+) terminal M4 marcado rojo, (−) M4 negro', 'pump_highpressure'],
  ['AIRTEX E8213 (universal)', 'Airtex', 'Turbina alta presión', 100, 8.0, 125, 'Entrada inferior con cedazo universal', 'Salida superior 8mm con check', '(+) terminal marcado en tapa, (−) opuesto', 'pump_highpressure'],
  ['GEN-4809 (genérica alta)', 'Genérica', 'Turbina alta presión', 95, 8.5, 115, 'Entrada inferior con cedazo', 'Salida superior 8mm', 'Terminales espada: (+) marcado rojo', 'pump_highpressure'],
  ['BOSCH 0580254910 (CSFI)', 'Bosch', 'Turbina alta presión (Vortec)', 90, 9.5, 190, 'Entrada inferior con cedazo doble', 'Salida superior 8mm con check', '(+) terminal plano marcado, (−) opuesto', 'pump_highpressure'],
  ['GEN-CSFI90 (genérica)', 'Genérica', 'Turbina alta presión (Vortec)', 90, 9.0, 175, 'Entrada inferior con cedazo', 'Salida superior 8mm', 'Terminales espada: (+) marcado rojo', 'pump_highpressure'],
];

// Pilas por clase de presión: [código, esOEM, nota]
const CLASS_PUMPS = {
  TBI: [
    ['AIRTEX E3210', 1, 'Pila de baja probada en banco a 60–70 PSI (deadhead); el regulador del cuerpo TBI la reduce a 9–13 PSI de trabajo. NO instalar pila de alta: satura el regulador y ahoga el motor.'],
    ['GEN-LP24 (genérica)', 0, 'Alternativa económica; verificar 60–70 PSI en banco antes de instalar.'],
  ],
  MFI_ECO: [
    ['BOSCH 69100', 1, 'Equivalente OEM; probar > 90 PSI en banco (pila sola, sin regulador). Respetar diámetro y altura.'],
    ['GEN-3802 (genérica)', 0, 'Alternativa económica; confirmar > 90 PSI en banco antes de entregar.'],
  ],
  MFI_STD: [
    ['DELPHI FE0115', 1, 'Equivalente OEM; probar > 90 PSI en banco (pila sola, sin regulador).'],
    ['WALBRO GSS342', 0, 'Sobrada de flujo (255 LPH); útil en motores modificados. Adaptar salida y cedazo.'],
    ['GEN-4809 (genérica alta)', 0, 'Alternativa económica; confirmar > 90 PSI en banco antes de entregar.'],
  ],
  VORTEC: [
    ['BOSCH 0580254910 (CSFI)', 1, 'Probar exactamente 90 PSI en banco (pila sola, sin regulador). Con menos de 60 PSI ya instalada en el riel, el motor no enciende (los poppets no abren).'],
    ['GEN-CSFI90 (genérica)', 0, 'Alternativa económica; confirmar los 90 PSI en banco antes de instalar — este sistema no tolera flujo insuficiente.'],
  ],
  GDI: [
    ['DELPHI FE0115', 1, 'Pila de BAJA del sistema GDI (la de alta es mecánica, en el motor). Verificar presión de baja según manual.'],
    ['WALBRO GSS342', 0, 'Alto flujo; adaptar salida. Solo reemplaza la bomba de baja en tanque.'],
  ],
};

/* ---------- Catálogo de vehículos ----------
   [marca, modelo, añoDesde, añoHasta, motor, inyección, psiMin, psiMax, zona, retorno(1/0), locOverride?, nota?]
   inyección: MFI | TBI | VORTEC_CSFI | GDI                                        */
const V = [
  // ===== NISSAN =====
  ['Nissan','Tsuru III',1992,2017,'1.6L L4 16v (GA16DE)','MFI',36,43,'rear_seat',1,null,'Con regulador conectado a vacío en ralentí baja ~6 PSI.'],
  ['Nissan','Sentra B15',2001,2006,'1.8L L4 (QG18DE)','MFI',47,51,'rear_seat',0],
  ['Nissan','Sentra B16',2007,2012,'2.0L L4 (MR20DE)','MFI',51,58,'rear_seat',0],
  ['Nissan','Sentra B17',2013,2019,'1.8L L4 (MRA8DE)','MFI',51,58,'rear_seat',0],
  ['Nissan','Altima',2002,2006,'2.5L L4 (QR25DE)','MFI',47,51,'rear_seat',0],
  ['Nissan','March',2012,2020,'1.6L L4 (HR16DE)','MFI',51,58,'rear_seat',0],
  ['Nissan','Versa',2012,2019,'1.6L L4 (HR16DE)','MFI',51,58,'rear_seat',0],
  ['Nissan','Tiida',2007,2018,'1.8L L4 (MR18DE)','MFI',51,58,'rear_seat',0],
  ['Nissan','Platina',2002,2010,'1.6L L4 16v (K4M)','MFI',43,51,'rear_seat',0],
  ['Nissan','Pickup D21 / Estacas',1994,2008,'2.4L L4 (KA24E)','MFI',33,38,'tank_drop',1],
  ['Nissan','NP300',2008,2015,'2.4L L4 (KA24DE)','MFI',33,38,'tank_drop',1],
  ['Nissan','Urvan',2002,2012,'2.4L L4 (KA24DE)','MFI',33,38,'tank_drop',1],
  ['Nissan','X-Trail',2004,2013,'2.5L L4 (QR25DE)','MFI',47,51,'rear_seat',0],
  ['Nissan','Frontier V6',2005,2014,'4.0L V6 (VQ40DE)','MFI',51,58,'tank_drop',0],
  // ===== CHEVROLET / GM =====
  ['Chevrolet','Chevy C1/C2',1994,2012,'1.6L L4 (MPFI)','MFI',40,45,'tank_drop',1],
  ['Chevrolet','Corsa',2002,2008,'1.8L L4','MFI',50,58,'tank_drop',0],
  ['Chevrolet','Aveo',2008,2017,'1.6L L4','MFI',50,58,'tank_drop',0],
  ['Chevrolet','Spark',2011,2017,'1.2L L4','MFI',50,58,'tank_drop',0],
  ['Chevrolet','Sonic',2012,2017,'1.6L L4','MFI',50,58,'tank_drop',0],
  ['Chevrolet','Cruze',2010,2016,'1.8L L4','MFI',50,58,'tank_drop',0],
  ['Chevrolet','Cavalier',1995,2002,'2.2L L4','MFI',41,47,'tank_drop',1],
  ['Chevrolet','Malibu',1997,2003,'3.1L V6','MFI',41,47,'tank_drop',1],
  ['Chevrolet','Cheyenne / Silverado C1500',1988,1995,'5.7L V8 (350 TBI)','TBI',9,13,'tank_drop',1,null,'Más de 15 PSI en riel indica retorno obstruido o regulador dañado.'],
  ['Chevrolet','Suburban / Silverado Vortec',1996,1999,'5.7L V8 Vortec (CSFI)','VORTEC_CSFI',60,66,'tank_drop',0,null,'Crítico: con menos de 60 PSI el motor no enciende (los poppets no abren).'],
  ['Chevrolet','S10 / Blazer 4.3',1996,2005,'4.3L V6 Vortec (CSFI)','VORTEC_CSFI',60,66,'tank_drop',0,null,'Mismo criterio Vortec: bajo 60 PSI no arranca.'],
  ['Chevrolet','Astro Van',1996,2005,'4.3L V6 Vortec (CSFI)','VORTEC_CSFI',60,66,'tank_drop',0],
  ['Chevrolet','Silverado / Suburban',1999,2006,'4.8L / 5.3L V8 Vortec','MFI',55,62,'tank_drop',0],
  ['Chevrolet','Silverado / Cheyenne',2007,2013,'5.3L V8 Vortec','MFI',55,62,'tank_drop',0],
  ['Chevrolet','Trailblazer',2002,2008,'4.2L L6','MFI',52,59,'tank_drop',0],
  ['Chevrolet','Equinox',2005,2009,'3.4L V6','MFI',52,59,'tank_drop',0],
  ['Chevrolet','Tornado',2004,2011,'1.8L L4','MFI',50,58,'tank_drop',0],
  ['Chevrolet','Trax',2013,2019,'1.8L L4','MFI',50,58,'tank_drop',0],
  // ===== FORD =====
  ['Ford','Fiesta / Ikon',2003,2010,'1.6L L4 Rocam','MFI',55,65,'tank_drop',0],
  ['Ford','Fiesta',2011,2019,'1.6L L4','MFI',55,65,'rear_seat',0],
  ['Ford','Ka',2001,2008,'1.6L L4 Rocam','MFI',55,65,'tank_drop',0],
  ['Ford','Focus',2000,2011,'2.0L L4','MFI',55,65,'tank_drop',0],
  ['Ford','Fusion',2006,2012,'2.3L L4','MFI',55,65,'tank_drop',0],
  ['Ford','Escape',2001,2012,'3.0L V6','MFI',55,65,'tank_drop',0],
  ['Ford','Explorer',1995,2001,'4.0L V6','MFI',35,45,'tank_drop',1],
  ['Ford','Ranger',1998,2012,'2.3L L4 / 3.0L V6','MFI',55,65,'tank_drop',0],
  ['Ford','F-150 / Lobo',1997,2003,'4.2L V6 / 4.6L V8','MFI',30,45,'tank_drop',0],
  ['Ford','F-150 / Lobo',2004,2008,'5.4L V8 Tritón','MFI',55,65,'tank_drop',0],
  ['Ford','Econoline E-150',1997,2008,'4.6L V8','MFI',30,45,'tank_drop',0],
  ['Ford','Mustang',1994,2004,'3.8L V6 / 4.6L V8','MFI',35,45,'tank_drop',1],
  ['Ford','EcoSport',2004,2012,'2.0L L4','MFI',55,65,'tank_drop',0],
  ['Ford','Courier',2000,2012,'1.6L L4 Rocam','MFI',55,65,'tank_drop',0],
  // ===== VOLKSWAGEN =====
  ['Volkswagen','Sedán (Vocho) Fuel Injection',1993,2003,'1.6L B4 (Digifant)','MFI',32,38,'frame_rail',1,'Bomba externa bajo el tanque delantero, junto al eje frontal (no lleva módulo en tanque).','Sistema Digifant con retorno. La bomba externa es muy sensible a suciedad del tanque.'],
  ['Volkswagen','Golf / Jetta A2',1987,1992,'1.8L L4 (Digifant)','MFI',36,44,'frame_rail',1,'Bomba principal externa bajo el piso trasero, con bomba de transferencia dentro del tanque.'],
  ['Volkswagen','Jetta A3 / Golf A3',1993,1999,'2.0L L4','MFI',38,44,'rear_seat',1],
  ['Volkswagen','Jetta A4 (Clásico)',1999,2015,'2.0L L4','MFI',44,58,'rear_seat',0],
  ['Volkswagen','Jetta A6',2011,2018,'2.0L / 2.5L L5','MFI',58,66,'rear_seat',0],
  ['Volkswagen','Bora',2006,2010,'2.5L L5','MFI',58,66,'rear_seat',0],
  ['Volkswagen','Pointer',1998,2009,'1.8L L4','MFI',38,44,'rear_seat',1],
  ['Volkswagen','Derby',1995,2009,'1.8L L4','MFI',38,44,'rear_seat',1],
  ['Volkswagen','Gol / Saveiro',2009,2019,'1.6L L4','MFI',44,51,'rear_seat',0],
  ['Volkswagen','Vento',2014,2019,'1.6L L4','MFI',44,51,'rear_seat',0],
  ['Volkswagen','Beetle',1998,2010,'2.0L L4','MFI',44,58,'rear_seat',0],
  ['Volkswagen','Jetta / Tiguan TSI',2016,2021,'1.4L TSI (GDI)','GDI',58,87,'rear_seat',0,null,'Presión de BAJA en tanque. La bomba de alta (mecánica, en motor) llega a 2000+ PSI.'],
  // ===== TOYOTA =====
  ['Toyota','Corolla',2003,2013,'1.8L L4 (1ZZ/2ZR)','MFI',44,50,'rear_seat',0],
  ['Toyota','Corolla',2014,2019,'1.8L L4 (2ZR-FE)','MFI',44,50,'rear_seat',0],
  ['Toyota','Yaris',2006,2016,'1.5L L4','MFI',44,50,'rear_seat',0],
  ['Toyota','Camry',2002,2011,'2.4L L4 (2AZ-FE)','MFI',44,50,'rear_seat',0],
  ['Toyota','Hilux',2005,2015,'2.7L L4 (2TR-FE)','MFI',44,50,'tank_drop',0],
  ['Toyota','Tacoma',2005,2015,'4.0L V6 (1GR-FE)','MFI',44,50,'tank_drop',0],
  ['Toyota','RAV4',2006,2012,'2.4L L4','MFI',44,50,'rear_seat',0],
  ['Toyota','Avanza',2012,2019,'1.5L L4','MFI',44,50,'rear_seat',0],
  // ===== HONDA =====
  ['Honda','Civic',2001,2005,'1.7L L4 (D17)','MFI',40,47,'rear_seat',0],
  ['Honda','Civic',2006,2011,'1.8L L4 (R18)','MFI',48,55,'rear_seat',0],
  ['Honda','Accord',2003,2007,'2.4L L4 (K24)','MFI',48,55,'rear_seat',0],
  ['Honda','CR-V',2007,2014,'2.4L L4 (K24)','MFI',48,55,'rear_seat',0],
  ['Honda','Fit',2009,2014,'1.5L L4','MFI',48,55,'rear_seat',0],
  ['Honda','Odyssey',2005,2010,'3.5L V6','MFI',48,55,'rear_seat',0],
  // ===== DODGE / CHRYSLER / JEEP =====
  ['Dodge','Ram 1500',1994,2001,'3.9L V6 / 5.2L / 5.9L V8 Magnum','MFI',44,54,'tank_drop',0],
  ['Dodge','Ram 1500 Hemi',2003,2008,'5.7L V8 Hemi','MFI',56,62,'tank_drop',0],
  ['Dodge','Neon',1995,2005,'2.0L L4','MFI',45,52,'tank_drop',0],
  ['Dodge','Stratus',2001,2006,'2.4L L4','MFI',45,52,'tank_drop',0],
  ['Dodge','Attitude',2006,2011,'1.6L L4','MFI',50,58,'rear_seat',0],
  ['Dodge','Journey',2009,2016,'2.4L L4','MFI',55,62,'tank_drop',0],
  ['Chrysler','Voyager / Caravan',1996,2007,'3.3L V6','MFI',45,52,'tank_drop',0],
  ['Chrysler','PT Cruiser',2001,2009,'2.4L L4','MFI',45,52,'tank_drop',0],
  ['Jeep','Grand Cherokee / Cherokee XJ',1996,2001,'4.0L L6','MFI',44,52,'tank_drop',0],
  ['Jeep','Liberty',2002,2007,'3.7L V6','MFI',54,62,'tank_drop',0],
  // ===== HYUNDAI / KIA =====
  ['Hyundai','Accent',2012,2017,'1.6L L4','MFI',50,58,'rear_seat',0],
  ['Hyundai','Elantra',2011,2016,'1.8L L4','MFI',50,58,'rear_seat',0],
  ['Hyundai','Tucson',2010,2015,'2.0L L4','MFI',50,58,'rear_seat',0],
  ['Kia','Rio',2012,2017,'1.6L GDI','GDI',55,65,'rear_seat',0,null,'Presión de BAJA en tanque; la bomba de alta es mecánica en el motor.'],
  ['Kia','Forte',2014,2018,'2.0L L4','MFI',50,58,'rear_seat',0],
  ['Kia','Sportage',2011,2016,'2.4L GDI','GDI',55,65,'rear_seat',0],
  // ===== MAZDA =====
  ['Mazda','Mazda 3',2004,2009,'2.0L / 2.5L L4','MFI',55,64,'rear_seat',0],
  ['Mazda','Mazda 3 SkyActiv',2014,2018,'2.5L SkyActiv-G (GDI)','GDI',57,65,'rear_seat',0],
  ['Mazda','Mazda 6',2003,2008,'2.3L L4','MFI',55,64,'rear_seat',0],
  ['Mazda','CX-5',2013,2018,'2.5L SkyActiv-G (GDI)','GDI',57,65,'rear_seat',0],
  // ===== RENAULT =====
  ['Renault','Clio',2002,2010,'1.6L L4 (K4M)','MFI',43,51,'rear_seat',0],
  ['Renault','Kangoo',2004,2015,'1.6L L4','MFI',43,51,'rear_seat',0],
  ['Renault','Duster',2012,2019,'2.0L L4','MFI',43,51,'rear_seat',0],
  ['Renault','Logan / Sandero',2015,2019,'1.6L L4','MFI',43,51,'rear_seat',0],
  // ===== SEAT =====
  ['SEAT','Ibiza',2003,2009,'2.0L L4','MFI',44,58,'rear_seat',0],
  ['SEAT','León TSI',2014,2019,'1.4L TSI (GDI)','GDI',58,87,'rear_seat',0],
  // ===== MITSUBISHI =====
  ['Mitsubishi','Lancer',2008,2015,'2.0L L4','MFI',43,50,'rear_seat',0],
  ['Mitsubishi','L200',2008,2015,'2.4L L4','MFI',43,50,'tank_drop',0],
  ['Mitsubishi','Outlander',2008,2013,'2.4L L4','MFI',43,50,'rear_seat',0],
  // ===== PEUGEOT =====
  ['Peugeot','206 / 207',2001,2012,'1.6L L4 (TU5)','MFI',43,51,'tank_drop',0],
  ['Peugeot','Partner',2008,2015,'1.6L L4','MFI',43,51,'tank_drop',0],
  // ===== FIAT =====
  ['Fiat','Uno',2013,2019,'1.4L L4','MFI',43,51,'rear_seat',0],

  // ===== AMPLIACIÓN 2026 — specs ESTIMADAS por clase de inyección, NO verificadas contra manual =====
  // Última posición del array = verified (0). El PSI es un rango típico de su clase; confirmar antes de reparar.
  ['Nissan','Kicks',2017,2023,'1.6L L4 (HR16DE)','GDI',58,68,'rear_seat',0,null,null,0],
  ['Nissan','Sentra B18',2020,2024,'2.0L L4 (MR20DD)','MFI',51,58,'rear_seat',0,null,null,0],
  ['Nissan','Versa V',2020,2024,'1.6L L4 (HR16DE)','MFI',51,58,'rear_seat',0,null,null,0],
  ['Nissan','NP300 Frontier',2016,2023,'2.5L L4 (QR25DE)','MFI',47,55,'tank_drop',0,null,null,0],
  ['Chevrolet','Onix',2020,2024,'1.0L Turbo / 1.2L L4','MFI',50,58,'rear_seat',0,null,null,0],
  ['Chevrolet','Beat',2018,2024,'1.2L L4','MFI',44,51,'rear_seat',0,null,null,0],
  ['Chevrolet','Tracker',2021,2024,'1.2L Turbo (GDI)','GDI',58,68,'rear_seat',0,null,null,0],
  ['Chevrolet','Silverado 1500 GDI',2019,2024,'5.3L V8 (GDI)','GDI',60,72,'tank_drop',0,null,null,0],
  ['Ford','Territory',2020,2024,'1.5L Turbo (GDI)','GDI',58,70,'tank_drop',0,null,null,0],
  ['Ford','Ranger',2013,2022,'2.5L L4 / 3.2L L5','MFI',55,65,'tank_drop',0,null,null,0],
  ['Volkswagen','Virtus',2018,2024,'1.6L L4','MFI',44,51,'rear_seat',0,null,null,0],
  ['Volkswagen','Taos',2021,2024,'1.4L TSI (GDI)','GDI',58,87,'rear_seat',0,null,'Presión de BAJA en tanque.',0],
  ['Volkswagen','Nivus',2021,2024,'1.0L TSI (GDI)','GDI',58,87,'rear_seat',0,null,'Presión de BAJA en tanque.',0],
  ['Toyota','Corolla GR-S',2020,2024,'2.0L Dynamic Force (GDI)','GDI',58,72,'rear_seat',0,null,null,0],
  ['Toyota','RAV4',2019,2024,'2.5L Dynamic Force (GDI)','GDI',58,72,'rear_seat',0,null,null,0],
  ['Toyota','Hilux',2016,2023,'2.7L L4 / 2.8L Turbodiésel','MFI',44,50,'tank_drop',0,null,null,0],
  ['Toyota','C-HR',2018,2023,'2.0L L4 (GDI)','GDI',58,72,'rear_seat',0,null,null,0],
  ['Honda','HR-V',2016,2022,'1.8L L4','MFI',48,55,'rear_seat',0,null,null,0],
  ['Honda','City',2015,2020,'1.5L L4','MFI',48,55,'rear_seat',0,null,null,0],
  ['Honda','Civic Turbo',2016,2021,'1.5L Turbo (GDI)','GDI',58,72,'rear_seat',0,null,null,0],
  ['Jeep','Compass',2017,2023,'2.4L Tigershark (GDI)','GDI',58,72,'rear_seat',0,null,null,0],
  ['Dodge','Ram 1500 eTorque',2019,2024,'5.7L V8 Hemi (GDI)','GDI',60,72,'tank_drop',0,null,null,0],
  ['Jeep','Renegade',2016,2022,'1.8L L4 / 2.4L L4','MFI',50,58,'rear_seat',0,null,null,0],
  ['Hyundai','Creta',2017,2023,'1.6L L4 (GDI)','GDI',55,65,'rear_seat',0,null,null,0],
  ['Hyundai','i10',2014,2020,'1.2L L4','MFI',44,51,'rear_seat',0,null,null,0],
  ['Kia','Seltos',2020,2024,'2.0L L4 (GDI)','GDI',55,65,'rear_seat',0,null,null,0],
  ['Kia','Rio Sedán',2018,2023,'1.6L GDI','GDI',55,65,'rear_seat',0,null,'Presión de BAJA en tanque.',0],
  ['Mazda','Mazda 2',2015,2021,'1.5L L4','MFI',55,64,'rear_seat',0,null,null,0],
  ['Mazda','CX-30',2020,2024,'2.5L SkyActiv-G (GDI)','GDI',57,65,'rear_seat',0,null,null,0],
  ['Renault','Kwid',2019,2024,'1.0L L4','MFI',43,51,'rear_seat',0,null,null,0],
  ['Renault','Captur',2018,2023,'2.0L L4','MFI',43,51,'rear_seat',0,null,null,0],
  ['SEAT','Arona',2018,2023,'1.6L L4 / 1.0L TSI (GDI)','GDI',58,87,'rear_seat',0,null,null,0],
  ['Mitsubishi','ASX',2011,2019,'2.0L L4','MFI',43,50,'rear_seat',0,null,null,0],
  ['Peugeot','208',2020,2024,'1.6L L4 (GDI)','GDI',58,72,'rear_seat',0,null,null,0],
  ['Fiat','Argo',2018,2023,'1.3L / 1.8L L4','MFI',43,51,'rear_seat',0,null,null,0],
  ['Fiat','Mobi',2017,2023,'1.0L L4','MFI',43,51,'rear_seat',0,null,null,0],
  ['Suzuki','Vitara',2016,2022,'1.6L L4','MFI',44,51,'rear_seat',0,null,null,0],
  ['Suzuki','Swift',2018,2023,'1.2L L4','MFI',44,51,'rear_seat',0,null,null,0],
  ['MG','MG5',2020,2023,'1.5L L4 (GDI)','GDI',55,65,'rear_seat',0,null,null,0],
  ['MG','MG ZS',2021,2024,'1.5L L4 (GDI)','GDI',55,65,'rear_seat',0,null,null,0],
];

/* ---------- Tipo de carrocería (para el modelo 3D) ---------- */
const BODY_KEYWORDS = {
  pickup: ['Pickup', 'NP300', 'Estacas', 'Cheyenne', 'Silverado', 'F-150', 'Lobo', 'Ranger', 'Ram 1500', 'Hilux', 'Tacoma', 'L200', 'Saveiro', 'Tornado', 'Courier', 'S10'],
  van: ['Urvan', 'Astro', 'Econoline', 'Odyssey', 'Voyager', 'Caravan', 'Kangoo', 'Partner', 'Avanza'],
  suv: ['X-Trail', 'Frontier', 'Suburban', 'Blazer', 'Trailblazer', 'Equinox', 'Trax', 'Escape', 'Explorer', 'EcoSport', 'CR-V', 'RAV4', 'Tucson', 'Sportage', 'Journey', 'Duster', 'Cherokee', 'Liberty', 'Outlander', 'CX-5', 'Tiguan', 'Pilot',
    'Kicks', 'Tracker', 'Territory', 'C-HR', 'HR-V', 'Compass', 'Renegade', 'Creta', 'Seltos', 'CX-30', 'Captur', 'Arona', 'ASX', 'Vitara', 'MG ZS'],
  hatchback: ['March', 'Spark', 'Fit', 'Clio', '206', 'Uno', 'Pointer', 'Gol ', 'Sedán (Vocho)', 'Ka', 'Sonic', 'i10', 'Sandero',
    'Beat', 'Nivus', 'Mazda 2', 'Swift', 'Kwid', 'Argo', 'Mobi', '208'],
};
function bodyType(model) {
  for (const [type, words] of Object.entries(BODY_KEYWORDS))
    if (words.some(w => model.includes(w))) return type;
  return 'sedan';
}

/* ---------- Perfil realista del módulo ----------
   Los ensambles NO son iguales entre sí: cambia el tipo (bomba externa, colgante,
   módulo integrado, Vortec, GDI de baja), el flotador según la época, el conector
   y la sujeción según el fabricante, y las líneas según el sistema. */

// Grupo de fabricante → conector y sujeción típicos de esa familia
const BRAND_GROUPS = {
  GM:       ['Chevrolet'],
  FORD:     ['Ford'],
  CHRYSLER: ['Dodge', 'Chrysler', 'Jeep'],
  VAG:      ['Volkswagen', 'SEAT'],
  EURO:     ['Renault', 'Peugeot', 'Fiat'],
  ASIA:     ['Nissan', 'Toyota', 'Honda', 'Hyundai', 'Kia', 'Mazda', 'Mitsubishi', 'Suzuki', 'MG'],
};
const brandGroup = (brand) => Object.keys(BRAND_GROUPS).find(g => BRAND_GROUPS[g].includes(brand)) || 'ASIA';

const GROUP_CONNECTOR = {
  GM:       'Conector ovalado GM de 4 vías (2 bomba +/−, 2 aforador)',
  FORD:     'Conector rectangular de 4–5 vías con seguro deslizable',
  CHRYSLER: 'Conector redondo sellado de 4 vías en la placa del módulo',
  VAG:      'Conector de 4–5 vías con clip lateral bajo la tapa del registro',
  EURO:     'Conector de 4–5 vías con clip; verificar pines de aforador por multiplexado en años recientes',
  ASIA:     'Conector sellado de 4–6 vías con clip (bomba + aforador; algunos años suman sensor de temperatura)',
};
const GROUP_MOUNT = {
  GM:       'Anillo de seguridad metálico (cam-lock) girado sobre la placa; empaque de neopreno. Girar con botador de bronce, nunca de acero.',
  FORD:     'Anillo de seguridad metálico roscado (lock ring) sobre O-ring grueso; requiere llave de anillo o botador suave.',
  CHRYSLER: 'Anillo plástico roscado de diámetro grande sobre O-ring; se aprieta a mano + 1/8 de vuelta.',
  VAG:      'Anillo plástico roscado bajo el registro; empaque de goma. No sobreapretar: el anillo se barre.',
  EURO:     'Anillo plástico roscado; empaque de goma que debe reemplazarse si quedó deformado.',
  ASIA:     'Placa atornillada (6–8 tornillos pequeños) sobre empaque de goma; apretar en cruz sin exceso.',
};

function moduleProfile({ brand, model, y1, y2, inj, ret, zone, isV8, disp, psiMax }) {
  const grp = brandGroup(brand);
  const assembly =
    zone === 'frame_rail'   ? 'external' :
    inj === 'TBI'           ? 'hanger_tbi' :
    inj === 'VORTEC_CSFI'   ? 'vortec' :
    inj === 'GDI'           ? 'gdi_low' :
    ret                     ? 'hanger_return' : 'module_returnless';

  // Flotador según la época (la electrónica del aforador cambió ~2004)
  const floatType = assembly === 'external'
    ? 'Aforador independiente dentro del tanque (unidad separada de la bomba externa)'
    : y1 >= 2004
      ? 'Brazo con tarjeta cerámica de película gruesa (señal estable; sensible a golpes en banco)'
      : 'Brazo con resistencia de alambre devanado (verificar barrido completo con óhmetro)';

  const P = {
    external: {
      namePrefix: 'Bomba externa',
      regulator: 'En el riel/sistema con línea de retorno al tanque (la bomba externa no regula)',
      strainer:  'Filtro-cedazo en línea ANTES de la bomba — crítico: la bomba externa no tolera sedimento del tanque',
      lines:     'Manguera de baja permeabilidad con abrazaderas; respetar el sentido de flujo marcado en la carcasa',
      connector: 'Bomba con 2 terminales (+/−) a la vista; el aforador del tanque lleva conector propio',
      mount:     'Abrazadera o soporte de lámina al chasis con gomas antivibración (las gomas duras hacen que la bomba "cante")',
      flow:      (f) => f,
      diagram:   'module_external',
    },
    hanger_tbi: {
      namePrefix: 'Colgante TBI',
      regulator: 'En el cuerpo TBI (9–13 PSI de trabajo); el colgante NO regula, solo porta la pila de baja',
      strainer:  'Cedazo de tela sobre la entrada de la pila, al fondo del colgante',
      lines:     'Alimentación 3/8" y retorno 5/16" soldadas a la placa + venteo EVAP; unión con abrazadera',
      connector: GROUP_CONNECTOR[grp],
      mount:     GROUP_MOUNT[grp],
      flow:      () => 90,
      diagram:   'module_hanger',
    },
    hanger_return: {
      namePrefix: 'Colgante',
      regulator: 'En riel/motor con línea de retorno al tanque (el colgante no trae regulador)',
      strainer:  'Cedazo de tela en la entrada de la pila; filtro externo en línea bajo el chasis o vano',
      lines:     'Alimentación y retorno en la placa + venteo al canister; unión con abrazadera u O-ring según el año',
      connector: GROUP_CONNECTOR[grp],
      mount:     GROUP_MOUNT[grp],
      flow:      (f) => f,
      diagram:   'module_hanger',
    },
    module_returnless: {
      namePrefix: 'Módulo',
      regulator: 'Integrado al vaso del módulo (sistema sin retorno)',
      strainer:  'Cedazo en la entrada del vaso + filtro de vida útil integrado al módulo (muchos años ya no llevan filtro externo)',
      lines:     'Una sola línea de alimentación con conexión rápida (quick-connect); venteo EVAP aparte',
      connector: GROUP_CONNECTOR[grp],
      mount:     GROUP_MOUNT[grp],
      flow:      (f) => f,
      diagram:   'module_intank_returnless',
    },
    vortec: {
      namePrefix: 'Módulo',
      regulator: 'En la unidad CSFI ("araña") dentro del pleno de admisión, con retorno al tanque',
      strainer:  'Cedazo de tela en la entrada de la pila; filtro externo en línea sobre el chasis',
      lines:     'Alimentación y retorno con conexión rápida metálica en la placa + venteo EVAP',
      connector: GROUP_CONNECTOR.GM,
      mount:     GROUP_MOUNT.GM,
      flow:      (f) => Math.max(f, 140),
      diagram:   'module_intank_return',
    },
    gdi_low: {
      namePrefix: 'Módulo GDI (baja)',
      regulator: 'Regulador de baja integrado al módulo; la presión de alta la genera la bomba mecánica en el motor',
      strainer:  'Cedazo en la entrada del vaso y del jet-pump (venturi que mantiene lleno el vaso)',
      lines:     'Una línea de baja presión con conexión rápida hacia la bomba de alta del motor',
      connector: GROUP_CONNECTOR[grp],
      mount:     GROUP_MOUNT[grp],
      flow:      (f) => f + 15,
      diagram:   'module_gdi',
    },
  }[assembly];

  return { assembly, floatType, ...P };
}

/* ---------- Inserción ---------- */
  await db.exec('BEGIN');
  try {
    const injIds = {};
    const injSql = `INSERT INTO injection_types (code, name, description) VALUES (?, ?, ?)`;
    injIds.MFI = await db.insertReturningId(injSql, ['MFI', 'Full Injection (Multipunto)', 'Un inyector por cilindro sobre el riel/flauta. Presión media-alta regulada.']);
    injIds.TBI = await db.insertReturningId(injSql, ['TBI', 'TBI (Throttle Body Injection)', 'Inyección monopunto en el cuerpo de aceleración. Presión baja (9–13 PSI).']);
    injIds.VORTEC_CSFI = await db.insertReturningId(injSql, ['VORTEC_CSFI', 'Vortec (CSFI/SCPI)', 'Inyección central secuencial con poppets. Muy sensible a presión: bajo 60 PSI no abre los poppets.']);
    injIds.GDI = await db.insertReturningId(injSql, ['GDI', 'GDI (Inyección Directa)', 'Bomba de baja en tanque + bomba de alta mecánica en motor. La pila del tanque trabaja a 50–90 PSI.']);

    const pumpIds = {};
    const pumpSql = `INSERT INTO fuel_pumps
      (code, manufacturer, pump_style, max_psi_direct, amperage_a, voltage_v, flow_lph_free, inlet_desc, outlet_desc, polarity_desc, diagram_key)
      VALUES (?, ?, ?, ?, ?, 12, ?, ?, ?, ?, ?)`;
    for (const p of PUMPS) pumpIds[p[0]] = await db.insertReturningId(pumpSql, p);

    const brandIds = {};
    const brandSql = `INSERT INTO brands (name) VALUES (?)`;
    const vehSql = `INSERT INTO vehicles
      (brand_id, model, year_from, year_to, engine, body_type, injection_type_id, rail_pressure_psi_min, rail_pressure_psi_max, notes, data_verified)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const modSql = `INSERT INTO fuel_modules
      (code, name, assembly_type, regulated_psi, flow_lph, regulator_type, float_type, strainer_ref, connector_desc, lines_desc, mount_desc, diagram_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const vmSql = `INSERT INTO vehicle_modules
      (vehicle_id, module_id, location_text, location_zone, requires_tank_removal, access_notes)
      VALUES (?, ?, ?, ?, ?, ?)`;
    const mpSql = `INSERT INTO module_pumps (module_id, pump_id, fitment, is_oem, notes) VALUES (?, ?, ?, ?, ?)`;

    // Familia Toyota de motor pequeño (Yaris/Corolla/Avanza, 1NZ/2NZ/1ZZ/2ZR-FE): comparten módulo
    // y corren presión de riel más baja que el resto de los MFI — confirmado en manual (38–44 PSI).
    // Es la única excepción a la regla general de taller para full inyección.
    const YARIS_FAMILY = new Set(['Yaris', 'Corolla', 'Corolla GR-S', 'Avanza']);

    let seq = 0;
    for (const [brand, model, y1, y2, engine, inj, psiMinRaw, psiMaxRaw, zone, ret, locOverride, note, verified] of V) {
      seq++;
      if (!brandIds[brand]) brandIds[brand] = await db.insertReturningId(brandSql, [brand]);

      // Regla de taller — PSI en riel (llave ON / acelerado):
      //  - MFI (full inyección): 50–60 PSI, salvo familia Yaris (38–44, spec real de manual)
      //  - TBI / Vortec / GDI: se respeta el valor propio de cada sistema (no tocado)
      let psiMin = psiMinRaw, psiMax = psiMaxRaw;
      if (inj === 'MFI') {
        if (brand === 'Toyota' && YARIS_FAMILY.has(model)) { psiMin = 38; psiMax = 44; }
        else { psiMin = 50; psiMax = 60; }
      }

      const isVerified = verified === undefined ? 1 : verified;
      const fullNote = isVerified ? (note || null) : `⚠ ESTIMADO — verificar contra manual antes de reparar. ${note || ''}`.trim();
      const vehId = await db.insertReturningId(vehSql, [brandIds[brand], model, y1, y2, engine, bodyType(model), injIds[inj], psiMin, psiMax, fullNote, isVerified]);

      // Clase de presión de la pila según el sistema (banco de pruebas, pila sola sin regulador)
      const cls = inj === 'GDI' ? 'GDI'
        : inj === 'TBI' ? 'TBI'
        : inj === 'VORTEC_CSFI' ? 'VORTEC'
        : (brand === 'Toyota' && YARIS_FAMILY.has(model)) ? 'MFI_ECO'
        : 'MFI_STD';

      // Flujo estimado del módulo según motor
      const disp = parseFloat((engine.match(/(\d+\.\d+)L/) || [])[1] || 2.0);
      const isV8 = /V8/.test(engine);
      const baseFlow = isV8 ? 150 : /V6|L6|L5/.test(engine) ? 130 : disp <= 1.6 ? 95 : 110;

      const prof = moduleProfile({ brand, model, y1, y2, inj, ret, zone, isV8, disp, psiMax });

      // Presión regulada del módulo (banco): MFI = 60 PSI, o 60–80 PSI si el motor es V8 (más de 6 cilindros).
      // TBI/Vortec/GDI conservan su propio valor de riel (el módulo TBI no regula; Vortec y GDI no siguen esta regla).
      const modulePsi = inj === 'MFI' ? (isV8 ? 75 : 60) : psiMax;

      const brandCode = brand.slice(0, 3).toUpperCase();
      const modId = await db.insertReturningId(modSql, [
        `FTM-${brandCode}-${String(seq).padStart(3, '0')}`,
        `${prof.namePrefix} ${brand} ${model} ${y1}–${y2}`,
        prof.assembly,
        modulePsi, prof.flow(baseFlow), prof.regulator,
        prof.floatType,
        prof.strainer,
        prof.connector,
        prof.lines,
        prof.mount,
        prof.diagram
      ]);

      await db.run(vmSql, [vehId, modId, locOverride || ZONE_LOC[zone], zone, zone === 'tank_drop' ? 1 : 0, ZONE_ACCESS[zone]]);

      for (const [pumpCode, isOem, pnote] of CLASS_PUMPS[cls]) {
        await db.run(mpSql, [modId, pumpIds[pumpCode], isOem ? 'directa' : 'con adaptación', isOem, pnote]);
      }
    }
    await db.exec('COMMIT');
  } catch (e) {
    await db.exec('ROLLBACK');
    console.error("Error sembrando datos:", e);
    process.exit(1);
  }

  console.log('Base de datos creada y sembrada con éxito:');
  for (const t of ['injection_types', 'brands', 'vehicles', 'fuel_modules', 'fuel_pumps', 'vehicle_modules', 'module_pumps']) {
    const r = await db.get(`SELECT COUNT(*) c FROM ${t}`);
    console.log(`  ${t}: ${r ? r.c : 0} filas`);
  }

  // Inicializar statsDb para que las tablas de métricas existan al arrancar
  await statsDb.exec(`
    CREATE TABLE IF NOT EXISTS visit_days (
      day          TEXT NOT NULL,
      visitor_hash TEXT NOT NULL,
      PRIMARY KEY (day, visitor_hash)
    );
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS chat_limits (
      day TEXT NOT NULL,
      device_id TEXT NOT NULL,
      count INTEGER NOT NULL,
      PRIMARY KEY (day, device_id)
    );
    CREATE TABLE IF NOT EXISTS missing_searches (
      day TEXT NOT NULL,
      q TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, q)
    );
  `);
  console.log('Tablas de stats inicializadas.');
  process.exit(0);
}

runSeed();
