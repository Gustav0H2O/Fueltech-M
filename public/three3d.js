/* FuelTech Master — Visores 3D estilo BLUEPRINT técnico (Three.js + modelos GLTF)
   Vehículo en vista fantasma/rayos X, módulo en despiece sobre su eje,
   y todo delineado con wireframe técnico (aristas) en lugar de render fotorrealista.
   Expone window.FT3D = { car, module, pump } y dispara 'ft3d-ready'. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/* ================= paleta dual dark / light =================
   Detecta preferencia de color scheme al cargar el módulo.
   En dark mode: aristas brillantes sobre fondo oscuro.
   En light mode: aristas más oscuras sobre fondo claro. */
const _isLight = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches;

const PAL = _isLight ? {
  edge:      0x4a6a8a,
  ghostEdge: 0x3a5a7a,
  ghostFill: 0x6a8aa0,
  paint:     0x8fa5b5,
  glassCar:  0x6a8094,
  steel:     0x556b7d,
  zinc:      0x4a6072,
  chrome:    0x60768a,
  brass:     0x6a8096,
  blackPl:   0x3a5065,
  grayPl:    0x4a6075,
  whitePl:   0x6a8298,
  rubber:    0x2a3f52,
  hdpe:      0x3a5568,
  pcb:       0x2d5a48,
} : {
  edge:      0x6fc1e0,
  ghostEdge: 0x5a8fc0,
  ghostFill: 0x4a6480,
  paint:     0x1f3145,
  glassCar:  0x141f2e,
  steel:     0x3a5068,
  zinc:      0x324d66,
  chrome:    0x4a6783,
  brass:     0x55708a,
  blackPl:   0x293e52,
  grayPl:    0x354b60,
  whitePl:   0x526c85,
  rubber:    0x1f3040,
  hdpe:      0x2a3f52,
  pcb:       0x1d4a38,
};

const F = (c, extra = {}) => new THREE.MeshStandardMaterial({
  color: c, metalness: 0, roughness: 1,
  polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, ...extra
});

const MAT = {
  paint:   () => F(PAL.paint, { transparent: true, opacity: _isLight ? .22 : .18, depthWrite: false }),
  glassCar:() => F(PAL.glassCar, { transparent: true, opacity: _isLight ? .15 : .12, depthWrite: false }),
  steel:   () => F(PAL.steel),
  zinc:    () => F(PAL.zinc),
  chrome:  () => F(PAL.chrome),
  brass:   () => F(PAL.brass),
  blackPl: () => F(PAL.blackPl),
  grayPl:  () => F(PAL.grayPl),
  whitePl: () => F(PAL.whitePl),
  rubber:  () => F(PAL.rubber),
  hdpe:    () => F(PAL.hdpe),
  smoked:  () => F(0x8fa5b5, { transparent: true, opacity: .04, side: THREE.DoubleSide, depthWrite: false }),
  pcb:     () => F(PAL.pcb),
  glow:    (c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: .8 }),
};

function addEdges(mesh, { color = PAL.edge, opacity = .85, threshold = 12 } = {}) {
  const eg = new THREE.EdgesGeometry(mesh.geometry, threshold);
  if (!eg.attributes.position || eg.attributes.position.count === 0) { eg.dispose(); return; }
  const line = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
  line.raycast = () => {};
  mesh.add(line);
}

function blueprint(root) {
  root.traverse(o => {
    if (!o.isMesh || o.isLine || o.isSprite) return;
    const m = o.material;
    if (!m || m.map || m.isMeshBasicMaterial || o.userData.noEdges) return;
    if (m.emissiveIntensity > .5) return;
    addEdges(o, { opacity: m.transparent ? .65 : .85 });
  });
}

function makeLabel(text, color = '#e6edf3', scale = 0.011) {
  const c = document.createElement('canvas');
  const m = c.getContext('2d');
  m.font = '600 42px "Chakra Petch", sans-serif';
  const pad = 16;
  c.width = Math.ceil(m.measureText(text).width) + pad * 2; c.height = 68;
  const ctx = c.getContext('2d');
  const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); };
  ctx.fillStyle = 'rgba(8,12,18,.82)';
  rr(1, 6, c.width - 2, c.height - 12, 8); ctx.fill();
  ctx.strokeStyle = 'rgba(147,177,203,.5)'; ctx.lineWidth = 1.5;
  rr(1, 6, c.width - 2, c.height - 12, 8); ctx.stroke();
  ctx.font = '600 42px "Chakra Petch", sans-serif';
  ctx.fillStyle = color; ctx.textBaseline = 'middle';
  ctx.fillText(text, pad, 36);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set(c.width * scale, c.height * scale, 1);
  return sp;
}

/* etiqueta impresa envolvente (para el cuerpo de la pila) */
function printedBand(lines, radius, height) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 1024, 256);
  ctx.fillStyle = 'rgba(214,226,238,.92)';
  ctx.textAlign = 'center';
  for (let rep = 0; rep < 2; rep++) {
    const cx = 256 + rep * 512;
    ctx.font = '700 54px "Chakra Petch", sans-serif';
    ctx.fillText(lines[0], cx, 105);
    ctx.font = '500 36px "Chakra Petch", sans-serif';
    ctx.fillText(lines[1] || '', cx, 165);
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, 48, 1, true),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true })
  );
}

/* resorte helicoidal */
function spring(r, h, turns, tubeR) {
  const pts = [];
  const N = turns * 20;
  for (let i = 0; i <= N; i++) {
    const a = (i / 20) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * r, (i / N) * h, Math.sin(a) * r));
  }
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), N * 2, tubeR, 6), MAT.steel());
}

const tube = (points, r, mat, segs = 40) =>
  new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), segs, r, 10), mat);
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

/* ================= infraestructura de visor ================= */
function createViewer(el, { camPos = [4.5, 3, 6], height = 300, target = [0, 0, 0], groundY = -1.6 } = {}) {
  el.innerHTML = '';
  el.style.position = 'relative';
  el.style.height = height + 'px';

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(el.clientWidth || 300, height);
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(40, (el.clientWidth || 300) / height, 0.1, 100);
  camera.position.set(...camPos);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(...target);
  controls.enableDamping = true; controls.dampingFactor = .08;
  controls.autoRotate = true; controls.autoRotateSpeed = 1.0;
  controls.minDistance = 1.5; controls.maxDistance = 20;
  renderer.domElement.addEventListener('pointerdown', () => { controls.autoRotate = false; }, { once: true });

  scene.add(new THREE.AmbientLight(0xcfe0ee, 1.5));
  const key = new THREE.DirectionalLight(0xdfeaf4, .7);
  key.position.set(5, 8, 6);
  scene.add(key);

  const gridColor = _isLight ? 0x90a4b8 : 0x2a3d52;
  const gridColor2 = _isLight ? 0xb0c4d8 : 0x18232f;
  const grid = new THREE.GridHelper(26, 40, gridColor, gridColor2);
  grid.position.y = groundY - 0.002; scene.add(grid);

  const hint = document.createElement('div');
  hint.className = 'v3d-hint';
  hint.textContent = 'arrastra · rueda = zoom';
  el.appendChild(hint);

  const clock = new THREE.Clock();
  const ticks = [];
  let raf = 0, dead = false;
  (function loop() {
    if (dead) return;
    raf = requestAnimationFrame(loop);
    const t = clock.getElapsedTime();
    for (const fn of ticks) fn(t);
    controls.update();
    renderer.render(scene, camera);
  })();

  const ro = new ResizeObserver(() => {
    const w = el.clientWidth || 300;
    camera.aspect = w / height; camera.updateProjectionMatrix();
    renderer.setSize(w, height);
  });
  ro.observe(el);

  const dispose = () => {
    dead = true; cancelAnimationFrame(raf); ro.disconnect(); controls.dispose();
    scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
    });
    renderer.dispose();
    el.innerHTML = '';
  };
  return { scene, camera, controls, renderer, ticks, dispose, el };
}


function enableHover(viewer, meshes) {
  const tip = document.createElement('div');
  tip.className = 'v3d-tip';
  viewer.el.appendChild(tip);
  const ray = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let current = null;
  viewer.renderer.domElement.addEventListener('pointermove', (e) => {
    const r = viewer.renderer.domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(mouse, viewer.camera);
    const hit = ray.intersectObjects(meshes, false)[0];
    if (current && (!hit || hit.object !== current)) {
      if (current.material.emissive) {
        current.material.emissive.setHex(current.userData._em || 0);
        current.material.emissiveIntensity = current.userData._emi || 0;
      }
      current = null; tip.style.opacity = 0;
    }
    if (hit && hit.object.userData.name && hit.object !== current && hit.object.material.emissive) {
      current = hit.object;
      current.userData._em = current.material.emissive.getHex();
      current.userData._emi = current.material.emissiveIntensity;
      current.material.emissive.setHex(0xe53935);
      current.material.emissiveIntensity = .5;
      tip.textContent = current.userData.name;
      tip.style.opacity = 1;
    }
    if (current) { tip.style.left = (e.clientX - r.left + 14) + 'px'; tip.style.top = (e.clientY - r.top - 8) + 'px'; }
  });
}

/* ================= 1. VEHÍCULO: modelo GLTF real + sistema de combustible ================= */
const gltfLoader = new GLTFLoader();
const bodyCache = {};
function loadBodyModel(type) {
  if (!bodyCache[type]) bodyCache[type] = new Promise((resolve, reject) =>
    gltfLoader.load(`models/${type}.glb`, gl => resolve(gl.scene), undefined, reject));
  return bodyCache[type];
}

/* sistema de combustible superpuesto, posicionado según el bounding box del modelo */
function buildFuelSystem(g, box, { zone, psiText, zoneLabel, bodyType }, hoverables, v) {
  const size = box.getSize(new THREE.Vector3());
  const L = size.x, H = size.y, W = size.z;
  const X = f => box.min.x + f * L;
  const Y = f => box.min.y + f * H;

  /* tanque HDPE con abrazaderas */
  const tankX = bodyType === 'pickup' ? X(.4) : X(.27);
  const tank = new THREE.Mesh(new THREE.BoxGeometry(L * .2, H * .13, W * .5), MAT.hdpe());
  tank.position.set(tankX, Y(.15), W * .04);
  tank.userData.name = 'Tanque de gasolina (HDPE)';
  g.add(tank); hoverables.push(tank);
  for (const dz of [-.14 * W, .16 * W]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(L * .22, .025, .06), MAT.steel());
    strap.position.set(tankX, Y(.075), dz); g.add(strap);
  }
  /* cuello de llenado */
  g.add(tube([V3(tankX, Y(.18), W * .2), V3(X(.14), Y(.4), W * .38), V3(X(.09), Y(.5), W * .43)], .04, MAT.steel(), 20));

  /* riel de inyectores + etiqueta */
  const rail = tube([V3(X(.76), Y(.6), W * .12), V3(X(.93), Y(.6), W * .12)], .04, MAT.chrome(), 8);
  rail.userData.name = 'Riel / flauta de inyectores'; g.add(rail); hoverables.push(rail);
  const railLbl = makeLabel(`RIEL ${psiText} PSI`, '#E5E7EB');
  railLbl.position.set(X(.84), box.max.y + .45, W * .12); g.add(railLbl);

  /* línea de combustible tanque -> riel */
  const line = tube([
    V3(tankX, Y(.08), W * .2), V3(X(.55), Y(.06), W * .32),
    V3(X(.75), Y(.1), W * .28), V3(X(.84), Y(.56), W * .12)
  ], .02, new THREE.MeshStandardMaterial({ color: 0xe53935, metalness: .3, roughness: .4, emissive: 0xe53935, emissiveIntensity: .18 }), 50);
  line.userData.name = 'Línea de combustible'; g.add(line); hoverables.push(line);

  /* marcador pulsante del módulo */
  const zonesPos = {
    rear_seat:   [X(.38), Y(.42), 0],
    trunk_access:[X(.13), Y(.5), 0],
    tank_drop:   [tankX, Y(.24), W * .04],
    frame_rail:  [X(.58), Y(.12), W * .32],
  };
  const [mx, my, mz] = zonesPos[zone] || zonesPos.tank_drop;
  const marker = new THREE.Mesh(new THREE.SphereGeometry(.12, 20, 20), MAT.glow(0xe53935));
  marker.position.set(mx, my, mz); marker.userData.name = 'Módulo de gasolina';
  g.add(marker); hoverables.push(marker);
  const halo = new THREE.Mesh(new THREE.SphereGeometry(.12, 20, 20),
    new THREE.MeshBasicMaterial({ color: 0xe53935, transparent: true, opacity: .25, depthWrite: false }));
  halo.position.copy(marker.position); g.add(halo);
  const mkLbl = makeLabel(zoneLabel || 'MÓDULO', '#e53935');
  mkLbl.position.set(mx, box.max.y + .95, mz); g.add(mkLbl);

  v.ticks.push(t => {
    const k = 1 + Math.sin(t * 3.5) * .5;
    halo.scale.setScalar(1 + k); halo.material.opacity = .3 - k * .12;
  });
}

/* sedán procedural de respaldo (si el GLB no carga, p.ej. sin internet la 1a vez) */
function buildProceduralCar(carGrp, hoverables) {
  const s = new THREE.Shape();
  s.moveTo(-2.55, .45);
  s.quadraticCurveTo(-2.6, .34, -2.38, .32);
  s.lineTo(-2.06, .32);
  s.absarc(-1.6, .32, .46, Math.PI, 0, true);
  s.lineTo(1.14, .32);
  s.absarc(1.6, .32, .46, Math.PI, 0, true);
  s.lineTo(2.36, .32);
  s.quadraticCurveTo(2.62, .36, 2.6, .6);
  s.quadraticCurveTo(2.56, .82, 1.9, .86);
  s.lineTo(1.02, .94);
  s.quadraticCurveTo(.66, 1.36, 0.0, 1.4);
  s.lineTo(-.9, 1.38);
  s.quadraticCurveTo(-1.55, 1.28, -1.9, .96);
  s.quadraticCurveTo(-2.36, .9, -2.55, .45);
  const bodyGeo = new THREE.ExtrudeGeometry(s, { depth: 1.66, bevelEnabled: true, bevelSize: .07, bevelThickness: .09, bevelSegments: 4, curveSegments: 24 });
  bodyGeo.translate(0, 0, -0.83);
  carGrp.add(new THREE.Mesh(bodyGeo, MAT.paint()));

  const gs = new THREE.Shape();
  gs.moveTo(.95, .96);
  gs.quadraticCurveTo(.62, 1.33, .0, 1.365);
  gs.lineTo(-.88, 1.345);
  gs.quadraticCurveTo(-1.48, 1.25, -1.8, .97);
  gs.lineTo(.95, .96);
  const glassGeo = new THREE.ExtrudeGeometry(gs, { depth: 1.5, bevelEnabled: false, curveSegments: 20 });
  glassGeo.translate(0, .015, -0.75);
  carGrp.add(new THREE.Mesh(glassGeo, MAT.glassCar()));

  const head = new THREE.Mesh(new THREE.BoxGeometry(.1, .12, .4), MAT.glow(0xfff6d8));
  head.position.set(2.56, .62, .5); carGrp.add(head);
  const head2 = head.clone(); head2.position.z = -.5; carGrp.add(head2);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(.08, .1, .42), MAT.glow(0xc22222));
  tail.position.set(-2.58, .62, .5); carGrp.add(tail);
  const tail2 = tail.clone(); tail2.position.z = -.5; carGrp.add(tail2);

  const mkWheel = () => {
    const w = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.TorusGeometry(.31, .13, 14, 32), MAT.rubber());
    w.add(tire);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(.2, .2, .16, 24), MAT.chrome());
    rim.rotation.x = Math.PI / 2; w.add(rim);
    for (let i = 0; i < 5; i++) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(.05, .3, .05), MAT.chrome());
      sp.rotation.z = (i / 5) * Math.PI * 2; w.add(sp);
    }
    return w;
  };
  for (const x of [1.6, -1.6]) for (const z of [.82, -.82]) {
    const w = mkWheel(); w.position.set(x, .32, z); carGrp.add(w);
  }

  const seatMat = MAT.grayPl();
  const bench = new THREE.Mesh(new THREE.BoxGeometry(.6, .16, 1.3), seatMat);
  bench.position.set(-.95, .6, 0); bench.userData.name = 'Asiento trasero'; carGrp.add(bench); hoverables.push(bench);
  const engine = new THREE.Mesh(new THREE.BoxGeometry(.8, .5, .95), MAT.steel());
  engine.position.set(1.75, .58, 0); engine.userData.name = 'Motor'; carGrp.add(engine); hoverables.push(engine);

  carGrp.position.y = .13;
}

function car(el, { zone = 'tank_drop', psiText = '', zoneLabel = '', body = 'sedan' } = {}) {
  const v = createViewer(el, { camPos: [4.8, 2.6, 6.4], height: 320, target: [0, .8, 0], groundY: 0 });
  const loader = document.createElement('div');
  loader.style.cssText = 'position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(13,17,23,.6); color: #E5E7EB; font: 600 12px sans-serif; z-index: 10; letter-spacing: 1px; backdrop-filter: blur(3px);';
  loader.textContent = 'CARGANDO MODELO 3D...';
  v.el.appendChild(loader);
  
  const g = new THREE.Group(); v.scene.add(g);
  const hoverables = [];

  const finish = (box) => {
    buildFuelSystem(g, box, { zone, psiText, zoneLabel, bodyType: body }, hoverables, v);
    blueprint(g);
    enableHover(v, hoverables);
    if (loader.parentNode) loader.parentNode.removeChild(loader);
  };

  loadBodyModel(body).then(srcScene => {
    const model = srcScene.clone(true);
    model.rotation.y = Math.PI / 2;
    model.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(model);
    const scale = 5.0 / Math.max(box.getSize(new THREE.Vector3()).x, .001);
    model.scale.setScalar(scale);
    model.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(model);
    model.position.y -= box.min.y;
    model.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(model);
    model.traverse(o => {
      if (!o.isMesh) return;
      const nm = (o.name || '') + '|' + (o.parent && o.parent.name || '');
      o.material = new THREE.MeshStandardMaterial({
        color: PAL.ghostFill, metalness: 0, roughness: 1,
        transparent: true, opacity: _isLight ? .25 : .2, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
      });
      // aristas técnicas con threshold bajo para más detalle blueprint
      addEdges(o, { color: PAL.ghostEdge, opacity: .85, threshold: 8 });
      o.userData.noEdges = true;
      if (nm.includes('body')) o.userData.name = 'Carrocería (vista fantasma)';
    });
    g.add(model);
    finish(box);
  }).catch(() => {
    const carGrp = new THREE.Group();
    buildProceduralCar(carGrp, hoverables);
    g.add(carGrp);
    carGrp.updateMatrixWorld(true);
    finish(new THREE.Box3().setFromObject(carGrp));
  });

  return v.dispose;
}

/* ================= 2b. BOMBA EXTERNA (frame rail — VW Sedán, Golf A2…) ================= */
function externalPump(el) {
  const v = createViewer(el, { camPos: [2.4, 1.5, 3.2], height: 340, target: [0, .1, 0], groundY: -1.1 });
  const g = new THREE.Group(); v.scene.add(g);
  const hoverables = [];

  /* riel del chasis */
  const rail = new THREE.Mesh(new THREE.BoxGeometry(3.2, .3, .5), MAT.steel());
  rail.position.set(0, .75, -.45); rail.userData.name = 'Chasis / larguero';
  g.add(rail); hoverables.push(rail);

  /* soporte de lámina con gomas antivibración */
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(1.5, .08, .5), MAT.zinc());
  bracket.position.set(0, .48, -.1); bracket.userData.name = 'Soporte de lámina';
  g.add(bracket); hoverables.push(bracket);
  for (const dx of [-.55, .55]) {
    const iso = new THREE.Mesh(new THREE.CylinderGeometry(.09, .09, .16, 14), MAT.rubber());
    iso.position.set(dx, .56, -.1); iso.userData.name = 'Goma antivibración';
    g.add(iso); hoverables.push(iso);
    const strap = new THREE.Mesh(new THREE.TorusGeometry(.4, .022, 8, 32, Math.PI), MAT.zinc());
    strap.rotation.x = 0; strap.rotation.y = Math.PI / 2; strap.rotation.z = Math.PI;
    strap.position.set(dx, .44, -.1); g.add(strap);
  }

  /* cuerpo horizontal de la bomba */
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.34, .34, 1.35, 36), MAT.zinc());
  body.rotation.z = Math.PI / 2; body.position.y = .1;
  body.userData.name = 'Bomba externa (rodillos) — sensible a suciedad del tanque';
  g.add(body); hoverables.push(body);
  const band = printedBand(['BOMBA EXTERNA', '12V DC'], .345, .5);
  band.rotation.z = Math.PI / 2; band.position.y = .1; g.add(band);

  /* entrada (cedazo en línea) y salida con check */
  const inlet = new THREE.Mesh(new THREE.CylinderGeometry(.1, .1, .4, 14), MAT.brass());
  inlet.rotation.z = Math.PI / 2; inlet.position.set(-.85, .1, 0);
  inlet.userData.name = 'ENTRADA — filtro-cedazo en línea antes de la bomba';
  g.add(inlet); hoverables.push(inlet);
  const filter = new THREE.Mesh(new THREE.CylinderGeometry(.18, .18, .34, 20), MAT.whitePl());
  filter.rotation.z = Math.PI / 2; filter.position.set(-1.25, .1, 0);
  filter.userData.name = 'Filtro en línea (pre-bomba)';
  g.add(filter); hoverables.push(filter);
  const outlet = new THREE.Mesh(new THREE.CylinderGeometry(.08, .08, .42, 14), MAT.brass());
  outlet.rotation.z = Math.PI / 2; outlet.position.set(.86, .1, 0);
  outlet.userData.name = 'SALIDA hacia el motor (con válvula check)';
  g.add(outlet); hoverables.push(outlet);

  /* terminales eléctricos */
  for (const [dz, name, mat] of [[.12, 'Polo POSITIVO (+)', new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: .5 })], [-.12, 'Polo NEGATIVO (−)', MAT.blackPl()]]) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, .2, 10), MAT.brass());
    t.position.set(.55, .5, dz); t.userData.name = name; g.add(t); hoverables.push(t);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(.055, .06, .07, 12), mat);
    base.position.set(.55, .42, dz); g.add(base);
  }

  /* flechas de flujo */
  const inArrow = new THREE.Mesh(new THREE.ConeGeometry(.07, .18, 12), MAT.glow(0x22d3ee));
  inArrow.rotation.z = -Math.PI / 2; inArrow.position.set(-1.6, .1, 0); g.add(inArrow);
  const outArrow = new THREE.Mesh(new THREE.ConeGeometry(.07, .18, 12), MAT.glow(0x4ade80));
  outArrow.rotation.z = -Math.PI / 2; outArrow.position.set(1.25, .1, 0); g.add(outArrow);
  const lblIn = makeLabel('DESDE EL TANQUE', '#22d3ee'); lblIn.position.set(-1.5, .75, .3); g.add(lblIn);
  const lblOut = makeLabel('AL MOTOR', '#4ade80'); lblOut.position.set(1.35, .75, .3); g.add(lblOut);
  const lblNo = makeLabel('NO LLEVA MÓDULO EN TANQUE', '#e53935'); lblNo.position.set(0, 1.35, .3); g.add(lblNo);

  blueprint(g);
  v.ticks.push(t => {
    inArrow.position.x = -1.6 + Math.sin(t * 4) * .06;
    outArrow.position.x = 1.25 + Math.sin(t * 4) * .06;
  });
  enableHover(v, hoverables);
  return v.dispose;
}

/* ================= 2. MÓDULO realista con despiece =================
   kind (= diagram_key del módulo):
     module_intank_returnless  módulo integrado (default)
     module_intank_return      módulo con puerto de retorno
     module_hanger             colgante porta-pila (sin vaso ni tarjeta)
     module_gdi                módulo de baja GDI (con jet-pump)
     module_external           bomba externa (escena propia)              */
function module_(el, { kind = 'module_intank_returnless' } = {}) {
  if (kind === 'module_external') return externalPump(el);
  const isHanger = kind === 'module_hanger';
  const hasReturn = isHanger || kind === 'module_intank_return';
  const isGdi = kind === 'module_gdi';

  const v = createViewer(el, { camPos: [4.6, 2.6, 5.8], height: 340, target: [0, .55, 0], groundY: -2.0 });
  const g = new THREE.Group(); v.scene.add(g);
  const parts = [];
  const add = (obj, name, baseY, expY) => {
    obj.userData = { ...obj.userData, name, baseY, expY };
    obj.position.y = baseY; parts.push(obj); g.add(obj);
    return obj;
  };

  /* brida superior (plástico negro con puertos y conector) */
  const flange = new THREE.Group();
  flange.add(new THREE.Mesh(new THREE.CylinderGeometry(.95, .98, .12, 40), MAT.blackPl()));
  const dome = new THREE.Mesh(new THREE.CylinderGeometry(.5, .58, .16, 32), MAT.blackPl());
  dome.position.y = .13; flange.add(dome);
  const port1 = new THREE.Mesh(new THREE.CylinderGeometry(.085, .085, .45, 14), MAT.blackPl());
  port1.position.set(.32, .3, .1); port1.rotation.z = -.25; flange.add(port1);
  const portTip = new THREE.Mesh(new THREE.CylinderGeometry(.095, .095, .06, 14), MAT.steel());
  portTip.position.set(.37, .5, .1); portTip.rotation.z = -.25; flange.add(portTip);
  if (hasReturn) {
    const port2 = new THREE.Mesh(new THREE.CylinderGeometry(.07, .07, .42, 14), MAT.blackPl());
    port2.position.set(.02, .28, -.3); port2.rotation.x = .3; flange.add(port2);
    const port2Tip = new THREE.Mesh(new THREE.CylinderGeometry(.078, .078, .06, 14), MAT.steel());
    port2Tip.position.set(.02, .47, -.36); port2Tip.rotation.x = .3; flange.add(port2Tip);
  }
  const connBox = new THREE.Mesh(new THREE.BoxGeometry(.32, .18, .24), MAT.blackPl());
  connBox.position.set(-.42, .22, 0); flange.add(connBox);
  for (let i = 0; i < 4; i++) {
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(.014, .014, .1, 6), MAT.brass());
    pin.position.set(-.42 - .09 + (i % 2) * .18, .33, -.05 + Math.floor(i / 2) * .1);
    flange.add(pin);
  }
  add(flange,
    hasReturn ? 'Brida / tapa (alimentación + retorno y conector)' : 'Brida / tapa (alimentación y conector)',
    1.5, 2.7);

  /* colgante: tubos fijos de acero · módulo: varillas guía con resorte */
  for (const dx of [-.55, .55]) {
    const rodG = new THREE.Group();
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(.032, .032, 1.45, 10), MAT.steel());
    rod.position.y = -.72; rodG.add(rod);
    if (!isHanger) {
      const spr = spring(.085, .8, 7, .016);
      spr.position.y = -1.15; rodG.add(spr);
    }
    rodG.position.x = dx;
    add(rodG, isHanger ? 'Tubo fijo del colgante (no telescópico)' : 'Varilla guía con resorte', 1.5, 2.25);
  }

  /* cableado interno (+ rojo / − negro) */
  const wireR = tube([V3(-.35, 1.42, .05), V3(-.42, .9, .22), V3(-.2, .5, .18), V3(-.12, .42, .08)], .022,
    new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: .6 }), 30);
  add(wireR, 'Cable positivo (+)', 0, .9);
  const wireB = tube([V3(-.48, 1.42, -.05), V3(-.55, .85, -.2), V3(-.25, .48, -.15), V3(-.14, .42, -.06)], .022,
    MAT.blackPl(), 30);
  add(wireB, 'Cable negativo (−)', 0, .9);

  if (!isHanger) {
    /* reservorio translúcido con costillas (los colgantes no llevan vaso) */
    const cup = new THREE.Group();
    cup.add(new THREE.Mesh(new THREE.CylinderGeometry(.68, .6, 1.5, 40, 1, true), MAT.smoked()));
    const bottom = new THREE.Mesh(new THREE.CylinderGeometry(.6, .6, .05, 40), MAT.smoked());
    bottom.position.y = -.75; cup.add(bottom);
    for (const ry of [-.4, .1, .55]) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(.675, .018, 8, 40), MAT.grayPl());
      rib.rotation.x = Math.PI / 2; rib.position.y = ry; cup.add(rib);
    }
    add(cup, 'Reservorio / vaso del módulo', .05, .05);

    /* tarjeta del aforador */
    const pcb = new THREE.Mesh(new THREE.BoxGeometry(.02, .5, .3), MAT.pcb());
    pcb.position.set(.69, 0, 0);
    add(pcb, 'Tarjeta del aforador (nivel)', .1, .1);
  }

  if (isGdi) {
    const jetG = new THREE.Group();
    const jetBody = new THREE.Mesh(new THREE.CylinderGeometry(.09, .12, .34, 14),
      new THREE.MeshStandardMaterial({ color: 0xc2410c, metalness: .1, roughness: .55 }));
    jetBody.position.set(-.38, -.62, .3); jetG.add(jetBody);
    const jetTube = tube([V3(-.38, -.45, .3), V3(-.5, -.1, .35), V3(-.55, .3, .25)], .025, MAT.grayPl(), 20);
    jetG.add(jetTube);
    add(jetG, 'Jet-pump (venturi) — llena el vaso del módulo GDI', 0, -.55);
  }

  /* pila dentro (mini versión realista) */
  const pumpG = new THREE.Group();
  const pBody = new THREE.Mesh(new THREE.CylinderGeometry(.28, .28, .85, 28), MAT.zinc());
  pumpG.add(pBody);
  const pTop = new THREE.Mesh(new THREE.CylinderGeometry(.29, .29, .12, 28), MAT.blackPl());
  pTop.position.y = .48; pumpG.add(pTop);
  const pOut = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, .3, 10), MAT.brass());
  pOut.position.y = .65; pumpG.add(pOut);
  for (const ry of [-.25, .2]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.285, .012, 6, 28), MAT.zinc());
    ring.rotation.x = Math.PI / 2; ring.position.y = ry; pumpG.add(ring);
  }
  add(pumpG, 'PILA (bomba en bruto)', -.05, -.05);

  /* flotador */
  const floatG = new THREE.Group();
  const pivot = new THREE.Mesh(new THREE.BoxGeometry(.08, .14, .1), MAT.grayPl());
  pivot.position.set(.7, .25, 0); floatG.add(pivot);
  floatG.add(tube([V3(.72, .22, 0), V3(1.15, -.05, .12), V3(1.38, -.28, .15)], .018, MAT.steel(), 20));
  const foam = new THREE.Mesh(new THREE.CapsuleGeometry(.11, .22, 6, 14), MAT.blackPl());
  foam.rotation.z = Math.PI / 2; foam.position.set(1.42, -.32, .15);
  foam.userData.name = 'Flotador (aforador de nivel)';
  floatG.add(foam);
  add(floatG, 'Flotador (aforador de nivel)', 0, 0);

  /* cedazo: bolsa de tela blanca */
  const strainer = new THREE.Mesh(new THREE.SphereGeometry(.42, 24, 16), MAT.whitePl());
  strainer.scale.set(1.15, .3, .75);
  add(strainer, 'Cedazo (pre-filtro de tela)', -.95, -1.7);

  /* despiece a lo largo del eje: es la vista por defecto (se anima al abrir) */
  let exploded = true, f = 0;
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'v3d-btn';
  const btnIcon = document.createElement('span'); btnIcon.className = 'icon';
  const btnLabel = document.createElement('span');
  btnLabel.setAttribute('aria-live', 'polite');
  btn.append(btnIcon, btnLabel);
  const setBtnState = () => {
    btnLabel.textContent = exploded ? 'ARMAR' : 'VER DESPIECE';
    btnIcon.innerHTML = '';
    if (window.lucide) {
      const svg = window.lucide.createElement(exploded ? window.lucide.Box : window.lucide.Layers, { width: 14, height: 14, 'aria-hidden': 'true' });
      btnIcon.appendChild(svg);
    }
  };
  setBtnState();
  btn.onclick = () => { exploded = !exploded; setBtnState(); };
  v.el.appendChild(btn);

  blueprint(g);
  v.ticks.push(() => {
    f += ((exploded ? 1 : 0) - f) * .07;
    for (const p of parts) {
      const { baseY, expY } = p.userData;
      p.position.y = baseY + (expY - baseY) * f;
    }
  });
  const hoverMeshes = [];
  for (const p of parts) p.traverse(o => { if (o.isMesh && !o.material.transparent) { o.userData.name = o.userData.name || p.userData.name; hoverMeshes.push(o); } });
  enableHover(v, hoverMeshes);
  return v.dispose;
}

/* ================= 3. PILA realista con etiqueta impresa ================= */
function pump(el, { psi = '', style = '', code = '' } = {}) {
  const v = createViewer(el, { camPos: [2.3, 1.3, 3.0], height: 260, target: [0, 0, 0], groundY: -1.25 });
  const g = new THREE.Group(); v.scene.add(g);
  const hoverables = [];

  const body = new THREE.Mesh(new THREE.CylinderGeometry(.42, .42, 1.25, 40), MAT.zinc());
  body.userData.name = `Cuerpo (${style})`; g.add(body); hoverables.push(body);
  for (const ry of [-.42, .42]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.425, .016, 8, 40), MAT.zinc());
    ring.rotation.x = Math.PI / 2; ring.position.y = ry; g.add(ring);
  }
  if (code) {
    const band = printedBand([code.split(' (')[0], '12V DC'], .428, .5);
    g.add(band);
  }

  const cap = new THREE.Mesh(new THREE.CylinderGeometry(.43, .44, .18, 40), MAT.blackPl());
  cap.position.y = .7; g.add(cap);
  const capStep = new THREE.Mesh(new THREE.CylinderGeometry(.3, .34, .12, 32), MAT.blackPl());
  capStep.position.y = .83; g.add(capStep);

  const mkTerminal = (x, positive) => {
    const t = new THREE.Group();
    const stud = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, .18, 10), MAT.brass());
    stud.position.y = .08; t.add(stud);
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, .05, 6), MAT.brass());
    nut.position.y = .04; t.add(nut);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(.055, .065, .06, 12),
      positive ? new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: .5 }) : MAT.blackPl());
    t.add(base);
    t.position.set(x, .9, .12);
    return t;
  };
  const tp = mkTerminal(-.19, true); g.add(tp);
  tp.children[0].userData.name = 'Polo POSITIVO (+)'; hoverables.push(tp.children[0]);
  const tn = mkTerminal(.19, false); g.add(tn);
  tn.children[0].userData.name = 'Polo NEGATIVO (−)'; hoverables.push(tn.children[0]);
  const posL = makeLabel('+', '#f87171', .015); posL.position.set(-.19, 1.22, .12); g.add(posL);
  const negL = makeLabel('−', '#d8e2ec', .015); negL.position.set(.19, 1.22, .12); g.add(negL);

  const out = new THREE.Mesh(new THREE.CylinderGeometry(.075, .075, .38, 14), MAT.brass());
  out.position.set(0, .98, -.12); out.userData.name = `Salida con check — ${psi} PSI máx directa`;
  g.add(out); hoverables.push(out);
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(.07, .16, 12), MAT.glow(0x4ade80));
  arrow.position.set(0, 1.28, -.12); g.add(arrow);
  const psiL = makeLabel(`${psi} PSI MÁX`, '#4ade80', .0065); psiL.position.set(0, 1.62, 0); g.add(psiL);

  const bCap = new THREE.Mesh(new THREE.CylinderGeometry(.43, .4, .16, 40), MAT.blackPl());
  bCap.position.y = -.68; g.add(bCap);
  const inlet = new THREE.Mesh(new THREE.CylinderGeometry(.09, .09, .2, 12), MAT.blackPl());
  inlet.position.set(.12, -.82, 0); inlet.userData.name = 'Entrada de combustible'; g.add(inlet); hoverables.push(inlet);
  const strainer = new THREE.Mesh(new THREE.SphereGeometry(.36, 22, 14), MAT.whitePl());
  strainer.scale.set(1.15, .28, .7); strainer.position.set(.18, -.98, 0);
  strainer.userData.name = 'Cedazo (pre-filtro de tela)'; g.add(strainer); hoverables.push(strainer);
  const inArrow = new THREE.Mesh(new THREE.ConeGeometry(.06, .14, 12), MAT.glow(0x22d3ee));
  inArrow.position.set(.18, -1.12, 0); inArrow.rotation.x = Math.PI; g.add(inArrow);

  blueprint(g);
  v.ticks.push(t => {
    arrow.position.y = 1.28 + Math.sin(t * 4) * .045;
    inArrow.position.y = -1.12 + Math.sin(t * 4) * .045;
  });
  enableHover(v, hoverables);
  return v.dispose;
}

window.FT3D = { car, module: module_, pump };
window.dispatchEvent(new Event('ft3d-ready'));
