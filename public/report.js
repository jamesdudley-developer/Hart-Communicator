/* HART Communicator — device configuration report.
   Turns the data app.js reads from the device into a printable A4 report.
   "Save as PDF" uses the browser's own print dialog, so nothing leaves the device and no
   external library is needed (the CSP blocks them anyway).
   window.HARTReport = { render(data), open(data), close(), print() } */
(() => {
'use strict';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const dash = v => (v === null || v === undefined || v === '' || (typeof v === 'number' && !isFinite(v))) ? '—' : v;
const p2 = n => String(n).padStart(2, '0');
const dateTime = d => `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
const timeOnly = d => `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;

// Report number: HC-YYMMDD-HHMM-TAG. Readable, sorts by date, unique enough per technician.
function reportNo(d, tag){
  const t = String(tag || 'DEVICE').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 12) || 'DEVICE';
  return `HC-${String(d.getFullYear()).slice(2)}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}-${t}`;
}

// Key/value table. Rows with value === undefined are skipped; null shows a dash.
function kv(rows){
  const body = rows.filter(r => r && r[1] !== undefined).map(([k, v, cls]) =>
    `<tr><th>${esc(k)}</th><td class="${cls || ''}">${v && v.__html ? v.__html : esc(dash(v))}</td></tr>`).join('');
  return `<table class="rp-kv">${body}</table>`;
}
const html = s => ({ __html: s });
const mono = s => html(`<span class="rp-mono">${esc(dash(s))}</span>`);

function section(num, title, inner, extra = ''){
  return `<section class="rp-sec ${extra}"><h2><span class="rp-num">${num}</span>${esc(title)}</h2>${inner}</section>`;
}

function statusSummary(st){
  if (!st) return { text: 'Not read', cls: '' };
  const bad = st.flags.some(f => f.cls === 'bad') || st.ext.some(f => f.cls === 'bad');
  const warn = st.flags.length || st.ext.length;
  if (bad) return { text: 'Fault reported', cls: 'bad' };
  if (warn) return { text: 'Attention', cls: 'warn' };
  return { text: 'Normal', cls: 'ok' };
}

function render(r){
  const d = r.device, rg = r.range, sn = r.sensor, st = r.status, j = r.job || {};
  const created = r.meta.created;
  const no = reportNo(created, d.tag || d.longTag);
  const sum = statusSummary(st);
  const units = rg ? rg.unitsText : '';
  const title = d.longTag || d.tag || 'Untagged device';
  const subTitle = [d.tag && d.longTag && d.tag !== d.longTag ? d.tag : null, d.desc].filter(Boolean).join(' · ');

  /* ---------- Header ---------- */
  let out = `<header class="rp-head">
    <div class="rp-brand">
      ${j.company ? `<div class="rp-company">${esc(j.company)}</div>` : ''}
      <h1>Device Configuration Report</h1>
      <div class="rp-purpose">${esc(j.purpose || 'Configuration record')}</div>
    </div>
    <table class="rp-meta">
      <tr><th>Report no.</th><td class="rp-mono">${esc(no)}</td></tr>
      <tr><th>Date</th><td>${esc(dateTime(created))}</td></tr>
      <tr><th>Technician</th><td>${esc(dash(j.technician))}</td></tr>
      <tr><th>Work order</th><td>${esc(dash(j.workOrder))}</td></tr>
    </table>
  </header>`;

  if (r.meta.sim) out += `<div class="rp-banner">Simulated device. This report shows the layout only and is not a record of a field instrument.</div>`;

  /* ---------- Identity strip ---------- */
  const rangeText = rg ? `${rg.lrvText} to ${rg.urvText} ${units}` : '—';
  out += `<div class="rp-ident">
    <div class="rp-ident-main">
      <div class="rp-tag">${esc(title)}</div>
      <div class="rp-tagsub">${esc(subTitle)}</div>
      <div class="rp-model">${esc([d.mfr, d.model].filter(Boolean).join(' ') || 'Model not identified')}</div>
    </div>
    <div class="rp-tiles">
      <div class="rp-tile"><span>Calibrated range</span><b>${esc(rangeText)}</b></div>
      <div class="rp-tile"><span>Output</span><b>${esc(rg ? `4–20 mA, ${rg.transferText}` : '—')}</b></div>
      <div class="rp-tile ${sum.cls}"><span>Device status</span><b>${esc(sum.text)}</b></div>
    </div>
  </div>`;

  /* ---------- 1 Job and location ---------- */
  const job = kv([
    ['Site', j.site || null], ['Area / location', j.location || null],
    ['Purpose', j.purpose || null], ['Work order', j.workOrder || null]
  ]);

  /* ---------- 2 Device identification ---------- */
  const ident = kv([
    ['Manufacturer', d.mfr],
    ['Model (from device type)', d.model || 'Not in the profile library'],
    ['Device type', mono(d.devTypeHex)],
    ['Device ID', mono(d.devId)],
    ['HART revision', d.hartRev],
    ['Device / software / hardware rev.', `${d.devRev} / ${d.swRev} / ${d.hwRev}`],
    ['Final assembly number', d.fan ?? null],
    ['Poll address', d.poll],
    ['Configuration change counter', d.cfgCount ?? undefined],
  ]);

  out += `<div class="rp-grid">${section(1, 'Job and location', job)}${section(2, 'Device identification', ident)}</div>`;

  /* ---------- 3 Model code and options ---------- */
  const mc = r.modelCode || {};
  let mcBody;
  if (mc.model || mc.extended){
    mcBody = kv([
      ['Model number', mono(mc.model)],
      ['Extended model code', mc.extended ? mono(mc.extended) : undefined],
      ...(mc.options || []).map(o => [o.label, o.value]),
      ['Source', mc.source || undefined]
    ]);
  } else {
    mcBody = `<div class="rp-pending">
      <table class="rp-kv">
        <tr><th>Model number</th><td class="rp-slot">Not yet decoded</td></tr>
        <tr><th>Extended model code</th><td class="rp-slot">Not yet decoded</td></tr>
        <tr><th>Remote seals / options</th><td class="rp-slot">Not yet decoded</td></tr>
      </table>
      <p>${esc(mc.note || 'The full model code is held in manufacturer-specific commands. These fields fill in automatically once the command has been mapped from a capture or the Field Device Specification.')}</p>
    </div>`;
  }
  out += section(3, 'Model code and options', mcBody, 'rp-wide');

  /* ---------- 4 Range and output / 5 Sensor ---------- */
  const range = rg ? kv([
    ['PV units', units],
    ['Lower range value (4 mA)', `${rg.lrvText} ${units}`],
    ['Upper range value (20 mA)', `${rg.urvText} ${units}`],
    ['Span', `${rg.spanText} ${units}`],
    ['Damping', `${rg.dampingText} s`],
    ['Transfer function', rg.transferText],
    ['Alarm direction', rg.alarmText],
    ['Write protection', rg.wpText],
    ['Loop current mode', rg.loopModeText ?? undefined],
  ]) : '<p class="rp-none">Range data could not be read (Command 15).</p>';

  const sensor = sn ? kv([
    ['Sensor serial number', sn.serial ? mono(sn.serial) : null],
    ['Upper sensor limit', sn.uslText != null ? `${sn.uslText} ${sn.unitsText}` : null],
    ['Lower sensor limit', sn.lslText != null ? `${sn.lslText} ${sn.unitsText}` : null],
    ['Minimum span', sn.minSpanText != null ? `${sn.minSpanText} ${sn.unitsText}` : null],
    ['Sensor type', sn.type ?? undefined],
    ['Wiring', sn.wiring ?? undefined],
    ...(sn.note ? [['Sensor setup', html(`<span class="rp-dim">${esc(sn.note)}</span>`)]] : [])
  ]) : '<p class="rp-none">Sensor information could not be read (Command 14).</p>';

  out += `<div class="rp-grid">${section(4, 'Range and output', range)}${section(5, 'Sensor', sensor)}</div>`;

  /* ---------- 6 Process values at time of report ---------- */
  if (r.dyn){
    const rows = r.dyn.vars.map(v => `<tr><td><b>${esc(v.slot)}</b></td><td>${esc(dash(v.dv))}</td><td class="rp-num-c">${esc(v.valueText)}</td><td>${esc(v.unitsText)}</td><td>${esc(dash(v.limits))}</td></tr>`).join('');
    out += section(6, 'Process values at time of report', `
      <table class="rp-tbl">
        <thead><tr><th>Variable</th><th>Device variable</th><th class="rp-num-c">Value</th><th>Units</th><th>Sensor limits</th></tr></thead>
        <tbody>
          <tr class="rp-loop"><td><b>Loop</b></td><td>Analog output</td><td class="rp-num-c">${esc(r.dyn.mAText)}</td><td>mA</td><td>${esc(r.dyn.pctText ? r.dyn.pctText + ' % of range' : '—')}</td></tr>
          ${rows}
        </tbody>
      </table>
      <p class="rp-foot">Read at ${esc(timeOnly(r.dyn.at))} with Command 3${r.dyn.mapNote ? '; ' + esc(r.dyn.mapNote) : ''}.</p>`, 'rp-wide');
  }

  /* ---------- 7 Device status ---------- */
  let stBody;
  if (st){
    const items = [...st.flags, ...st.ext];
    stBody = items.length
      ? `<ul class="rp-flags">${items.map(f => `<li class="${f.cls}"><b>${esc(f.title)}</b>${f.sub ? ` <span>${esc(f.sub)}</span>` : ''}</li>`).join('')}</ul>`
      : `<ul class="rp-flags"><li class="ok"><b>No status flags set.</b> <span>The device reported normal operation.</span></li></ul>`;
    if (st.cmd48) stBody += `<p class="rp-foot">Additional status (Command 48): <span class="rp-mono">${esc(st.cmd48)}</span>. These bytes are manufacturer-specific.</p>`;
  } else stBody = '<p class="rp-none">Status was not read.</p>';
  out += section(7, 'Device status', stBody, 'rp-wide');

  /* ---------- 8 Changes this session ---------- */
  const ch = r.changes || [];
  const chBody = ch.length
    ? `<table class="rp-tbl"><thead><tr><th>Time</th><th>Change</th><th>Detail</th><th>Result</th></tr></thead><tbody>${
        ch.map(c => `<tr class="${c.cls === 'bad' ? 'bad' : ''}"><td class="rp-mono">${esc(timeOnly(c.t))}</td><td>${esc(c.label)}</td><td>${esc(c.detail)}</td><td>${esc(c.result)}</td></tr>`).join('')}</tbody></table>`
    : '<p class="rp-none">No changes were written to the device in this session. The values above are as found.</p>';
  out += section(8, 'Changes made this session', chBody, 'rp-wide');

  /* ---------- 9 Notes and sign-off ---------- */
  out += section(9, 'Notes', j.notes ? `<p class="rp-notes">${esc(j.notes).replace(/\n/g, '<br>')}</p>` : '<div class="rp-lines"><span></span><span></span><span></span></div>', 'rp-wide rp-keep');

  out += `<section class="rp-sec rp-wide rp-keep rp-sign">
    <div><span>Performed by</span><div class="rp-sigline">${esc(j.technician || '')}</div><small>Name, signature, date</small></div>
    <div><span>Checked by</span><div class="rp-sigline"></div><small>Name, signature, date</small></div>
  </section>`;

  out += `<p class="rp-disclaimer">Values were read directly from the device over HART using universal and common-practice commands by HART Communicator ${esc(r.meta.appVersion)}. This app is not a registered HART host and does not use device descriptions. For SIL-rated devices, verify configuration with the manufacturer's approved tools.</p>`;

  return { html: out, number: no };
}

/* ---------- Preview overlay and printing ---------- */
let host = null;
function ensureHost(){
  if (host) return host;
  host = document.createElement('div');
  host.id = 'reportView';
  host.className = 'rp-view hidden';
  host.innerHTML = `<div class="rp-bar">
      <button id="rpClose">Close</button>
      <span id="rpTitle">Device report</span>
      <button class="primary" id="rpPrint">Save as PDF</button>
    </div>
    <div class="rp-scroll"><article class="rp-page" id="rpPage"></article></div>`;
  document.body.appendChild(host);
  host.querySelector('#rpClose').onclick = close;
  host.querySelector('#rpPrint').onclick = print;
  return host;
}

let lastTitle = '';
function open(data){
  const { html: body, number } = render(data);
  ensureHost();
  host.querySelector('#rpPage').innerHTML = body;
  host.querySelector('#rpTitle').textContent = number;
  host.classList.remove('hidden');
  document.body.classList.add('rp-open');
  lastTitle = number;
  // Put the report number in every printed page footer.
  let pg = document.getElementById('rpPageStyle');
  if (!pg){ pg = document.createElement('style'); pg.id = 'rpPageStyle'; document.head.appendChild(pg); }
  pg.textContent = `@page{@bottom-left{content:"${number.replace(/["\\]/g, '')} · HART Communicator device configuration report"}}`;
  return number;
}
function close(){
  if (!host) return;
  host.classList.add('hidden');
  document.body.classList.remove('rp-open');
}
function print(){
  // The document title becomes the suggested PDF file name.
  const old = document.title;
  if (lastTitle) document.title = lastTitle;
  const restore = () => { document.title = old; window.removeEventListener('afterprint', restore); };
  window.addEventListener('afterprint', restore);
  window.print();
}

window.HARTReport = { render, open, close, print, reportNo };
})();
