'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let cpkResults  = [];   // Array de resultados por magnificación
let rawFiles    = [];   // [{ filename, content }] — para la tabla y PDF
let selectedMag = null; // Clave activa ej. 'M11', 'M19', 'M23'
const charts    = {};   // { 'M11-x': Chart, 'M11-y': Chart, ... }

// ── Apple Dark chart palette ──────────────────────────────────────────────────
const D = {
    line:     '#0a84ff',
    fill:     'rgba(10,132,255,0.07)',
    point:    '#0a84ff',
    pointBdr: 'rgba(255,255,255,0.12)',
    grid:     'rgba(255,255,255,0.065)',
    tick:     '#636366',
    uslColor: 'rgba(255,69,58,0.85)',
    annText:  '#fff',
    annPad:   { x: 7, y: 4 },
    annRad:   5
};

// ── Status → colores UI ───────────────────────────────────────────────────────
const STATUS_COLORS = {
    'Excellent':  { bg: '#30d158', color: '#000' },
    'Optimal':    { bg: '#32ade6', color: '#000' },
    'Good':       { bg: '#34c759', color: '#000' },
    'Acceptable': { bg: '#3a3a3c', color: '#fff' },
    'Bad':        { bg: '#ff9f0a', color: '#000' },
    'Terrible':   { bg: '#ff453a', color: '#fff' },
    'N/A':        { bg: '#48484a', color: '#fff' },
};

function getStatusStyle(label) {
    return STATUS_COLORS[label] || STATUS_COLORS['N/A'];
}

// Helper: formatea un número permitiendo Infinity como "∞"
function fmtNum(value, decimals = 0) {
    if (value === null || value === undefined) return '—';
    if (value === Infinity || value === -Infinity) return '∞';
    if (typeof value === 'number' && isNaN(value)) return '—';
    return Number(value).toFixed(decimals);
}

// ── Carga de archivos ─────────────────────────────────────────────────────────
document.getElementById('folder-input').addEventListener('change', async e => {
    const files = e.target.files;
    if (!files || !files.length) return;

    showLoading('Cargando logs…');

    const fileList = [];
    // Lectura robusta: si un archivo falla, lo saltamos en lugar de romper todo
    for (const f of files) {
        if (!f.name.toLowerCase().endsWith('.log')) continue;
        try {
            const content = await f.text();
            fileList.push({ filename: f.name, content });
        } catch (err) {
            console.warn(`[CPK] No se pudo leer ${f.name}:`, err);
        }
    }

    rawFiles   = fileList;
    cpkResults = CPK.processLogFiles(fileList);

    console.log(`[CPK] ${fileList.length} archivos leídos, ${cpkResults.length} magnificaciones detectadas:`,
                cpkResults.map(r => `${r.label} (${r.sampleCount} muestras)`));

    // Seleccionar la primera magnificación detectada por defecto
    selectedMag = cpkResults.length > 0 ? cpkResults[0].magnification : null;

    e.target.value = '';
    render();
    hideLoading();
});

// ── Render principal ──────────────────────────────────────────────────────────
function render() {
    const hasData = cpkResults.length > 0;

    document.getElementById('empty-state').style.display  = hasData ? 'none'  : 'flex';
    document.getElementById('main-content').style.display = hasData ? 'flex'  : 'none';
    document.getElementById('pdf-btn').disabled            = !hasData;

    const dot = document.querySelector('.panel-header-dot');
    if (dot) dot.classList.toggle('active', hasData);

    if (!hasData) return;

    renderTabs();
    renderTable();
    renderContent();
}

// ── Tabs de magnificación ─────────────────────────────────────────────────────
function renderTabs() {
    const container = document.getElementById('mag-tabs');
    if (!container) return;

    container.innerHTML = cpkResults.map(r => {
        const s   = getStatusStyle(r.status.label);
        const act = r.magnification === selectedMag;
        return `
        <button class="mag-tab ${act ? 'active' : ''}"
                onclick="selectMag('${r.magnification}')"
                style="${act
                    ? `--tab-accent:${s.bg};border-color:${s.bg}44;background:${s.bg}15;color:${s.bg}`
                    : ''}">
            <span class="mag-tab-label">${r.label}</span>
            <span class="mag-tab-badge"
                  style="background:${s.bg}22;color:${s.bg};border:1px solid ${s.bg}44">
                ${r.status.label}
            </span>
        </button>`;
    }).join('');
}

function selectMag(mag) {
    selectedMag = mag;
    renderTabs();
    renderContent();
}

// ── Tabla de archivos ─────────────────────────────────────────────────────────
function renderTable() {
    // Construir mapa mag → label
    const magMap = {};
    cpkResults.forEach(r => { magMap[r.magnification] = r.label; });

    // Recolectar todas las filas
    const rows = [];
    for (const r of cpkResults) {
        r.files.forEach(filename => {
            // Buscar el log correspondiente para sacar X/Y
            const log = CPK.parseLogFile(filename,
                rawFiles.find(f => f.filename === filename)?.content || '');
            if (!log || !log.entries.length) return;
            const e = log.entries[0];
            rows.push({ filename, mag: r.label, x: e.x, y: e.y });
        });
    }

    // Ordenar por filename
    rows.sort((a, b) => a.filename.localeCompare(b.filename));

    document.getElementById('log-count').textContent = `LOGS (${rows.length})`;
    document.getElementById('log-tbody').innerHTML = rows.map(r => `
        <tr>
            <td title="${r.filename}">${r.filename}</td>
            <td><span class="table-mag-chip">${r.mag}</span></td>
            <td>${r.x.toFixed(0)}</td>
            <td>${r.y.toFixed(0)}</td>
        </tr>`).join('');
}

// ── Contenido del panel derecho ───────────────────────────────────────────────
function renderContent() {
    const result = cpkResults.find(r => r.magnification === selectedMag);
    if (!result) return;

    renderStatsCards(result);
    renderLegend();
    renderCharts(result);
}

// ── Stats Cards ───────────────────────────────────────────────────────────────
function renderStatsCards(result) {
    buildStatsCard('stats-x', 'X-Ray Spot (X)', result.x, 'badge-x');
    buildStatsCard('stats-y', 'X-Ray Spot (Y)', result.y, 'badge-y');
}

function buildStatsCard(elId, title, stat, badgeId) {
    const s = getStatusStyle(CPK.getCpkStatus(stat.cpk).label);

    document.getElementById(elId).innerHTML = `
        <h3>${title}</h3>
        <div class="stats-divider"></div>
        <div class="stat-row">
            <span class="stat-label">Std Deviation</span>
            <span class="stat-value">${fmtNum(stat.sigma, 4)}</span>
        </div>
        <div class="stat-row">
            <span class="stat-label">Mean</span>
            <span class="stat-value">${fmtNum(stat.mu, 0)}</span>
        </div>
        <div class="stats-divider"></div>
        <div class="stat-row">
            <span class="stat-label">USL <small>(µ+6σ)</small></span>
            <span class="stat-value">${fmtNum(stat.usl, 0)}</span>
        </div>
        <div class="stat-row">
            <span class="stat-label">LSL <small>(µ−6σ)</small></span>
            <span class="stat-value">${fmtNum(stat.lsl, 0)}</span>
        </div>
        <div class="stats-divider"></div>
        <div class="cpk-row">
            <span class="cpk-label">Cp</span>
            <span class="cpk-value">${fmtNum(stat.cp, 12)}</span>
        </div>
        <div class="cpk-row">
            <span class="cpk-label">Cpk</span>
            <span class="cpk-value">${fmtNum(stat.cpk, 12)}</span>
        </div>
        <div class="status-badge"
             style="background:${s.bg};color:${s.color};box-shadow:0 4px 14px ${s.bg}55">
            ${CPK.getCpkStatus(stat.cpk).label}
        </div>`;

    if (badgeId) {
        const badge = document.getElementById(badgeId);
        if (badge) {
            const st = CPK.getCpkStatus(stat.cpk);
            badge.textContent        = st.label;
            badge.style.background   = s.bg + '22';
            badge.style.color        = s.bg;
            badge.style.border       = `1px solid ${s.bg}44`;
        }
    }
}

// ── Legend ────────────────────────────────────────────────────────────────────
function renderLegend() {
    const rows = [
        { t:'≥ 2.0',  l:'Excellent',  bg:'#30d158', c:'#000' },
        { t:'≥ 1.67', l:'Optimal',    bg:'#32ade6', c:'#000' },
        { t:'≥ 1.33', l:'Good',       bg:'#34c759', c:'#000' },
        { t:'≥ 1.0',  l:'Acceptable', bg:'#3a3a3c', c:'#fff' },
        { t:'≥ 0.67', l:'Bad',        bg:'#ff9f0a', c:'#000' },
        { t:'< 0.67', l:'Terrible',   bg:'#ff453a', c:'#fff' },
    ];
    document.getElementById('legend-card').innerHTML = `
        <h3>Criterios</h3>
        ${rows.map(r => `
            <div class="legend-item">
                <span class="legend-threshold">${r.t}</span>
                <span class="legend-badge"
                      style="background:${r.bg}22;color:${r.bg};border:1px solid ${r.bg}44">
                    ${r.l}
                </span>
            </div>`).join('')}`;
}

// ── Charts ────────────────────────────────────────────────────────────────────
function renderCharts(result) {
    buildChart(`chart-x`, result.x.x ?? result.magnification,
               result.x, 'X', result.magnification);
    buildChart(`chart-y`, result.y.x ?? result.magnification,
               result.y, 'Y', result.magnification);
}

function buildChart(canvasId, _unused, stat, axis, mag) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    // CRÍTICO: destruir CUALQUIER chart existente sobre este canvas
    // (no solo el de la misma mag — al cambiar tabs el canvas se reutiliza)
    const existing = Chart.getChart(ctx);
    if (existing) existing.destroy();

    // Limpiar de nuestro registro también
    for (const key of Object.keys(charts)) {
        if (key.endsWith(`-${axis}`)) delete charts[key];
    }

    const result = cpkResults.find(r => r.magnification === mag);
    if (!result) return;

    const values = axis === 'X' ? result._xRaw : result._yRaw;
    if (!values || !values.length) return;

    const { usl, lsl, mu: mean } = stat;
    const minV  = Math.min(...values, lsl);
    const maxV  = Math.max(...values, usl);
    const range = maxV - minV;
    // Si todos los valores son idénticos, usar padding sintético para que se vea la gráfica
    const pad   = range === 0 ? Math.max(1000, Math.abs(mean) * 0.0001) : range * 0.2;

    const inst = new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
            labels: values.map((_, i) => i + 1),
            datasets: [{
                data: values,
                borderColor: D.line,
                backgroundColor: D.fill,
                pointBackgroundColor: D.point,
                pointBorderColor: D.pointBdr,
                pointBorderWidth: 1,
                pointRadius: 4,
                pointHoverRadius: 6,
                pointHoverBackgroundColor: '#fff',
                pointHoverBorderColor: D.line,
                pointHoverBorderWidth: 2,
                tension: 0.42,
                fill: true,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            animation: { duration: 500, easing: 'easeInOutQuart' },
            interaction: { mode: 'index', intersect: false },
            scales: {
                y: {
                    min: minV - pad, max: maxV + pad,
                    grid:   { color: D.grid, drawBorder: false },
                    border: { dash: [3,5], color: 'transparent' },
                    ticks:  { color: D.tick, font: { size: 11 },
                              callback: v => Number(v).toFixed(0) }
                },
                x: {
                    grid:   { color: 'rgba(255,255,255,0.03)', drawBorder: false },
                    border: { color: 'transparent' },
                    title:  { display: true, text: 'Sample Index',
                              font: { size: 10.5 }, color: D.tick },
                    ticks:  { color: D.tick, font: { size: 11 } }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(22,22,24,0.96)',
                    titleColor: '#fff',
                    bodyColor:  'rgba(235,235,245,0.8)',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    padding: 11,
                    cornerRadius: 10,
                    displayColors: false,
                    callbacks: {
                        title: items => `Sample #${items[0].label}`,
                        label: item  => ` ${Number(item.raw).toFixed(0)}`
                    }
                },
                annotation: {
                    annotations: {
                        uslLine: {
                            type: 'line', yMin: usl, yMax: usl,
                            borderColor: D.uslColor, borderWidth: 1.5, borderDash: [5,5],
                            label: { display: true, content: `USL: ${usl.toFixed(0)}`,
                                position: 'start', backgroundColor: 'rgba(255,69,58,0.88)',
                                color: D.annText, font: { size: 11, weight: 'bold' },
                                padding: D.annPad, borderRadius: D.annRad }
                        },
                        lslLine: {
                            type: 'line', yMin: lsl, yMax: lsl,
                            borderColor: D.uslColor, borderWidth: 1.5, borderDash: [5,5],
                            label: { display: true, content: `LSL: ${lsl.toFixed(0)}`,
                                position: 'start', backgroundColor: 'rgba(255,69,58,0.88)',
                                color: D.annText, font: { size: 11, weight: 'bold' },
                                padding: D.annPad, borderRadius: D.annRad }
                        },
                        meanLine: {
                            type: 'line', yMin: mean, yMax: mean,
                            borderColor: '#30d158', borderWidth: 2,
                            label: { display: true, content: `Mean: ${mean.toFixed(0)}`,
                                position: 'end', backgroundColor: 'rgba(48,209,88,0.92)',
                                color: '#000', font: { size: 11, weight: 'bold' },
                                padding: D.annPad, borderRadius: D.annRad }
                        }
                    }
                }
            }
        }
    });

    charts[`${mag}-${axis}`] = inst;
}

// ── Modal PDF ─────────────────────────────────────────────────────────────────
function openPDFModal() {
    const dateInput = document.getElementById('fi-date');
    if (!dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);
    document.getElementById('pdf-modal').style.display = 'flex';
    setTimeout(() => document.getElementById('fi-customer').focus(), 60);
}
function closePDFModal() {
    document.getElementById('pdf-modal').style.display = 'none';
}
function handleOverlayClick(e) {
    if (e.target.id === 'pdf-modal') closePDFModal();
}
function exportPDF() { openPDFModal(); }

// ── Loading ───────────────────────────────────────────────────────────────────
function showLoading(msg = 'Cargando…') {
    document.getElementById('loading-text').textContent = msg;
    document.getElementById('loading-overlay').style.display = 'flex';
}
function hideLoading() {
    document.getElementById('loading-overlay').style.display = 'none';
}

// ── PDF: render chart light-theme ─────────────────────────────────────────────
function buildLightChartPNG(values, lsl, usl, mean, axisLabel) {
    return new Promise(resolve => {
        const canvas = document.createElement('canvas');
        canvas.width = 900; canvas.height = 300;
        Object.assign(canvas.style, { position:'fixed', top:'-9999px', left:'-9999px' });
        document.body.appendChild(canvas);

        const minV = Math.min(...values, lsl);
        const maxV = Math.max(...values, usl);
        const pad  = (maxV - minV) * 0.2;

        const chart = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: {
                labels: values.map((_,i) => i+1),
                datasets: [{
                    data: values,
                    borderColor: '#2563eb',
                    backgroundColor: 'rgba(37,99,235,0.07)',
                    pointBackgroundColor: '#2563eb',
                    pointRadius: 3,
                    tension: 0.42,
                    fill: true,
                    borderWidth: 2
                }]
            },
            options: {
                animation: { duration: 0 },
                responsive: false,
                scales: {
                    y: {
                        min: minV - pad, max: maxV + pad,
                        grid:  { color: '#f0f0f0' },
                        ticks: { color: '#555', font: { size: 10 },
                                 callback: v => Number(v).toFixed(0) }
                    },
                    x: {
                        grid:  { color: '#f5f5f5' },
                        ticks: { color: '#555', font: { size: 10 } },
                        title: { display: true, text: axisLabel, font:{size:11}, color:'#666' }
                    }
                },
                plugins: {
                    legend: { display: false },
                    annotation: {
                        annotations: {
                            uslL: { type:'line', yMin:usl, yMax:usl,
                                borderColor:'rgba(220,38,38,.75)', borderWidth:1.5, borderDash:[5,5],
                                label:{ display:true, content:`USL: ${usl.toFixed(0)}`, position:'start',
                                    backgroundColor:'rgba(220,38,38,.85)', color:'#fff',
                                    font:{size:10,weight:'bold'}, padding:{x:5,y:3}, borderRadius:4 } },
                            lslL: { type:'line', yMin:lsl, yMax:lsl,
                                borderColor:'rgba(220,38,38,.75)', borderWidth:1.5, borderDash:[5,5],
                                label:{ display:true, content:`LSL: ${lsl.toFixed(0)}`, position:'start',
                                    backgroundColor:'rgba(220,38,38,.85)', color:'#fff',
                                    font:{size:10,weight:'bold'}, padding:{x:5,y:3}, borderRadius:4 } },
                            meanL: { type:'line', yMin:mean, yMax:mean,
                                borderColor:'rgba(22,163,74,.9)', borderWidth:2,
                                label:{ display:true, content:`Mean: ${mean.toFixed(0)}`, position:'end',
                                    backgroundColor:'rgba(22,163,74,.9)', color:'#fff',
                                    font:{size:10,weight:'bold'}, padding:{x:5,y:3}, borderRadius:4 } }
                        }
                    }
                }
            }
        });

        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => {
            const off = document.createElement('canvas');
            off.width = canvas.width; off.height = canvas.height;
            const ctx = off.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, off.width, off.height);
            ctx.drawImage(canvas, 0, 0);
            const url = off.toDataURL('image/png');
            chart.destroy();
            canvas.remove();
            resolve(url);
        })));
    });
}

function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
                        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── PDF: generar reporte completo ─────────────────────────────────────────────
async function generatePDF() {
    closePDFModal();

    const info = {
        date:     document.getElementById('fi-date').value,
        customer: document.getElementById('fi-customer').value.trim(),
        model:    document.getElementById('fi-model').value.trim(),
        serial:   document.getElementById('fi-serial').value.trim(),
        engineer: document.getElementById('fi-engineer').value.trim(),
    };

    showLoading('Renderizando gráficas…');

    // Construir PNGs para cada magnificación presente
    const pngMap = {};
    for (const r of cpkResults) {
        if (!r._xRaw || !r._yRaw) continue;
        pngMap[r.magnification] = {
            x: await buildLightChartPNG(r._xRaw, r.x.lsl, r.x.usl, r.x.mu, 'X-ray Spot (X)'),
            y: await buildLightChartPNG(r._yRaw, r.y.lsl, r.y.usl, r.y.mu, 'X-ray Spot (Y)')
        };
    }

    // Logo
    let logoDataURL = null;
    const logoEl = document.getElementById('smt-logo');
    if (logoEl && logoEl.complete && logoEl.naturalWidth > 0) {
        try {
            const lc = document.createElement('canvas');
            lc.width = logoEl.naturalWidth; lc.height = logoEl.naturalHeight;
            lc.getContext('2d').drawImage(logoEl, 0, 0);
            logoDataURL = lc.toDataURL('image/png');
        } catch(_) {}
    }

    showLoading('Abriendo reporte…');

    const html   = buildReportHTML(info, pngMap, logoDataURL);
    const repWin = window.open('', '_blank', 'width=900,height=750,menubar=no,toolbar=no');

    if (!repWin) {
        hideLoading();
        alert('Por favor permite las ventanas emergentes para descargar el PDF.');
        return;
    }

    repWin.document.open();
    repWin.document.write(html);
    repWin.document.close();
    hideLoading();

    repWin.onload = () => setTimeout(() => { repWin.focus(); repWin.print(); }, 400);
    setTimeout(() => { if (repWin && !repWin.closed) { repWin.focus(); repWin.print(); }}, 1500);
}

// ── PDF: HTML del reporte ─────────────────────────────────────────────────────
function buildReportHTML(info, pngMap, logoDataURL) {

    const STATUS_LIGHT = {
        'Excellent':  { bg:'#22c55e', text:'#fff' },
        'Optimal':    { bg:'#67e8f9', text:'#0e7490' },
        'Good':       { bg:'#bbf7d0', text:'#166534' },
        'Acceptable': { bg:'#fde047', text:'#713f12' },
        'Bad':        { bg:'#f97316', text:'#fff' },
        'Terrible':   { bg:'#dc2626', text:'#fff' },
        'N/A':        { bg:'#e5e7eb', text:'#374151' },
    };

    function stBadge(cpkVal) {
        const st = CPK.getCpkStatus(cpkVal);
        const sc = STATUS_LIGHT[st.label] || STATUS_LIGHT['N/A'];
        return `<td class="badge-cell"
                    style="background-image:linear-gradient(${sc.bg},${sc.bg});color:${sc.text}">
                    ${st.label}
                </td>`;
    }

    // Secciones por magnificación
    const magSections = cpkResults.map(r => {
        const nd  = !r.x || !r.y;
        return `
        <div class="mag-section">
          <div class="mag-title">${r.label}</div>
          <table class="stats-table">
            <thead>
              <tr>
                <th class="lbl-col"></th>
                <th colspan="2" class="axis-head">X-ray Spot (X)</th>
                <th colspan="2" class="axis-head">X-ray Spot (Y)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td class="row-lbl">Std Deviation</td>
                <td colspan="2" class="val">${fmtNum(r.x?.sigma, 4)}</td>
                <td colspan="2" class="val">${fmtNum(r.y?.sigma, 4)}</td>
              </tr>
              <tr>
                <td class="row-lbl">Mean</td>
                <td colspan="2" class="val">${fmtNum(r.x?.mu)}</td>
                <td colspan="2" class="val">${fmtNum(r.y?.mu)}</td>
              </tr>
              <tr>
                <td class="row-lbl">USL (µ+6σ)</td>
                <td colspan="2" class="val">${fmtNum(r.x?.usl)}</td>
                <td colspan="2" class="val">${fmtNum(r.y?.usl)}</td>
              </tr>
              <tr>
                <td class="row-lbl">LSL (µ−6σ)</td>
                <td colspan="2" class="val">${fmtNum(r.x?.lsl)}</td>
                <td colspan="2" class="val">${fmtNum(r.y?.lsl)}</td>
              </tr>
              <tr>
                <td class="row-lbl">Cm</td>
                <td class="val mono">${fmtNum(r.x?.cp, 12)}</td>
                ${stBadge(r.x?.cp)}
                <td class="val mono">${fmtNum(r.y?.cp, 12)}</td>
                ${stBadge(r.y?.cp)}
              </tr>
              <tr>
                <td class="row-lbl">Cmk</td>
                <td class="val mono">${fmtNum(r.x?.cpk, 12)}</td>
                ${stBadge(r.x?.cpk)}
                <td class="val mono">${fmtNum(r.y?.cpk, 12)}</td>
                ${stBadge(r.y?.cpk)}
              </tr>
            </tbody>
          </table>
        </div>`;
    }).join('');

    // Sección de gráficas
    const chartsHTML = cpkResults.map(r => {
        const p = pngMap[r.magnification];
        if (!p) return '';
        return `
        <div class="chart-block">
          <div class="chart-block-title">${r.label}</div>
          <div class="chart-row">
            <div class="chart-col">
              <p class="chart-lbl">X-ray Spot (X)</p>
              <img src="${p.x}" class="chart-img" alt="Chart X">
            </div>
            <div class="chart-col">
              <p class="chart-lbl">X-ray Spot (Y)</p>
              <img src="${p.y}" class="chart-img" alt="Chart Y">
            </div>
          </div>
        </div>`;
    }).join('');

    const logoTag = logoDataURL
        ? `<img src="${logoDataURL}" class="rep-logo" alt="Logo">`
        : `<div class="rep-logo-text">SMT</div>`;

    const dateStr = info.date
        ? new Date(info.date + 'T12:00:00').toLocaleDateString('es-MX',
            { day:'2-digit', month:'2-digit', year:'numeric' })
        : new Date().toLocaleDateString('es-MX', { day:'2-digit', month:'2-digit', year:'numeric' });

    return `<!DOCTYPE html>
<html lang="es"><head>
<meta charset="UTF-8">
<title>CM/CMK VITROX Report — ${esc(info.customer)}</title>
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
  body{font-family:Arial,Helvetica,sans-serif;font-size:9.5pt;color:#111;background:#fff}
  @page{margin:14mm 16mm;size:A4}
  .rep-header{display:flex;justify-content:space-between;align-items:flex-start;
    padding-bottom:10px;border-bottom:2.5px solid #111;margin-bottom:12px}
  .rep-logo{height:44px;object-fit:contain}
  .rep-logo-text{font-size:20px;font-weight:900;color:#1e40af;
    border:2.5px solid #1e40af;padding:3px 10px;border-radius:4px}
  .rep-title{font-size:20pt;font-weight:900;letter-spacing:-.02em;color:#111}
  .rep-meta{margin-top:6px;display:flex;flex-direction:column;gap:2px;align-items:flex-end}
  .rep-meta-row{font-size:9pt;color:#444}
  .rep-meta-row strong{color:#111}
  .info-table{border-collapse:collapse;margin-bottom:14px}
  .info-table td{padding:4px 10px;border:1px solid #ccc;font-size:9.5pt}
  .info-table td:first-child{background-image:linear-gradient(#f0f0f0,#f0f0f0);font-weight:700;width:115px;color:#222}
  .mag-section{margin-bottom:12px;page-break-inside:avoid}
  .mag-title{text-align:center;font-size:13pt;font-weight:800;
    border:1.5px solid #222;padding:5px;background-image:linear-gradient(#f0f0f0,#f0f0f0)}
  .stats-table{width:100%;border-collapse:collapse;font-size:8.5pt}
  .stats-table th{background-image:linear-gradient(#e8e8e8,#e8e8e8);border:1px solid #ccc;
    padding:4px 8px;text-align:center;font-size:9pt;font-weight:700}
  .axis-head{background-image:linear-gradient(#dde8f0,#dde8f0)}
  .lbl-col{width:105px}
  .stats-table td{border:1px solid #d4d4d4;padding:3.5px 8px}
  .row-lbl{text-align:right;background-image:linear-gradient(#f7f7f7,#f7f7f7);font-size:8.5pt;color:#333}
  .val{text-align:right;font-variant-numeric:tabular-nums}
  .mono{font-family:'Courier New',monospace;font-size:8pt}
  .badge-cell{text-align:center;font-weight:700;font-size:8pt;letter-spacing:.03em;width:68px}
  .criteria-wrap{margin-top:12px;page-break-inside:avoid}
  .criteria-title{font-size:9pt;font-weight:700;margin-bottom:4px;color:#444;
    text-transform:uppercase;letter-spacing:.05em}
  .criteria-table{border-collapse:collapse}
  .criteria-table td{border:1px solid #ccc;padding:3px 10px;font-size:9pt}
  .criteria-table td:first-child{background-image:linear-gradient(#f7f7f7,#f7f7f7);width:140px}
  .criteria-table td:last-child{font-weight:700;text-align:center;width:80px}
  .charts-page{page-break-before:always}
  .charts-page-title{text-align:center;font-size:16pt;font-weight:800;
    padding:8px;border-bottom:2px solid #111;margin-bottom:16px}
  .chart-block{margin-bottom:20px;page-break-inside:avoid}
  .chart-block-title{font-size:11pt;font-weight:700;background:#f0f0f0;
    border:1px solid #ddd;padding:5px 10px;text-align:center;margin-bottom:8px}
  .chart-row{display:flex;gap:12px}
  .chart-col{flex:1}
  .chart-lbl{font-size:8.5pt;color:#666;margin-bottom:4px;font-style:italic}
  .chart-img{width:100%;height:auto;border:1px solid #e5e5e5;border-radius:3px}
  .rep-footer{position:fixed;bottom:8mm;left:0;right:0;text-align:center;
    font-size:8pt;color:#999;border-top:1px solid #ddd;padding-top:4px}
</style>
</head><body>

<div class="rep-header">
  <div>${logoTag}</div>
  <div style="text-align:right">
    <div class="rep-title">CM/CMK VITROX Report</div>
    <div class="rep-meta">
      <div class="rep-meta-row"><strong>Date:</strong> ${dateStr}</div>
      <div class="rep-meta-row"><strong>Customer:</strong> ${esc(info.customer)||'—'}</div>
      <div class="rep-meta-row"><strong>S/N:</strong> ${esc(info.serial)||'—'}</div>
    </div>
  </div>
</div>

<table class="info-table">
  <tr><td>Customer Info.</td><td>${esc(info.customer)}</td></tr>
  <tr><td>Machine Model</td><td>${esc(info.model)}</td></tr>
  <tr><td>System S/N</td><td>${esc(info.serial)}</td></tr>
  <tr><td>SMTo Engineer</td><td>${esc(info.engineer)}</td></tr>
</table>

${magSections}

<div class="criteria-wrap">
  <div class="criteria-title">CM/CMK Reference</div>
  <table class="criteria-table">
    <tr><td>CMK &gt;= 2.0</td>           <td style="background-image:linear-gradient(#22c55e,#22c55e);color:#fff">Excellent</td></tr>
    <tr><td>2.0 &gt; CMK &gt;= 1.67</td> <td style="background-image:linear-gradient(#67e8f9,#67e8f9);color:#0e7490">Optimal</td></tr>
    <tr><td>1.67 &gt; CMK &gt;= 1.33</td><td style="background-image:linear-gradient(#bbf7d0,#bbf7d0);color:#166534">Good</td></tr>
    <tr><td>1.33 &gt; CMK &gt;= 1.0</td> <td style="background-image:linear-gradient(#fde047,#fde047);color:#713f12">Acceptable</td></tr>
    <tr><td>1.0 &gt; CMK &gt;= 0.67</td> <td style="background-image:linear-gradient(#f97316,#f97316);color:#fff">Bad</td></tr>
    <tr><td>0.67 &gt; CMK</td>           <td style="background-image:linear-gradient(#dc2626,#dc2626);color:#fff">Terrible</td></tr>
  </table>
</div>

<div class="charts-page">
  <div class="charts-page-title">Process Charts</div>
  ${chartsHTML}
</div>

<div class="rep-footer">CM/CMK VITROX — ${esc(info.customer)||'Report'} — ${dateStr}</div>
</body></html>`;
}
