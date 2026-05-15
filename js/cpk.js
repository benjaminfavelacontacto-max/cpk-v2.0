// ============================================================
// cpk.js — Motor de datos CPK Vitrox v2.0
// Lógica pura: parser, estadísticas, detección de magnificación
// Sin dependencias de UI — compatible con todos los modelos AXI
// ============================================================

// ------------------------------------------------------------
// CATÁLOGO DE MAGNIFICACIONES
// Soporta: V810i S2, S2EX, XLT, XXL, XLW
// Los límites son DINÁMICOS (±6σ) — no hay hardcodes de planta
// ------------------------------------------------------------
const MAGNIFICATION_CATALOG = {
  M6:    { label: '6µm',           code: 'M6',    models: ['S2EX', 'XLT', 'XXL', 'XLW'] },
  M10_5: { label: '10.5µm',        code: 'M10_5', models: ['S2EX', 'XLT', 'XXL', 'XLW'] },
  M11:   { label: 'High Mag (M11)',code: 'M11',   models: ['S2', 'S2EX', 'XLT', 'XXL', 'XLW'] },
  M15:   { label: 'Low Mag (M15)', code: 'M15',   models: ['XLT', 'XXL', 'XLW'] },
  M19:   { label: 'Low Mag (M19)', code: 'M19',   models: ['S2', 'S2EX', 'XLT', 'XXL', 'XLW'] },
  M23:   { label: '23µm',          code: 'M23',   models: ['S2EX', 'XLT', 'XXL', 'XLW'] },
};

// Orden de visualización en la UI
const MAG_DISPLAY_ORDER = ['M6', 'M10_5', 'M11', 'M15', 'M19', 'M23'];

// ------------------------------------------------------------
// DETECCIÓN DE MAGNIFICACIÓN
// Extrae el código M del campo ImageFileName en el .log
// Patrón: cam_[high_]0_M{número[_decimal]}_Bin{n}.png
// Ejemplos: cam_0_M19_Bin3.png → M19
//           cam_high_0_M11_Bin3.png → M11
//           cam_0_M10_5_Bin3.png → M10_5
//           cam_0_M6_Bin3.png → M6
// ------------------------------------------------------------
function detectMagnification(imageFileName) {
  if (!imageFileName) return null;

  // Regex: captura M seguido de dígitos con separador _ opcional para decimales
  const match = imageFileName.match(/[_/]M(\d+(?:_\d+)?)[_\.]/i);
  if (!match) return null;

  const raw = match[1]; // ej. "19", "10_5", "11", "6", "23"
  const key = 'M' + raw; // ej. "M19", "M10_5"

  return MAGNIFICATION_CATALOG[key] ? key : null;
}

// Fallback: detecta por nombre del archivo .log si no hay ImageFileName
// highMagXrayspot → M11 | xrayspot → intenta M19/M15 según datos
function detectMagByFilename(filename) {
  if (!filename) return null;
  if (/highMag/i.test(filename)) return 'M11';
  return null; // No suficiente info en el nombre solo
}

// ------------------------------------------------------------
// PARSER DE ARCHIVOS .LOG
// Detecta dinámicamente las columnas NewLocationX(nm) y NewLocationY(nm)
// No usa índices fijos — compatible con cualquier versión del .log
// ------------------------------------------------------------
function parseLogFile(filename, content) {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length < 3) return null;

  const timestamp = lines[0];
  const adjustmentType = lines[1]; // ej. "High Mag X-ray Spot Adjustment"

  // Buscar la línea de encabezados (contiene "NewLocationX(nm)")
  let headerLine = null;
  let headerIndex = -1;
  for (let i = 2; i < lines.length; i++) {
    if (lines[i].includes('NewLocationX(nm)') && lines[i].includes('NewLocationY(nm)')) {
      headerLine = lines[i];
      headerIndex = i;
      break;
    }
  }
  if (!headerLine) return null;

  // Parsear encabezados → encontrar índices exactos
  const headers = headerLine.split(',').map(h => h.trim());
  const idxX    = headers.indexOf('NewLocationX(nm)');
  const idxY    = headers.indexOf('NewLocationY(nm)');
  const idxImg  = headers.indexOf('ImageFileName');
  const idxCam  = headers.indexOf('Camera');
  const idxFid  = headers.indexOf('FiducialFound');
  const idxQual = headers.indexOf('MatchQuality');

  if (idxX === -1 || idxY === -1) return null;

  // Parsear líneas de datos
  const entries = [];
  let detectedMag = null;

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length <= Math.max(idxX, idxY)) continue;

    const xVal = parseFloat(cols[idxX]);
    const yVal = parseFloat(cols[idxY]);
    if (isNaN(xVal) || isNaN(yVal)) continue;

    const imageFileName = idxImg >= 0 ? (cols[idxImg] || '').trim() : '';
    const camera        = idxCam  >= 0 ? (cols[idxCam]  || '').trim() : '';
    const fiducialFound = idxFid  >= 0 ? (cols[idxFid]  || '').trim() : '';
    const matchQuality  = idxQual >= 0 ? parseFloat(cols[idxQual]) : NaN;

    // Detectar magnificación a partir de ImageFileName (solo necesitamos 1 muestra)
    if (!detectedMag && imageFileName) {
      detectedMag = detectMagnification(imageFileName);
    }

    entries.push({ x: xVal, y: yVal, imageFileName, camera, fiducialFound, matchQuality });
  }

  if (entries.length === 0) return null;

  // Fallback de magnificación por nombre del archivo
  if (!detectedMag) {
    detectedMag = detectMagByFilename(filename);
  }

  return {
    filename,
    timestamp,
    adjustmentType,
    magnification: detectedMag,
    entries,
  };
}

// ------------------------------------------------------------
// ESTADÍSTICAS — DESVIACIÓN ESTÁNDAR POBLACIONAL
// σ = √( Σ(xi − µ)² / N )   ← N en denominador (poblacional)
// Consistente con STDEV.P de Excel
// ------------------------------------------------------------
function populationStdDev(values) {
  if (!values || values.length === 0) return 0;
  const n    = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n;
  return Math.sqrt(variance);
}

function mean(values) {
  if (!values || values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// ------------------------------------------------------------
// CÁLCULO CPK — LÍMITES DINÁMICOS ±6σ
//
// Paso 1: σ = STDEV.P(valores)
// Paso 2: µ = AVERAGE(valores)
// Paso 3: USL = µ + 6σ  |  LSL = µ − 6σ
// Paso 4: Cp  = (USL − LSL) / (6σ) = 12σ / 6σ = 2.0 (constante por diseño)
//         Cpk = MIN( (USL − µ) / (3σ),  (µ − LSL) / (3σ) )
//
// NOTA: Con límites ±6σ dinámicos el Cp siempre es 2.0.
//       El Cpk refleja el centrado: si los datos son perfectamente
//       simétricos = 2.0. Asimetría en lotes → Cpk < 2.0
// ------------------------------------------------------------
function calculateCpkAxis(values) {
  if (!values || values.length < 2) return null;

  const sigma = populationStdDev(values);
  const mu    = mean(values);

  if (sigma === 0) return null;

  const usl = mu + 6 * sigma;
  const lsl = mu - 6 * sigma;

  const cp  = (usl - lsl) / (6 * sigma);                    // = 2.0 por definición
  const cpu = (usl - mu)  / (3 * sigma);                    // Límite superior
  const cpl = (mu  - lsl) / (3 * sigma);                    // Límite inferior
  const cpk = Math.min(cpu, cpl);

  return { sigma, mu, usl, lsl, cp, cpu, cpl, cpk, n: values.length };
}

// ------------------------------------------------------------
// CLASIFICACIÓN POR ESTATUS
// ------------------------------------------------------------
function getCpkStatus(cpk) {
  if (cpk === null || isNaN(cpk)) return { label: 'N/A',        color: '#6b7280', tier: -1 };
  if (cpk >= 2.00)                return { label: 'Excellent',   color: '#22c55e', tier: 5 };
  if (cpk >= 1.67)                return { label: 'Optimal',     color: '#3b82f6', tier: 4 };
  if (cpk >= 1.33)                return { label: 'Good',        color: '#84cc16', tier: 3 };
  if (cpk >= 1.00)                return { label: 'Acceptable',  color: '#eab308', tier: 2 };
  if (cpk >= 0.67)                return { label: 'Bad',         color: '#f97316', tier: 1 };
  return                                 { label: 'Terrible',    color: '#ef4444', tier: 0 };
}

// ------------------------------------------------------------
// PROCESAMIENTO COMPLETO DE UN LOTE DE ARCHIVOS .LOG
// Agrupa por magnificación y calcula estadísticas globales
// ------------------------------------------------------------
function processLogFiles(files) {
  // files = [{ filename, content }]
  const parsed = files
    .map(f => parseLogFile(f.filename, f.content))
    .filter(Boolean);

  if (parsed.length === 0) return [];

  // Agrupar por magnificación
  const groups = {};
  for (const log of parsed) {
    const mag = log.magnification || 'UNKNOWN';
    if (!groups[mag]) {
      groups[mag] = { magnification: mag, files: [], xValues: [], yValues: [] };
    }
    groups[mag].files.push(log.filename);
    for (const e of log.entries) {
      groups[mag].xValues.push(e.x);
      groups[mag].yValues.push(e.y);
    }
  }

  // Calcular estadísticas por grupo
  const results = [];
  for (const mag of MAG_DISPLAY_ORDER) {
    if (!groups[mag]) continue;
    const g = groups[mag];
    const statX = calculateCpkAxis(g.xValues);
    const statY = calculateCpkAxis(g.yValues);
    if (!statX || !statY) continue;

    const overallCpk = Math.min(statX.cpk, statY.cpk);

    results.push({
      magnification: mag,
      label:         MAGNIFICATION_CATALOG[mag]?.label || mag,
      models:        MAGNIFICATION_CATALOG[mag]?.models || [],
      fileCount:     g.files.length,
      files:         g.files,
      sampleCount:   g.xValues.length,
      x:             statX,
      y:             statY,
      _xRaw:         g.xValues,   // valores raw para gráficas
      _yRaw:         g.yValues,
      cpk:           overallCpk,
      status:        getCpkStatus(overallCpk),
    });
  }

  // Añadir grupos de magnificaciones no conocidas (future-proof)
  for (const [mag, g] of Object.entries(groups)) {
    if (MAG_DISPLAY_ORDER.includes(mag)) continue;
    const statX = calculateCpkAxis(g.xValues);
    const statY = calculateCpkAxis(g.yValues);
    if (!statX || !statY) continue;
    const overallCpk = Math.min(statX.cpk, statY.cpk);
    results.push({
      magnification: mag,
      label:         mag,
      models:        [],
      fileCount:     g.files.length,
      files:         g.files,
      sampleCount:   g.xValues.length,
      x:             statX,
      y:             statY,
      _xRaw:         g.xValues,
      _yRaw:         g.yValues,
      cpk:           overallCpk,
      status:        getCpkStatus(overallCpk),
    });
  }

  return results;
}

// ------------------------------------------------------------
// UTILIDADES DE FORMATO
// ------------------------------------------------------------
function formatNm(value) {
  if (value === null || value === undefined || isNaN(value)) return '—';
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function formatCpk(value) {
  if (value === null || value === undefined || isNaN(value)) return '—';
  return value.toFixed(4);
}

function formatSigma(value) {
  if (value === null || value === undefined || isNaN(value)) return '—';
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

// ------------------------------------------------------------
// EXPORTS (compatibilidad con entornos module y browser global)
// ------------------------------------------------------------
const CPK = {
  MAGNIFICATION_CATALOG,
  MAG_DISPLAY_ORDER,
  detectMagnification,
  detectMagByFilename,
  parseLogFile,
  populationStdDev,
  mean,
  calculateCpkAxis,
  getCpkStatus,
  processLogFiles,
  formatNm,
  formatCpk,
  formatSigma,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CPK;
} else {
  window.CPK = CPK;
}
