# Design System: FuelTech Master
**Stack:** React 18 (UMD) + htm, sin build step. CSS inline en `public/index.html`. JS en `public/app.js`, `public/fx.js`, `public/three3d.js`.

## 1. Visual Theme & Atmosphere
Panel de instrumentos de taller mecánico, no un dashboard SaaS genérico. La sensación buscada es **técnica, densa y de precisión** — como la pantalla de un scanner OBD-II o un catálogo de refacciones profesional, no una app de consumo. Rasgos que sostienen esa atmósfera:
- Fondo casi negro (#0F1113) con viñetas radiales sutiles en lima y gris neutro, más una capa de ruido (`feTurbulence` al 4% de opacidad) que da textura de "metal cepillado" en vez de un flat-design plano.
- Esquinas de los paneles cortadas en diagonal (`clip-path` biselado), evocando chapa metálica troquelada — un guiño deliberado a la industria automotriz, no una elección puramente decorativa.
- Tipografía condensada en mayúsculas con tracking amplio para etiquetas (letter-spacing 1–4px), como rotulación de instrumental técnico.
- Densidad alta: mucha información por pantalla (specs, PSI, conectores, flujo), priorizando velocidad de consulta en taller sobre "aire" visual.

**Público objetivo:** mecánicos y técnicos automotrices en México consultando specs bajo presión de tiempo, a menudo en talleres con luz ambiental fuerte — de ahí el alto contraste y los tamaños de fuente legibles a distancia de brazo.

## 2. Color Palette & Roles

Los valores de la tabla son los del **modo oscuro** (el tema por defecto). El modo claro
redefine los mismos tokens dentro de `@media (prefers-color-scheme: light)`.

| Nombre descriptivo | Hex / valor | Rol funcional |
|---|---|---|
| Negro Grafito Profundo | `#0F1113` | Fondo base de toda la app (`--bg`) |
| Panel Grafito Translúcido | `rgba(26,30,33,.82)` | Fondo de tarjetas y paneles (`--panel`) |
| Panel Grafito Elevado | `rgba(36,41,45,.9)` | Fondo hover/estado activo de tarjetas (`--panel2`) |
| Borde Grafito | `rgba(126,133,138,.3)` | Bordes por defecto (`--border`) |
| Borde Grafito Marcado | `rgba(126,133,138,.6)` | Bordes hover / alto contraste (`--border-hi`) |
| Blanco Hueso | `#E8EAE6` | Texto principal (`--text`) |
| Gris Piedra Apagado | `#969C99` | Texto secundario / metadatos (`--muted`) |
| Gris Piedra Legible | `#BFC5BE` | Texto secundario sobre tarjetas oscuras (ligeramente más claro que `--muted` por contraste en talleres muy iluminados) (`--text-alt`) |
| **Lima FuelTech** | `#AECC3A` | Color de marca y acento primario: títulos de sección, estado activo, enlaces, botones primarios (`--accent`, alias heredado `--red`) |
| Lima Brillante | `#C2DE4C` | Extremo claro de gradientes y hover (`--accent-strong`) |
| Lima Tenue | `rgba(174,204,58,.42)` | Bordes/glow de acento (`--accent-dim`, alias `--red-dim`) |
| Tinta sobre Lima | `#101310` | Texto/iconos encima de un relleno lima sólido (`--accent-ink`) |
| **Ámbar Advertencia** | `#F0B429` | Advertencias: "dato estimado / sin verificar", notas de montaje, "requiere bajar el tanque" (`--amber`) |
| Ámbar Tenue | `rgba(240,180,41,.45)` | Bordes de badges y alertas ámbar (`--amber-dim`) |

**Regla semántica clave:** lima = marca / acción / dato confirmado; ámbar = incertidumbre,
advertencia o trabajo extra. No deben intercambiarse — por eso `.alert` y `.tank-flag.drop`
son ámbar y no lima, aunque antes de la identidad lima fueran rojos.

**Lima fijo vs. lima adaptado.** El lima de marca no alcanza 4.5:1 sobre blanco, así que en
modo claro `--accent` se oscurece a un oliva (`#55700D`) **solo para texto y bordes**. Los
rellenos sólidos (FAB del chat, botón del visor 3D, botón de enviar, skip-link) usan
`--accent-fill`, que se mantiene en `#AECC3A` en ambos temas porque siempre lleva
`--accent-ink` encima (~11:1). Si un relleno nuevo usara `--accent` en vez de
`--accent-fill`, en modo claro quedaría tinta oscura sobre oliva oscuro.

## 2b. Logotipo
Dos PNG en `public/brand/`, tomados del manual de marca: `logo-dark.png` (lockup blanco+lima,
para fondo grafito) y `logo-light.png` (lockup gris+lima, para fondo claro), más los isotipos
sueltos `mark-dark.png` / `mark-light.png` y los iconos PWA derivados de ellos.

Cuál se muestra lo decide **CSS, no JS**: las clases `.on-dark` / `.on-light` leen los tokens
`--logo-dark` / `--logo-light` (`block` / `none`), que el media query invierte. Así el
logotipo correcto ya está en el primer pintado, sin parpadeo ni dependencia de JavaScript —
importante porque las páginas SSR (guías, legales, fichas) también lo usan y allí la app
React no llega a arrancar.

## 3. Typography Rules
- **Familia única:** Montserrat (400/500/600/700/800), sans-serif de trazo geométrico — refuerza el carácter técnico/industrial.
- **Jerarquía por peso + tracking, no por familia distinta:**
  - Etiquetas de sección (`h2` de panel, headers de filtro): 700–800, 10–14px, mayúsculas, tracking 2–3px, color lima.
  - Datos críticos (PSI grande, `.bignum`): 800, 22–30px, color texto principal — es el número que el técnico busca primero.
  - Cuerpo / valores de spec (`.kv dd`): 500, 13.5px, peso normal.
  - Metadatos (años, motor, conteos): 500–600, 10.5–12px, `--muted`.
- **Mayúsculas + letter-spacing amplio** se usa consistentemente como marcador de "esto es una etiqueta técnica, no prosa" (badges, chips, botones secundarios, subtítulo de marca).
- Tamaño base de body: 14.5px/1.55 — cómodo para lectura de tablas de specs, no denso al punto de fatigar.

## 4. Component Stylings

* **`.panel` (contenedor primario):** Fondo Panel Acero Translúcido con `backdrop-filter: blur(6px)`, borde Grafito 1px, esquina superior-izquierda biselada vía `clip-path` (14px), y una línea de degradado lima→transparente pegada al borde superior (`::before`) que actúa como "luz de borde" sutil. El `h2` interno lleva una línea horizontal que se extiende hasta el borde derecho, dando efecto de rótulo con subrayado técnico.
* **`.badge` (tipo de inyección):** Rectangular (border-radius 2px, casi recto), borde 1px + fondo tintado al 7–12%. Variante neutra (MFI) en gris; variantes TBI/VORTEC/GDI en lima; variante `unverified` en ámbar — coherente con la regla semántica de color.
* **`.chip` (OEM vs. alternativa):** Igual construcción que badge pero más compacto (padding 2px 8px); OEM en lima, alterna en gris-muted.
* **`.result-item` (tarjeta de resultado de búsqueda):** Tarjeta angosta (190px) con `border-top: 3px solid transparent` que se llena de lima solo en estado `.active` — el indicador de selección vive en el borde superior, no en el fondo, manteniendo la tarjeta legible. Es un `<button>` real (accesible por teclado, `:focus-visible` con outline lima).
* **`.filters` (inputs de búsqueda):** Fondo casi negro (`rgba(8,10,11,.7)`) contrastando con el panel que los contiene, borde Grafito, radio casi recto (2px). Foco: borde lima + halo `box-shadow` lima al 12% — sin cambiar el radio ni el layout, minimizando "salto" visual al enfocar.
* **`.alert` (nota / advertencia contextual):** Barra de acento izquierda de 3px (ámbar por defecto, gris neutro en variante `.blue` para notas informativas no críticas) sobre fondo tintado — patrón de "callout" consistente en toda la ficha técnica.
* **`.v3d` (visor 3D):** Fondo con gradiente radial oscuro propio (más oscuro que el panel que lo contiene) para que el modelo 3D "flote" con profundidad; controles superpuestos (botón de reset, tooltip de zona) en posición absoluta con el mismo lenguaje de botón lima con gradiente y sombra que el resto de acciones primarias.
* **Botones primarios (`.v3d-btn`):** Gradiente lima diagonal (145deg) + sombra de color lima — el único lugar donde se usa gradiente y sombra coloreada, reservado para la acción 3D más "juguetona" de la interfaz.
* **Botones secundarios (`.filters button`, `.empty-state button`):** Transparentes con borde, texto muted/lima — deliberadamente de menor peso visual que el contenido de la ficha, ya que la búsqueda ya es reactiva (viven para no competir por atención).

## 5. Layout Principles
- **Split fijo de dos columnas** (`app-shell`): panel de filtros a la izquierda (480px, `position: sticky`, altura completa de viewport) + panel de contenido a la derecha que scrollea independientemente. El filtro nunca se pierde de vista mientras se revisan resultados — prioridad de flujo: filtrar → ver resultados → ver ficha, todo sin navegación de página.
- **Franja de resultados sticky** dentro del panel de contenido: queda fija arriba al hacer scroll de la ficha técnica larga, para poder cambiar de vehículo sin volver arriba.
- **Grid de 2 columnas (`.grid2`)** para pares de paneles relacionados (ubicación del módulo + specs del módulo; pilas compatibles), colapsando a 1 columna en `≤900px`.
- **Breakpoints:** 1240px (el panel de filtros se angosta a 380px y sus campos pasan a 1 columna) y 900px (el layout completo pasa a columna única, apilando filtros arriba del contenido).
- **Espaciado:** paddings de panel generosos (22–36px) comparados con gaps internos ajustados (5–20px) — el "aire" se reserva para el borde exterior de cada bloque, no para el interior, manteniendo alta densidad de datos sin sentirse apretado.
