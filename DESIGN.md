# Design System: FuelTech Master
**Stack:** React 18 (UMD) + htm, sin build step. CSS inline en `public/index.html`. JS en `public/app.js`, `public/fx.js`, `public/three3d.js`.

## 1. Visual Theme & Atmosphere
Panel de instrumentos de taller mecánico, no un dashboard SaaS genérico. La sensación buscada es **técnica, densa y de precisión** — como la pantalla de un scanner OBD-II o un catálogo de refacciones profesional, no una app de consumo. Rasgos que sostienen esa atmósfera:
- Fondo casi negro (#0D1117) con viñetas radiales sutiles en rojo y gris-azulado, más una capa de ruido (`feTurbulence` al 4% de opacidad) que da textura de "metal cepillado" en vez de un flat-design plano.
- Esquinas de los paneles cortadas en diagonal (`clip-path` biselado), evocando chapa metálica troquelada — un guiño deliberado a la industria automotriz, no una elección puramente decorativa.
- Tipografía condensada en mayúsculas con tracking amplio para etiquetas (letter-spacing 1–4px), como rotulación de instrumental técnico.
- Densidad alta: mucha información por pantalla (specs, PSI, conectores, flujo), priorizando velocidad de consulta en taller sobre "aire" visual.

**Público objetivo:** mecánicos y técnicos automotrices en México consultando specs bajo presión de tiempo, a menudo en talleres con luz ambiental fuerte — de ahí el alto contraste y los tamaños de fuente legibles a distancia de brazo.

## 2. Color Palette & Roles

| Nombre descriptivo | Hex / valor | Rol funcional |
|---|---|---|
| Negro Grafito Profundo | `#0D1117` | Fondo base de toda la app (`--bg`) |
| Panel Acero Translúcido | `rgba(27,35,45,.82)` | Fondo de tarjetas y paneles (`--panel`) |
| Panel Acero Elevado | `rgba(35,44,56,.9)` | Fondo hover/estado activo de tarjetas (`--panel2`) |
| Borde Grafito | `rgba(74,85,98,.35)` | Bordes por defecto (`--border`) |
| Borde Grafito Marcado | `rgba(74,85,98,.65)` | Bordes hover / alto contraste (`--border-hi`) |
| Blanco Hueso | `#E5E7EB` | Texto principal (`--text`) |
| Gris Plata Apagado | `#979EA7` | Texto secundario / metadatos (`--muted`) |
| Gris Plata Legible | `#B7BFC9` | Texto secundario sobre tarjetas oscuras (ligeramente más claro que `--muted` por contraste en talleres muy iluminados) |
| **Rojo Combustible** | `#E53935` | Color de marca y acento primario: alertas, títulos de sección, estado activo, botones primarios (`--red`) |
| Rojo Combustible Tenue | `rgba(229,57,53,.4)` | Bordes/glow de acento (`--red-dim`) |
| **Ámbar Advertencia** | `#F0B429` | Reservado exclusivamente para "dato estimado / sin verificar" — deliberadamente distinto del rojo para no confundir advertencia de dato con alerta del sistema de inyección (`--amber`) |
| Ámbar Tenue | `rgba(240,180,41,.45)` | Bordes de badges ámbar (`--amber-dim`) |

**Regla semántica clave:** rojo = marca / acción / alerta de sistema; ámbar = incertidumbre de datos. No deben intercambiarse.

## 3. Typography Rules
- **Familia única:** Montserrat (400/500/600/700/800), sans-serif de trazo geométrico — refuerza el carácter técnico/industrial.
- **Jerarquía por peso + tracking, no por familia distinta:**
  - Etiquetas de sección (`h2` de panel, headers de filtro): 700–800, 10–14px, mayúsculas, tracking 2–3px, color rojo.
  - Datos críticos (PSI grande, `.bignum`): 800, 22–30px, color texto principal — es el número que el técnico busca primero.
  - Cuerpo / valores de spec (`.kv dd`): 500, 13.5px, peso normal.
  - Metadatos (años, motor, conteos): 500–600, 10.5–12px, `--muted`.
- **Mayúsculas + letter-spacing amplio** se usa consistentemente como marcador de "esto es una etiqueta técnica, no prosa" (badges, chips, botones secundarios, subtítulo de marca).
- Tamaño base de body: 14.5px/1.55 — cómodo para lectura de tablas de specs, no denso al punto de fatigar.

## 4. Component Stylings

* **`.panel` (contenedor primario):** Fondo Panel Acero Translúcido con `backdrop-filter: blur(6px)`, borde Grafito 1px, esquina superior-izquierda biselada vía `clip-path` (14px), y una línea de degradado rojo→transparente pegada al borde superior (`::before`) que actúa como "luz de borde" sutil. El `h2` interno lleva una línea horizontal que se extiende hasta el borde derecho, dando efecto de rótulo con subrayado técnico.
* **`.badge` (tipo de inyección):** Rectangular (border-radius 2px, casi recto), borde 1px + fondo tintado al 7–12%. Variante neutra (MFI) en gris; variantes TBI/VORTEC/GDI en rojo; variante `unverified` en ámbar — coherente con la regla semántica de color.
* **`.chip` (OEM vs. alternativa):** Igual construcción que badge pero más compacto (padding 2px 8px); OEM en rojo, alterna en gris-muted.
* **`.result-item` (tarjeta de resultado de búsqueda):** Tarjeta angosta (190px) con `border-top: 3px solid transparent` que se llena de rojo solo en estado `.active` — el indicador de selección vive en el borde superior, no en el fondo, manteniendo la tarjeta legible. Es un `<button>` real (accesible por teclado, `:focus-visible` con outline rojo).
* **`.filters` (inputs de búsqueda):** Fondo casi negro (`rgba(7,11,17,.7)`) contrastando con el panel que los contiene, borde Grafito, radio casi recto (2px). Foco: borde rojo + halo `box-shadow` rojo al 12% — sin cambiar el radio ni el layout, minimizando "salto" visual al enfocar.
* **`.alert` (nota / advertencia contextual):** Barra de acento izquierda de 3px (roja por defecto, gris-azulada en variante `.blue` para notas informativas no críticas) sobre fondo tintado — patrón de "callout" consistente en toda la ficha técnica.
* **`.v3d` (visor 3D):** Fondo con gradiente radial oscuro propio (más oscuro que el panel que lo contiene) para que el modelo 3D "flote" con profundidad; controles superpuestos (botón de reset, tooltip de zona) en posición absoluta con el mismo lenguaje de botón rojo con gradiente y sombra que el resto de acciones primarias.
* **Botones primarios (`.v3d-btn`):** Gradiente rojo diagonal (145deg) + sombra de color rojo — el único lugar donde se usa gradiente y sombra coloreada, reservado para la acción 3D más "juguetona" de la interfaz.
* **Botones secundarios (`.filters button`, `.empty-state button`):** Transparentes con borde, texto muted/rojo — deliberadamente de menor peso visual que el contenido de la ficha, ya que la búsqueda ya es reactiva (viven para no competir por atención).

## 5. Layout Principles
- **Split fijo de dos columnas** (`app-shell`): panel de filtros a la izquierda (480px, `position: sticky`, altura completa de viewport) + panel de contenido a la derecha que scrollea independientemente. El filtro nunca se pierde de vista mientras se revisan resultados — prioridad de flujo: filtrar → ver resultados → ver ficha, todo sin navegación de página.
- **Franja de resultados sticky** dentro del panel de contenido: queda fija arriba al hacer scroll de la ficha técnica larga, para poder cambiar de vehículo sin volver arriba.
- **Grid de 2 columnas (`.grid2`)** para pares de paneles relacionados (ubicación del módulo + specs del módulo; pilas compatibles), colapsando a 1 columna en `≤900px`.
- **Breakpoints:** 1240px (el panel de filtros se angosta a 380px y sus campos pasan a 1 columna) y 900px (el layout completo pasa a columna única, apilando filtros arriba del contenido).
- **Espaciado:** paddings de panel generosos (22–36px) comparados con gaps internos ajustados (5–20px) — el "aire" se reserva para el borde exterior de cada bloque, no para el interior, manteniendo alta densidad de datos sin sentirse apretado.
