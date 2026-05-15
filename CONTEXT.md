# CPK VITROX — Project Context

> Documento maestro del proyecto. Léelo completo antes de hacer cambios.
> Cualquier IA (Claude, Cursor, Copilot) que asista en este código DEBE leer este archivo primero.

---

## 1. Qué es esto

**CPK VITROX** es una webapp que automatiza el cálculo de capacidad de máquina (Cm/Cmk) para máquinas de inspección por rayos X **ViTrox V810i** (familia AXI — Automated X-ray Inspection) usadas en líneas de manufactura SMT.

Reemplaza un proceso manual donde un ingeniero descargaba archivos `.log` de la máquina, los abría en Excel uno por uno, calculaba σ/µ/USL/LSL/Cmk con fórmulas, y armaba un reporte. Ahora se hace en 5 segundos: cargas la carpeta, ves los gráficos, descargas el PDF.

**Usuario final:** ingenieros de servicio de SMT (la empresa). El usuario principal es **Benjamin Favela**, ingeniero de campo.

**Deploy en producción:**
- GitHub Pages: `https://benjaminfavelacontacto-max.github.io/cpk-v2.0/`
- Vercel (alterno): `https://smto-cm-cmk.vercel.app/`
- Repo: `https://github.com/benjaminfavelacontacto-max/cpk-v2.0`

---

## 2. Stack y filosofía técnica

- **Vanilla JS / HTML / CSS** — sin frameworks, sin build step, sin npm
- Se sirve estático desde GitHub Pages o Vercel
- Chart.js + chartjs-plugin-annotation por CDN
- Fonts: Manrope + JetBrains Mono por Google Fonts
- Todo el procesamiento sucede en el navegador (no hay backend)
- Los archivos `.log` nunca salen del dispositivo del usuario

**Por qué vanilla:** El usuario despliega editando archivos por la UI web de GitHub. Cualquier build step (Vite, Next, etc.) le rompería el flujo. Mantenlo así.

---

## 3. Estructura del repo

```
/
├── index.html              # Página principal, ruta raíz
├── css/
│   └── styles.css          # Todo el CSS, un solo archivo
├── js/
│   ├── cpk.js              # Motor de datos: parser, σ, Cm/Cmk (lógica PURA, sin DOM)
│   └── app.js              # Controlador UI: render, charts, loader, PDF
├── assets/
│   └── SMTLogo.png         # Logo (si falta, fallback a div con texto "SMT")
├── Sources/CPKVitrox/      # Código Swift original (macOS app) — NO TOCAR
│   ├── CPKVitroxApp.swift
│   ├── Models.swift
│   ├── ContentView.swift
│   ├── CPKChartView.swift
│   ├── LogParser.swift
│   └── Statistics.swift
├── Package.swift           # SPM config del proyecto macOS
├── CONTEXT.md              # Este archivo
└── README.md
```

**Regla:** `Sources/` y `Package.swift` son del proyecto macOS legacy. **No los modifiques.** Cualquier cambio va solo en `index.html`, `css/styles.css`, `js/cpk.js`, `js/app.js`.

---

## 4. Lógica de negocio — Lo más importante

### 4.1 Metodología Cm/Cmk con límites dinámicos ±6σ

El cálculo NO usa límites fijos de planta. Los límites se calculan dinámicamente a partir de los datos según el método del Excel de RnR del cliente:

```
σ  = STDEV.P(valores)         # poblacional, N en denominador
µ  = AVERAGE(valores)
USL = µ + 6σ
LSL = µ − 6σ
Cm  = (USL − LSL) / (6σ)     = 2.0 por definición
Cmk = MIN((USL − µ)/3σ, (µ − LSL)/3σ)
```

**Implicación matemática:** con límites dinámicos a ±6σ, Cm siempre da 2.0. Cmk solo baja de 2.0 si hay asimetría en la distribución (lo cual con USL/LSL calculados desde la propia media nunca pasa exactamente, pero puede haber redondeos). En la práctica casi siempre verás Cm=Cmk=2.0 con datos limpios.

**Por qué importa:** El cliente exige esta metodología. **No la cambies por límites fijos de planta** aunque te lo pidan informalmente. Si alguien sugiere usar límites fijos, dirígelo de regreso al archivo `RnR.xlsx` que vive en el proyecto.

**Importante para nomenclatura:**
- En código (`cpk.js`, `app.js`): se llaman `cp` y `cpk` (legacy histórico)
- En la UI visible: se muestran como `Cm` y `Cmk`
- En el PDF: se muestran como `Cm` y `Cmk`, título "CM/CMK VITROX Report"
- En este archivo y en docs: Cm/Cmk

### 4.2 Statuses por valor de Cmk

| Cmk | Status | Color |
|---|---|---|
| ≥ 2.00 | Excellent | verde brillante `#22c55e` |
| ≥ 1.67 | Optimal | cyan `#67e8f9` (texto cyan oscuro) |
| ≥ 1.33 | Good | verde claro `#bbf7d0` |
| ≥ 1.00 | Acceptable | amarillo `#fde047` |
| ≥ 0.67 | Bad | naranja `#f97316` |
| < 0.67 | Terrible | rojo `#dc2626` |
| Infinity (σ=0) | Excellent | verde |
| N/A (sin datos) | — | gris |

---

## 5. Formato de los archivos .log

Generados por la máquina ViTrox V810i. Ejemplo real:

```
03/10/2026 5:36:15 AM
X-ray Spot Adjustment
,Camera,FiducialFound,MatchQuality,...,ImageFileName,...,NewLocationX(nm),NewLocationY(nm),OldLocationX(nm),OldLocationY(nm),
,Camera 0,true,0.93...,cam_0_M19_Bin3.png,...,395440356,769674913,...
```

**Estructura:**
1. Línea 1: timestamp
2. Línea 2: tipo de ajuste (`X-ray Spot Adjustment` o `High Mag X-ray Spot Adjustment`)
3. Línea de header con `NewLocationX(nm)` y `NewLocationY(nm)`
4. Una o más líneas de datos

### 5.1 Reglas de parseo CRÍTICAS

- **Detección de columnas dinámica:** El parser busca la línea que contenga AMBOS `NewLocationX(nm)` y `NewLocationY(nm)`, hace `split(',')`, y obtiene los índices vía `indexOf`. **Nunca uses índices hardcodeados** porque el formato puede tener columnas extra entre versiones del firmware.
- **Encoding:** UTF-8 estándar.
- **Valores en nanómetros (nm):** X ronda los 395,000,000 nm (395 mm). Y ronda los 769,000,000 nm. Usa siempre `Number` (64-bit IEEE 754) — no truncar ni redondear.

### 5.2 Detección de magnificación

La magnificación se extrae del campo `ImageFileName` con esta regex:

```js
/[_/]M(\d+(?:_\d+)?)[_\.]/i
```

Ejemplos:
- `cam_0_M19_Bin3.png` → M19
- `cam_high_0_M11_Bin3.png` → M11
- `cam_0_M10_5_Bin3.png` → M10_5 (decimal con underscore)
- `cam_0_M6_Bin3.png` → M6

**Fallback:** si no hay `ImageFileName`, busca `highMag` en el nombre del archivo `.log` → asume M11.

### 5.3 Magnificaciones soportadas

| Código | Label visible | Modelos AXI |
|---|---|---|
| M6 | 6µm | S2EX, XLT, XXL, XLW |
| M10_5 | 10.5µm | S2EX, XLT, XXL, XLW |
| M11 | High Mag (M11) | S2, S2EX, XLT, XXL, XLW |
| M15 | Low Mag (M15) | XLT, XXL, XLW |
| M19 | Low Mag (M19) | S2, S2EX, XLT, XXL, XLW |
| M23 | 23µm | S2EX, XLT, XXL, XLW |

Catálogo completo en `cpk.js` → `MAGNIFICATION_CATALOG`.

### 5.4 Modelos AXI soportados

`V810i S2`, `V810i S2EX`, `V810i XLT`, `V810i XXL`, `V810i XLW` — son las 5 opciones del dropdown del PDF modal.

---

## 6. Arquitectura del código

### 6.1 `cpk.js` — Motor (sin DOM)

Lógica pura, testeable, expuesta como `window.CPK`. Funciones principales:

```js
CPK.detectMagnification(imageFileName)          → 'M19' | 'M11' | null
CPK.parseLogFile(filename, content)             → { filename, timestamp, magnification, entries }
CPK.populationStdDev(values)                    → number   // N denominador
CPK.mean(values)                                → number
CPK.calculateCpkAxis(values)                    → { sigma, mu, usl, lsl, cp, cpu, cpl, cpk, n }
CPK.getCpkStatus(cpk)                           → { label, color, tier }
CPK.processLogFiles([{filename, content}, ...]) → [resultPerMag]
```

**Edge case importante:** si σ=0 (todos los valores idénticos) o n=1, `calculateCpkAxis` retorna `{ sigma:0, usl:mu, lsl:mu, cp:Infinity, cpk:Infinity, n }`. `getCpkStatus(Infinity)` retorna `Excellent`. Esto es a propósito — no romper la app por un edge case válido.

### 6.2 `app.js` — Controlador UI

Estado global (no usa frameworks):

```js
let cpkResults = [];      // [{ magnification, label, x, y, cpk, status, ... }]
let rawFiles   = [];      // [{ filename, content }]
let selectedMag = null;   // 'M11' | 'M19' | ...
let charts = {};          // { 'M11': Chart, 'M19': Chart, ... }
```

Funciones de render principales:
- `render()` — entry point, toggleea empty/main y dispara los demás renders
- `renderTabs()` — barra de magnificaciones detectadas
- `renderTable(data)` — tabla de archivos
- `renderStatsCards(result)` — cards de Cm/Cmk por eje
- `renderCharts(result)` — Chart.js line charts con USL/LSL/Mean

Funciones del file loader:
- `loadFilesWithUI(files)` — entry async, multi-fase
- `showFileLoader()`, `hideFileLoader()`
- `setLoaderPhase(phase, {title, subtitle})` — phase ∈ {scanning, processing, analyzing, complete, error}
- `setLoaderProgress(current, total)`
- `updateLoaderStats({loaded, skipped, mags, samples})`
- `setLoaderActivity(filename)`

Funciones del PDF:
- `openPDFModal()`, `closePDFModal()`, `generatePDF()`
- `buildLightChartPNG(values, lsl, usl, label)` — render chart offscreen en tema claro
- `buildReportHTML(info, charts, logoDataURL)` — HTML completo del reporte

### 6.3 Helpers críticos

`fmtNum(val, decimals)` — formatea números considerando `Infinity` (→ `∞`), `NaN` y `null` (→ `—`). Úsala SIEMPRE para mostrar valores estadísticos en la UI o el PDF.

---

## 7. UI / Diseño (v2.7 — "Industrial Intelligence System")

### 7.1 Dirección estética

Cabina de máquina X-ray industrial × Apple Vision Pro × Tesla precision × HUD cinemático sci-fi. **No usar:**
- Inter, Roboto, Arial (fonts genéricos de AI slop)
- Gradientes morados sobre blanco
- Cualquier cosa que parezca "AI-generated startup landing"

### 7.2 Tokens de diseño (en `:root`)

```css
/* Negros con tinte azul, NUNCA #000 puro */
--bg-0: #050810;   --bg-1: #0a0f1c;   --bg-2: #111827;
--bg-3: #1a2233;   --bg-4: #2a3447;

/* Paleta firma: cyan eléctrico + azul Tesla + indigo */
--cyan:   #00d4ff;   --blue:   #0a84ff;   --indigo: #5e5ce6;
--green:  #30d158;   --red:    #ff453a;   --orange: #ff9f0a;

/* Tipografía */
--font-display: 'Manrope', system-ui, sans-serif;
--font-mono:    'JetBrains Mono', monospace;
```

### 7.3 Capas de fondo (siempre activas)

`.app-bg` es `position: fixed` z-index 0:
- `.app-bg-grid` — grid sutil drift 60s
- `.app-bg-glow--cyan` y `.app-bg-glow--indigo` — radial gradients flotando 18s
- `.app-bg-scan` — línea horizontal scan 14s

Todo `#topbar`, `#empty-state`, `#main-content` van con `z-index: 1`.

### 7.4 Empty state — HUD hero

Estructura:
- 4 `.hud-corner` en esquinas (brackets `[ ]` con fade-in escalonado)
- `.hud-readout--left` con SYSTEM/METHOD/UPTIME
- `.hud-readout--right` con DETECTOR/CHANNELS/FORMAT
- `.hero-card` glassmorphism premium con borde gradient (`::before` + mask-composite)
- `.hero-icon` SVG animado: 2 anillos rotando opuestos, crosshair, 6 data dots flickering, core pulsante con halo
- `.hero-eyebrow` `[ AWAITING INPUT ]` con glow pulsante
- `.hero-title` 42px Manrope 800 con gradient text white→cyan
- `.hero-cta` con gradient animado cyan→blue→indigo (6s cycle), arrow desplaza en hover
- `.hero-specs` strip con 6/5/±6σ/AUTO
- `.hud-footer` floating chip con info del sistema

**Bug histórico arreglado:** El `.hero-title` con `background-clip: text` cortaba descendentes (g, j, p, q) si `line-height < 1.15`. Fix actual: `line-height: 1.15`, `padding-bottom: 12px`, `overflow: visible`. **No bajes el line-height por estética sin probar palabras con descendentes.**

### 7.5 File loader (v2.7) — 4 fases animadas

`#file-loader` full-screen, glassmorphism:

1. **SCANNING** (~500ms) — anillos girando, "Detectados N archivos · Buscando .log"
2. **PROCESSING** — progress bar con shimmer, contador `X / Y`, stats live (LOADED/SKIPPED/MAGS/SAMPLES), `CURRENT › <filename>`
3. **ANALYZING** (~500ms) — corre `CPK.processLogFiles()`, popula MAGS/SAMPLES
4. **COMPLETE** (~1.6s) — icono pausa anillos, dibuja checkmark verde con `stroke-dasharray` animation, halo verde, título "Análisis Completo"

Yield de `15ms` cada 3 archivos para que la animación se vea fluida incluso con cientos de archivos.

### 7.6 Loader simple (PDF)

`#loading-overlay` legacy — solo spinner + texto. Se usa SOLO para PDF ("Renderizando gráficas…", "Abriendo reporte…"). No confundir con `#file-loader`.

---

## 8. Generación de PDF

Click "Descargar PDF" → modal con form (fecha, customer, modelo, S/N, ingeniero) → `generatePDF()`:

1. Renderiza un Chart.js en tema CLARO offscreen para cada magnificación (X e Y) → PNG data URL
2. Convierte el logo `<img>` a data URL vía canvas
3. Construye un HTML completo con todo el reporte (header, customer info, secciones por mag, criterios, charts page)
4. Abre una nueva ventana, le inyecta el HTML, dispara `window.print()`

**El usuario imprime/guarda como PDF desde el diálogo nativo del navegador.** No usamos jsPDF ni librerías de PDF — sale más limpio y respeta el zoom del navegador.

**Bug crítico arreglado (v2.7):** Había DOS disparadores de `print()` (uno en `onload`, otro como fallback a 1500ms). Sin guard, ambos disparaban → 2 diálogos de descarga. Fix: flag `printed` compartido:

```js
let printed = false;
const triggerPrint = () => {
    if (printed || !repWin || repWin.closed) return;
    printed = true;
    repWin.focus();
    repWin.print();
};
repWin.onload = () => setTimeout(triggerPrint, 400);
setTimeout(triggerPrint, 1500);
```

**Color en PDF:** Chrome al imprimir descarta `background-color` pero respeta `background-image`. Por eso en el HTML del reporte los fondos de las celdas de status usan `background-image: linear-gradient(color, color)` en vez de `background-color: color`. **No lo "limpies"** o se pierde el color en el PDF.

**Nomenclatura en PDF:**
- Título: "CM/CMK VITROX Report"
- Labels de filas: "Cm" y "Cmk" (no Cp/Cpk)
- Tabla de referencia: "CM/CMK Reference"
- Footer: "CM/CMK VITROX — {customer} — {date}"

---

## 9. Historial de versiones

| Ver | Cambio principal |
|---|---|
| v2.0 | Rewrite multi-mag con límites dinámicos ±6σ (vs límites fijos de planta del v1) |
| v2.1 | Soporte M6, M10_5, M23 además de M11/M15/M19 |
| v2.2 | Fix sigma=0 / n=1 retornan Infinity en vez de null (la app se quedaba en empty state) |
| v2.3 | Machine Model como dropdown en PDF modal |
| v2.4 | PDF: Cp/Cpk → Cm/Cmk en labels |
| v2.5 | PDF: título "CPK VITROX Report" → "CM/CMK VITROX Report" |
| v2.6 | UI redesign completo: "Industrial Intelligence System" — HUD, glassmorphism, animaciones |
| v2.7 | File loader animado multi-fase + fix print() duplicado en PDF |

El badge `BUILD X.Y` en el topbar refleja la versión actual. **Incrementa con cada cambio significativo** para que el usuario sepa cuál versión está viendo desplegada (útil contra cache).

---

## 10. Deploy y debugging

### 10.1 Flujo de deploy del usuario

El usuario **no usa git CLI**. Sube cambios por la UI web de GitHub:
1. Abre el archivo en github.com/benjaminfavelacontacto-max/cpk-v2.0
2. Click "Edit" (lápiz)
3. Pega el contenido nuevo COMPLETO (no parches)
4. "Commit changes"

**Cuidado:** cuando reemplazas un archivo grande, asegúrate de pegar el archivo ENTERO. Una vez perdió todos los estilos por pegar solo un parche.

### 10.2 GitHub Pages cache

- Deploy tarda **~2 minutos** después del commit
- Brave/Chrome cachean CSS/JS agresivamente
- Para verificar que el archivo desplegado es el nuevo:
  ```
  https://benjaminfavelacontacto-max.github.io/cpk-v2.0/css/styles.css
  ```
  (abrir directamente, buscar la regla específica del cambio)
- Para forzar carga fresca en la app: DevTools → click derecho recargar → **"Empty Cache and Hard Reload"**

### 10.3 Vercel (mirror)

Existe deploy en Vercel en `smto-cm-cmk.vercel.app`. **Restricción de naming de Vercel:** solo lowercase, hyphens, sin underscores. Por eso el proyecto se llama `smto-cm-cmk` y NO `cpk_v2_0`.

### 10.4 Estilo de comunicación del usuario

- Español (México), tono casual
- Limitado con git/CLI — usa GitHub web UI o me pide los archivos completos
- Prefiere screenshots a descripciones de texto
- Cuando pide cambios visuales: hazlos y entrégale los archivos listos para subir, no le pidas que aplique parches manualmente

---

## 11. Reglas para futuras IAs trabajando este código

1. **Antes de cambiar matemática:** lee `RnR.xlsx` del proyecto y confirma que coincide. La fórmula es σ poblacional (N denominador), límites ±6σ dinámicos. Punto.
2. **Antes de cambiar el parser:** asegúrate que sigue siendo dinámico (busca header por nombre, nunca por índice).
3. **Antes de tocar el PDF:** recuerda que Chrome strip-ea `background-color` al imprimir. Usa `background-image: linear-gradient(c,c)` para fondos de celda.
4. **Antes de tocar el loader:** hay DOS — `#file-loader` (carga de archivos) y `#loading-overlay` (PDF). No los confundas.
5. **No introduzcas build steps.** Vanilla JS estático. Si necesitas TypeScript, dilo en chat — no metas `tsc`/`vite` sin acuerdo explícito.
6. **No uses Inter/Roboto/Arial.** El proyecto usa Manrope + JetBrains Mono por diseño consciente. Si propones cambiar font, justifícalo.
7. **Sube el version badge** en `index.html` con cada cambio significativo. El usuario lo usa para saber si el deploy llegó.
8. **Mantén `Sources/` intacto.** Es el proyecto macOS legacy. No le metas mano aunque parezca abandonado.
9. **Maneja Infinity y NaN explícitamente.** σ puede ser 0. Cmk puede ser Infinity. Usa el helper `fmtNum()` para display.
10. **Lee este archivo PRIMERO en cada sesión nueva.** Si el usuario empieza con "ayúdame con X" y no has leído CONTEXT.md, léelo.

---

## 12. Roadmap / ideas no implementadas

(Por si surge la pregunta — son ideas en mesa pero no priorizadas.)

- Comparar múltiples cargas/clientes en el mismo dashboard
- Exportar a Excel además de PDF
- Histórico de mediciones por máquina (necesitaría backend o IndexedDB)
- Modo presentación / pantalla completa para mostrar al cliente
- Auto-detect del modelo AXI desde el log (algunas magnificaciones acotan posibilidades)
- Plantilla de email con el resumen para enviar al cliente

No las implementes hasta que el usuario las pida explícitamente.

---

## 13. Contacto y contexto humano

- Usuario / dueño: **Benjamin Favela** — ingeniero de servicio SMT, basado en México
- Empresa: SMT (representante de ViTrox en LatAm)
- Cliente representativo: Benchmark Tijuana (aparece como placeholder en el PDF modal)

Este proyecto le ahorra **~30 min por máquina** en visitas de servicio. Multiplicado por ~10 visitas por mes = ~5 horas. Vale la pena cuidarlo.

---

*Última actualización del documento: v2.7 — Mayo 2026*
