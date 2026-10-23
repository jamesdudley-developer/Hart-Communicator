/* HART Communicator — app logic */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const APP_VER = '4.8.1';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hex = b => Array.from(b, x => x.toString(16).padStart(2,'0').toUpperCase()).join(' ');
const hx = (n, w=2) => '0x' + n.toString(16).toUpperCase().padStart(w,'0');
const isAndroid = /Android/.test(navigator.userAgent);

/* ================= Log ================= */
const logEl = $('log'); const logLines = [];
function log(msg, cls){
  const line = `${new Date().toISOString().slice(11,23)}  ${msg}`;
  logLines.push(line);
  if (logLines.length > 800) logLines.splice(0, 200);
  const div = document.createElement('div');
  if (cls) div.className = cls;
  div.textContent = line;
  logEl.appendChild(div);
  while (logEl.childNodes.length > 600) logEl.removeChild(logEl.firstChild);
  logEl.scrollTop = logEl.scrollHeight;
}

/* ================= HART tables ================= */
// HART Common Table 2 – engineering unit codes (subset)
const UNITS = {
  1:'inH2O (68°F)',2:'inHg (0°C)',3:'ftH2O (68°F)',4:'mmH2O (68°F)',5:'mmHg (0°C)',6:'psi',7:'bar',8:'mbar',
  9:'g/cm²',10:'kg/cm²',11:'Pa',12:'kPa',13:'torr',14:'atm',15:'ft³/min',16:'gal/min',17:'L/min',
  18:'impgal/min',19:'m³/h',20:'ft/s',21:'m/s',22:'gal/s',23:'Mgal/d',24:'L/s',25:'ML/d',26:'ft³/s',
  27:'ft³/d',28:'m³/s',29:'m³/d',30:'impgal/h',31:'impgal/d',32:'°C',33:'°F',34:'°R',35:'K',36:'mV',
  37:'Ω',38:'Hz',39:'mA',40:'gal',41:'L',42:'impgal',43:'m³',44:'ft',45:'m',46:'bbl',47:'in',48:'cm',
  49:'mm',50:'min',51:'s',52:'h',53:'d',54:'cSt',55:'cP',56:'µmho',57:'%',58:'V',59:'pH',60:'g',61:'kg',
  62:'t',63:'lb',64:'short ton',65:'long ton',66:'mS/cm',67:'µS/cm',68:'N',69:'N·m',70:'g/s',71:'g/min',
  72:'g/h',73:'kg/s',74:'kg/min',75:'kg/h',76:'kg/d',77:'t/min',78:'t/h',79:'t/d',80:'lb/s',81:'lb/min',
  82:'lb/h',83:'lb/d',90:'SGU',91:'g/cm³',92:'kg/m³',93:'lb/gal',94:'lb/ft³',95:'g/mL',96:'kg/L',97:'g/L',
  145:'inH2O (60°F)',237:'MPa',238:'inH2O (4°C)',239:'mmH2O (4°C)',250:'Not used',251:'None',252:'Unknown',253:'Special'
};
const unitName = c => c == null ? '' : (UNITS[c] ?? (c >= 240 && c <= 249 ? `Mfr unit ${c}` : `Unit code ${c}`));

const MFR = {0x11:'Endress+Hauser',0x17:'Honeywell',0x1A:'ABB',0x26:'Rosemount',0x2A:'Siemens',0x37:'Yokogawa',0x45:'Krohne',0x62:'VEGA'};
const TRANSFER = {0:'Linear',1:'Square root',4:'Special curve',250:'Not used',251:'None'};
const ALARM = {0:'High',1:'Low',239:'Hold last value',250:'Not used',251:'None'};
const WRITEPROT = {0:'Off',1:'On',250:'Not used',251:'None'};
const RESP_CMD = {
  6:{2:'Invalid poll address',12:'Invalid loop current mode'},
  35:{9:'Lower range value too high',10:'Lower range value too low',11:'Upper range value too high',12:'Upper range value too low',13:'Both range values out of limits',14:'Span is below the recommended minimum',29:'Invalid span'},
  36:{9:'Applied process too high',10:'Applied process too low',14:'Span is below the recommended minimum',29:'Invalid span'},
  37:{9:'Applied process too high',10:'Applied process too low',14:'Upper range value pushed beyond limits',29:'Invalid span'},
  40:{3:'Current too high',4:'Current too low',11:'Loop current is disabled (multidrop)'},
  43:{9:'Applied process too high',10:'Applied process too low'},
  44:{2:'Units not supported by this device'},
  45:{3:'Trim correction too large',4:'Trim correction too small',9:'Output is not fixed at 4 mA',11:'Loop current is disabled (multidrop)'},
  51:{2:'That variable cannot be mapped there',5:'Too few data bytes'},
  82:{9:'Applied process too high',10:'Applied process too low'},
  46:{3:'Trim correction too large',4:'Trim correction too small',9:'Output is not fixed at 20 mA',11:'Loop current is disabled (multidrop)'}
};
const respText = (n, c) => (RESP_CMD[n] && RESP_CMD[n][c]) || RESP[c] || `response code ${c}`;
const RESP = {0:'OK',1:'Undefined',2:'Invalid selection',3:'Value too large',4:'Value too small',5:'Too few data bytes',
  6:'Device-specific error',7:'Write-protected',8:'Warning',16:'Access restricted',32:'Device busy',
  33:'Delayed response initiated',34:'Delayed response running',35:'Delayed response dead',36:'Delayed response conflict',64:'Command not implemented'};
const STATUS_BITS = [
  [0x80,'Device malfunction','The device has detected an internal fault.','bad'],
  [0x40,'Configuration changed','Set after any configuration write. Cleared by a host acknowledging it (Command 38).','warn'],
  [0x20,'Cold start','The device has restarted or lost power.','warn'],
  [0x10,'More status available','Extra diagnostics are available (shown below if read).','warn'],
  [0x08,'Loop current fixed','The output is not following the process, for example in loop test or multidrop.','warn'],
  [0x04,'Loop current saturated','The output is at its upper or lower limit.','warn'],
  [0x02,'Non-primary variable out of limits','SV, TV or QV is outside the sensor limits.','warn'],
  [0x01,'Primary variable out of limits','The PV is outside the sensor limits.','bad']
];
const EXT_BITS = [
  [0x01,'Maintenance required'],[0x02,'Device variable alert'],[0x04,'Critical power failure'],
  [0x08,'Failure'],[0x10,'Out of specification'],[0x20,'Function check']
];

/* ================= Data helpers ================= */
const f32 = (b, i) => { const v = new DataView(Uint8Array.from(b.slice(i, i+4)).buffer).getFloat32(0, false); return v; };
function fmt(v){
  if (v == null || !isFinite(v)) return '—';
  const a = Math.abs(v);
  return v.toFixed(a >= 1000 ? 1 : a >= 100 ? 2 : a >= 10 ? 3 : 4);
}
function unpackAscii(bytes){
  let out = '';
  for (let i = 0; i + 2 < bytes.length; i += 3){
    const v = (bytes[i] << 16) | (bytes[i+1] << 8) | bytes[i+2];
    for (let s = 18; s >= 0; s -= 6){ let c = (v >> s) & 0x3F; c |= ((~c & 0x20) << 1); out += String.fromCharCode(c); }
  }
  return out.replace(/@+$/,'').trimEnd();
}
const latin1 = b => String.fromCharCode(...b).replace(/\0/g,'').trim();
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function fillTable(el, rows){
  el.innerHTML = rows.filter(r => r[1] != null && r[1] !== '').map(([k,v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('');
}

/* ================= Transports ================= */
let transport = null, rxBuf = [];

class SerialTransport {
  async open(){
    this.port = await navigator.serial.requestPort();
    const info = this.port.getInfo();
    await this.port.open({ baudRate:1200, dataBits:8, parity:'odd', stopBits:1, bufferSize:1024 });
    log(`SERIAL opened VID=${info.usbVendorId!=null?hx(info.usbVendorId,4):'—'} 1200 8O1`);
    this.reader = this.port.readable.getReader();
    this.writer = this.port.writable.getWriter();
    this.running = true; this.readLoop();
    this.label = 'Web Serial';
  }
  async readLoop(){
    try { while (this.running){ const { value, done } = await this.reader.read(); if (done) break; if (value) rxBuf.push(...value); } }
    catch(e){ if (this.running){ log(`SERIAL read error: ${e.message}`, 'er'); lostConnection(); } }
  }
  async write(b){ await this.writer.write(b); }
  async setRTS(on){ try { await this.port.setSignals({ requestToSend:on }); } catch(e){} }
  async close(){
    this.running = false;
    try { await this.reader.cancel(); } catch(e){}
    try { this.reader.releaseLock(); this.writer.releaseLock(); } catch(e){}
    try { await this.port.close(); } catch(e){}
  }
}

// WebUSB: drives the modem's USB-to-serial chip directly (usb-serial.js). Covers CP210x
// (Wishcolor SMC-100C), FTDI, PL2303, CH34x, CDC-ACM, and the P+F Viator USB (VID 0x10E5).
class UsbSerialTransport {
  async open(){
    const d = await window.USBSerial.requestDevice();
    const chip = $('usbChip').value || 'auto';
    this.port = await window.USBSerial.openDevice(d, { chip, log: m => log(m) });
    this.dev = this.port.dev;
    this.label = `WebUSB (${this.port.name})`;
    this.running = true; this.readLoop();
  }
  async readLoop(){
    try { while (this.running){ const b = await this.port.read(); if (b.length) rxBuf.push(...b); } }
    catch(e){ if (this.running){ log(`USB read error: ${e.message}`, 'er'); lostConnection(); } }
  }
  async write(b){ await this.port.write(b); }
  async setRTS(on){ try { await this.port.setRTS(on); } catch(e){} }
  async close(){
    this.running = false;
    try { await this.port?.close(); } catch(e){}
  }
}

// Built-in simulator (sim.js). Replies arrive after a short delay, like a real loop.
class SimTransport {
  async open(){
    this.bus = new window.HARTSim.SimBus();
    this.label = 'Simulator'; this.isSim = true; this.running = true;
    log('SIMULATOR opened: temperature device at poll 0 (HART 5), pressure device at poll 1 (HART 7)');
  }
  async write(b){
    const replies = this.bus.write(b);
    setTimeout(() => { if (this.running) replies.forEach(r => rxBuf.push(...r)); }, 120 + Math.random() * 80);
  }
  async setRTS(){}
  async close(){ this.running = false; }
}

/* ================= Session traffic (for the Capture tab) ================= */
// Every byte the app sends and receives, in the same chunk shape the capture importers produce.
const traffic = [];
const ts = () => { const d = new Date(), p = (n, w=2) => String(n).padStart(w,'0'); return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(),3)}`; };
function record(bytes, dir){
  traffic.push({ bytes: Array.from(bytes), dir, time: ts() });
  if (traffic.length > 6000) traffic.splice(0, 1000);
}

/* ================= HART link layer ================= */
let chain = Promise.resolve();
const exclusive = fn => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };

let dev = null;          // identified device: { longAddr, preambles, ... }
let preambles = 10;

function frame(delim, addr, cmd, data=[]){
  const body = [delim, ...addr, cmd, data.length, ...data];
  const chk = body.reduce((a,b) => a ^ b, 0);
  return new Uint8Array([...Array(preambles).fill(0xFF), ...body, chk]);
}

function parseFrame(buf){
  for (let i = 2; i < buf.length; i++){
    const d = buf[i];
    if ((d !== 0x06 && d !== 0x86) || buf[i-1] !== 0xFF || buf[i-2] !== 0xFF) continue;
    const addrLen = d & 0x80 ? 5 : 1;
    const bcIdx = i + 1 + addrLen + 1;
    if (buf.length <= bcIdx) return { incomplete:true };
    const bc = buf[bcIdx], end = bcIdx + 1 + bc;
    if (buf.length <= end) return { incomplete:true };
    const fr = buf.slice(i, end + 1);
    const chk = fr.slice(0,-1).reduce((a,b) => a ^ b, 0);
    return { cmd:buf[i+1+addrLen], status:[buf[bcIdx+1], buf[bcIdx+2]], data:buf.slice(bcIdx+3, end), chkOk: chk === fr[fr.length-1] };
  }
  return null;
}

async function transact(fr, { quiet=false, timeout=900 } = {}){
  if (!transport) throw new Error('Not connected');
  rxBuf = [];
  await transport.setRTS(true);
  if (!quiet) log(`TX ${hex(fr)}`, 'tx');
  await transport.write(fr);
  record(fr, 'tx');
  await sleep(Math.ceil(fr.length * 11 / 1.2) + 15);   // 11 bits/byte at 1200 baud
  await transport.setRTS(false);
  const t0 = performance.now();
  while (performance.now() - t0 < timeout){
    const r = parseFrame(rxBuf);
    if (r && !r.incomplete){ record(rxBuf, 'rx'); if (!quiet) log(`RX ${hex(rxBuf)}`, 'rx'); return r; }
    await sleep(20);
  }
  if (rxBuf.length) record(rxBuf, 'rx');
  log(rxBuf.length ? `RX invalid ${hex(rxBuf)}` : 'RX no reply', 'er');
  return null;
}

// Send a command with retries; returns { data, status } or throws
async function cmd(number, data=[], opts={}){
  return exclusive(async () => {
    let last = 'No reply', dr = 0, bz = 0;
    for (let attempt = 0; attempt < 3; attempt++){
      const fr = dev ? frame(0x82, dev.longAddr, number, data) : frame(0x02, [0x80 | (opts.poll & 0x3F)], number, data);
      const r = await transact(fr, opts);
      if (!r){ continue; }
      if (!r.chkOk){ last = 'Checksum error'; continue; }
      if (r.cmd !== number){ last = `Reply to wrong command (${r.cmd})`; continue; }
      const s0 = r.status[0];
      if (s0 & 0x80){ last = `Communication error ${hx(s0)}`; continue; }
      if (s0 === 32){ last = 'Device busy'; if (opts.longBusy && bz++ < 100){ attempt--; await sleep(400); continue; } await sleep(300); continue; }
      if ((s0 === 33 || s0 === 34) && dr++ < 60){ last = 'Delayed response still running'; attempt--; await sleep(500); continue; }
      if (opts.raw){ handleDeviceStatus(r.status[1]); r.rcText = s0 ? respText(number, s0) : 'OK'; return r; }
      if (s0 !== 0 && s0 !== 8 && s0 !== 14) throw new Error(`Command ${number}: ${respText(number, s0)}`);
      handleDeviceStatus(r.status[1]);
      if (s0) r.warning = respText(number, s0);
      return r;
    }
    throw new Error(`Command ${number}: ${last}`);
  });
}

/* ================= Commands ================= */
async function identify(poll){
  dev = null; pvClass = null;
  const r = await cmd(0, [], { poll });
  const d = r.data;
  if (d.length < 12 || d[0] !== 0xFE) throw new Error('Unexpected Command 0 reply');
  const rev = d[4];
  const info = {
    poll, rev,
    longAddr: [0x80 | (d[1] & 0x3F), d[2], d[9], d[10], d[11]],
    mfrId: rev >= 7 && d.length >= 19 ? (d[17] << 8) | d[18] : d[1],
    devType: rev >= 7 ? (d[1] << 8) | d[2] : d[2],
    devRev: d[5], swRev: d[6], hwRev: d[7] >> 3,
    devId: hex(d.slice(9,12)), devIdDec: (d[9] << 16) | (d[10] << 8) | d[11],
    minPre: d[3],
    nVars: d.length > 13 ? d[13] : null,
    cfgCount: d.length > 15 ? (d[14] << 8) | d[15] : null,
    ext: d.length > 16 ? d[16] : null
  };
  preambles = Math.max(+info.minPre || 5, 5, preambles);
  dev = info;
  return info;
}

async function loadDetails(){
  const out = {};
  const tryCmd = async (n, fn) => { try { fn((await cmd(n)).data); } catch(e){ log(e.message, 'er'); } };
  await tryCmd(13, d => { out.tag = unpackAscii(d.slice(0,6)); out.desc = unpackAscii(d.slice(6,18)); if (d.length >= 21) out.date = `${String(d[18]).padStart(2,'0')}/${String(d[19]).padStart(2,'0')}/${1900 + d[20]}`; });
  if (dev.rev >= 6) await tryCmd(20, d => { out.longTag = latin1(d.slice(0,32)); });
  await tryCmd(12, d => { out.msg = unpackAscii(d.slice(0,24)); });
  await tryCmd(16, d => { if (d.length >= 3) out.fan = (d[0] << 16) | (d[1] << 8) | d[2]; });
  await tryCmd(15, d => {
    out.range = {
      alarm: d[0], transfer: d[1], units: d[2],
      urv: f32(d,3), lrv: f32(d,7), damping: f32(d,11), wp: d[15],
      analogFlags: d.length > 17 ? d[17] : null
    };
  });
  await tryCmd(48, d => { out.cmd48 = d; });
  return out;
}

/* ================= UI rendering ================= */
let lastDeviceStatus = null;
let cmd48Data = null;

function handleDeviceStatus(s){
  if (s === lastDeviceStatus) return;
  lastDeviceStatus = s;
  renderStatus();
}

function renderStatus(){
  const list = $('flags'); list.innerHTML = '';
  const add = (title, sub, cls) => {
    const li = document.createElement('li'); li.className = cls;
    li.textContent = title;
    if (sub){ const s = document.createElement('small'); s.textContent = sub; li.appendChild(s); }
    list.appendChild(li);
  };
  const s = lastDeviceStatus ?? 0;
  STATUS_BITS.forEach(([bit, t, sub, cls]) => { if (s & bit) add(t, sub, cls); });
  const ext = cmd48Data && cmd48Data.length > 6 ? cmd48Data[6] : dev?.ext;
  if (ext) EXT_BITS.forEach(([bit, t]) => { if (ext & bit) add(t, 'Extended device status (NAMUR NE 107 category)', bit & 0x0C ? 'bad' : 'warn'); });
  if (!list.children.length) add('No status flags set', 'The device reports normal operation.', 'ok');
  if (cmd48Data && cmd48Data.length) add(`Additional status (Command 48)`, hex(cmd48Data) + '. These bytes are manufacturer-specific; their meaning is in the device manual.', '');
  $('statusCard').classList.remove('hidden');
}

function renderDevice(info, det){
  const mfr = MFR[info.mfrId] || `Manufacturer ${hx(info.mfrId)}`;
  $('devName').textContent = det.longTag || det.tag || mfr;
  $('devSub').textContent = `${mfr}, device type ${hx(info.devType, info.rev >= 7 ? 4 : 2)}, HART ${info.rev}`;
  const shown = det.longTag || det.tag || mfr;
  $('liveTag').textContent = shown;
  $('barDevice').textContent = `${shown}, ${mfr}`;
  document.body.classList.add('has-device');
  fillTable($('devTable'), [
    ['Tag', det.tag], ['Long tag', det.longTag], ['Descriptor', det.desc], ['Message', det.msg], ['Date', det.date],
    ['Poll address', info.poll], [devIdLabel(info), info.devIdDec],
    ['Device / software / hardware rev', `${info.devRev} / ${info.swRev} / ${info.hwRev}`],
    [fanLabel(info), det.fan], ['Device variables', info.nVars],
    ['Configuration change counter', info.cfgCount]
  ]);
  measRow = null;
  $('devCard').classList.remove('hidden');

  if (det.range){
    const r = det.range, u = unitName(r.units);
    fillTable($('rangeTable'), [
      ['Lower range value (4 mA)', `${fmt(r.lrv)} ${u}`],
      ['Upper range value (20 mA)', `${fmt(r.urv)} ${u}`],
      ['Damping', `${fmt(r.damping)} s`],
      ['Transfer function', TRANSFER[r.transfer] ?? `Code ${r.transfer}`],
      ['Alarm direction', ALARM[r.alarm] ?? `Code ${r.alarm}`],
      ['Write protection', WRITEPROT[r.wp] ?? `Code ${r.wp}`]
    ]);
    $('rangeCard').classList.remove('hidden');
  }
  cmd48Data = det.cmd48 || null;
  renderStatus();
  lastDet = det;
  renderProfile(info);
  fillForms(det);
  renderDevice2();
  $('dvCard').classList.remove('hidden');
  $('rptCard').classList.remove('hidden');
}

// Adds the measurement type under the device identity once it is known.
let measRow = null;
function renderDevice2(){
  const { kind, from } = measKind();
  if (!kind || !$('devTable').rows.length) return;
  if (!measRow){ measRow = $('devTable').insertRow(0); measRow.insertCell(); measRow.insertCell(); }
  measRow.cells[0].textContent = 'Measurement';
  measRow.cells[1].textContent = `${KIND_LABEL[kind]} (from the ${from})`;
}

/* ================= Live polling ================= */
let live = false, liveRunning = false, lastLiveOk = 0, liveFails = 0;

async function liveLoop(){
  if (liveRunning) return;
  liveRunning = true;
  $('liveCard').classList.remove('hidden');
  while (live && transport && dev){
    const quiet = !$('logLive').checked;
    try {
      const r3 = await cmd(3, [], { quiet });
      const d = r3.data;
      const vars = [];
      for (let i = 4; i + 4 < d.length; i += 5) vars.push({ unit:d[i], val:f32(d, i+1) });
      let pct = null;
      try { const r2 = await cmd(2, [], { quiet }); pct = f32(r2.data, 4); } catch(e){}
      renderLive(f32(d,0), pct, vars);
      if (dvList && $('dvAuto').checked && !$('dvCard').classList.contains('hidden')) await readDvValues(false, quiet);
      if (st && $('stDetails').open){
        try {
          const r9 = await cmd(9, [st.dv], { quiet });
          const v = r9.data;   // [ext status][dv code][class][units][value x4][status]
          $('stLive').textContent = v.length >= 8 ? `${fmt(f32(v, 4))} ${unitName(v[3])}` : '—';
        } catch(e){ $('stLive').textContent = '—'; }
      }
      lastLiveOk = Date.now(); liveFails = 0;
    } catch(e){
      liveFails++;
      if (liveFails === 1 || liveFails % 5 === 0) log(`Live update failed: ${e.message}`, 'er');
      $('pvBox').classList.add('stale');
      if (liveFails >= 3) setPill('No reply from device', 'busy');
    }
    await sleep(400);
  }
  liveRunning = false;
}

function renderLive(mA, pct, vars){
  setPill(`Connected via ${transport.label}`, 'on');
  $('pvBox').classList.remove('stale');
  const pv = vars[0];
  $('pvVal').textContent = pv ? fmt(pv.val) : '—';
  $('pvUnit').textContent = pv ? unitName(pv.unit) : '';
  $('mA').textContent = `${fmt(mA)} mA`;
  $('pct').textContent = pct == null ? '— %' : `${fmt(pct)} %`;
  // Gauge scale runs 3–22 mA so NAMUR NE 43 fault zones are visible
  const pos = m => Math.min(100, Math.max(0, (m - 3) / 19 * 100));
  const p4 = pos(4), pm = isFinite(mA) ? pos(mA) : p4;
  $('pctFill').style.width = Math.max(0, pm - p4) + '%';
  $('mANeedle').style.left = pm + '%';
  $('mANeedle').classList.toggle('on', isFinite(mA));
  const names = ['Primary variable (PV)','Secondary variable (SV)','Tertiary variable (TV)','Quaternary variable (QV)'];
  fillTable($('dynTable'), vars.slice(1).map((v, i) => [names[i+1], isFinite(v.val) ? `${fmt(v.val)} ${unitName(v.unit)}` : 'Not assigned']));
}

setInterval(() => {
  if (!live || !lastLiveOk) { $('liveAge').textContent = ''; return; }
  const s = Math.round((Date.now() - lastLiveOk) / 1000);
  $('liveAge').textContent = s <= 2 ? 'Live' : `Updated ${s} s ago`;
}, 1000);

/* ================= Connection flow ================= */
function setPill(text, cls){ const p = $('pill'); p.textContent = text.startsWith('Connected via ') ? 'Connected' : text; p.title = text; p.className = 'pill' + (cls ? ' ' + cls : ''); }
function note(text, bad){ $('connNote').textContent = text; $('connNote').className = 'note' + (bad ? ' bad' : ''); }

function explain(e){
  if (e.name === 'NotFoundError') return 'No modem chosen. Check it is plugged in (through an OTG adapter on a phone), then pick it from the list.';
  if (e.name === 'SecurityError') return 'The browser blocked hardware access on this page. Open it in its own tab.';
  if (e.name === 'InvalidStateError') return 'The modem is already open in another tab or app. Close that and try again.';
  if (e.name === 'NetworkError' || /claim|busy|access/i.test(e.message)) return 'The modem is in use or owned by a driver. On Windows, choose Web Serial.';
  return e.message;
}

// The USB chip choice only matters for WebUSB.
function syncChipRow(){
  const m = $('method').value;
  $('usbChipRow').classList.toggle('hidden', !('usb' in navigator) || m === 'serial' || m === 'sim' || (m === 'auto' && !isAndroid && 'serial' in navigator));
}
$('method').addEventListener('change', syncChipRow);
syncChipRow();

function pickMethod(){
  const m = $('method').value;
  if (m !== 'auto') return m;
  if (isAndroid && 'usb' in navigator) return 'usb';
  if ('serial' in navigator) return 'serial';
  return 'usb';
}

async function connect(){
  const m = pickMethod();
  if (m === 'sim' && !window.HARTSim) return note('The simulator did not load. Reload the page.', true);
  if (m === 'usb' && !window.USBSerial) return note('The USB driver did not load. Reload the page.', true);
  if (m === 'usb' && !('usb' in navigator)) return note('WebUSB is not available in this browser. Use Chrome or Edge.', true);
  if (m === 'serial' && !('serial' in navigator)) return note('Web Serial is not available in this browser. Try WebUSB.', true);
  const t = m === 'sim' ? new SimTransport() : m === 'usb' ? new UsbSerialTransport() : new SerialTransport();
  try {
    await t.open();
    transport = t;
    setPill(`Connected via ${t.label}`, 'on');
    $('btnConnect').disabled = true; $('btnScan').disabled = false; $('btnDisc').disabled = false;
    await connectDevice(+$('addr').value);
  } catch(e){
    log(`Connect failed: ${e.name}: ${e.message}`, 'er');
    note(explain(e), true);
    try { await t.close(); } catch(_){}
  }
}

let scanning = false, scanStop = false;
async function connectDevice(poll){
  if (scanning){ scanStop = true; while (scanning) await sleep(50); }
  live = false;
  while (liveRunning) await sleep(50);
  $('scanList').innerHTML = '';
  dev = null; lastDeviceStatus = null; cmd48Data = null; st = null; $('stBody').classList.add('hidden');
  prof = null; snRead = null; ['profCard','snCard','conCard','rptCard'].forEach(id => $(id).classList.add('hidden')); $('snBytes').classList.add('hidden'); $('conResult').classList.add('hidden');
  dvList = null; dvMap = null; $('dvBody').classList.add('hidden'); $('dvList').innerHTML = ''; $('dvLoad').textContent = 'Load';
  $('dvHint').textContent = 'Reads every device variable with its type, live value, status and limits (HART Commands 9, 50 and 54).';
  setPill('Reading device…', 'busy');
  document.body.classList.remove('has-device');
  $('barDevice').textContent = `Reading poll address ${poll}…`;
  note(`Reading the device at poll address ${poll}…`);
  try {
    const info = await identify(poll);
    log(`Found ${MFR[info.mfrId] || hx(info.mfrId)} type ${hx(info.devType,4)} ID ${info.devId}, HART ${info.rev}`);
    const det = await loadDetails();
    renderDevice(info, det);
    note(`Connected to the device at poll address ${poll}. Changes are only written when you confirm them under Configure.`);
    live = true; $('btnLive').textContent = 'Pause';
    liveLoop();
  } catch(e){
    log(e.message, 'er');
    setPill(`Connected via ${transport?.label || ''}`, 'on');
    $('barDevice').textContent = 'No device';
    note(`No device answered at poll address ${poll}. Check the clips and loop resistance (250 Ω minimum), or scan addresses 0–15.`, true);
  }
}

async function scan(){
  live = false;
  while (liveRunning) await sleep(50);
  dev = null;
  $('btnScan').disabled = true;
  const list = $('scanList'); list.innerHTML = '';
  setPill('Scanning…', 'busy');
  let found = 0;
  scanning = true; scanStop = false;
  for (let a = 0; a <= 15 && transport && !scanStop; a++){
    note(`Scanning address ${a} of 15…`);
    try {
      const r = await exclusive(() => transact(frame(0x02, [0x80 | a], 0), { timeout:700 }));
      if (r && r.chkOk && r.data[0] === 0xFE){
        found++;
        const d = r.data, rev = d[4];
        const mfrId = rev >= 7 && d.length >= 19 ? (d[17] << 8) | d[18] : d[1];
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.textContent = `Address ${a}: ${MFR[mfrId] || hx(mfrId)}, ID ${hex(d.slice(9,12))}`;
        b.onclick = () => { $('addr').value = a; connectDevice(a); };
        li.appendChild(b); list.appendChild(li);
      }
    } catch(e){ log(e.message, 'er'); }
  }
  scanning = false;
  if (scanStop){ $('btnScan').disabled = !transport; return; }
  setPill(`Connected via ${transport?.label || ''}`, 'on');
  note(found ? `Found ${found} device${found > 1 ? 's' : ''}. Tap one to open it.` : 'No devices answered on addresses 0–15.', !found);
  $('btnScan').disabled = !transport;
}

async function disconnect(){
  live = false;
  while (liveRunning) await sleep(50);
  if (transport && dev && loopFixed != null){
    try { await cmd(40, fbytes(0)); log('Exited loop test before disconnecting'); } catch(e){ log(`Could not exit loop test: ${e.message}`, 'er'); }
    setLoopFixed(null);
  }
  if (transport){ await transport.close(); transport = null; }
  dev = null;
  setPill('Disconnected');
  document.body.classList.remove('has-device');
  $('barDevice').textContent = 'No device';
  $('btnConnect').disabled = false; $('btnScan').disabled = true; $('btnDisc').disabled = true;
  ['liveCard','statusCard','devCard','rangeCard','cfgCard','dvCard','profCard','snCard','conCard'].forEach(id => $(id).classList.add('hidden'));
  prof = null; snRead = null;
  $('scanList').innerHTML = '';
  note('Disconnected.');
  log('Disconnected');
}

function lostConnection(){
  if (!transport) return;
  transport.running = false;
  log('Modem unplugged or connection lost', 'er');
  disconnect().then(() => note('The modem was unplugged or the connection dropped. Reconnect to continue.', true));
}

/* ================= V2: writing ================= */
let lastDet = null, loopFixed = null, cfgBusy = false;
const changes = [];

const fbytes = v => { const b = new ArrayBuffer(4); new DataView(b).setFloat32(0, v, false); return [...new Uint8Array(b)]; };
const packedOk = s => /^[\x20-\x5F]*$/.test(s.toUpperCase());
function packAscii(str, nBytes){
  const n = nBytes * 4 / 3, s = str.toUpperCase().padEnd(n, ' ').slice(0, n), out = [];
  for (let i = 0; i < n; i += 4){
    let v = 0;
    for (let j = 0; j < 4; j++) v = (v << 6) | (s.charCodeAt(i + j) & 0x3F);
    out.push((v >> 16) & 255, (v >> 8) & 255, v & 255);
  }
  return out;
}
const latin1Bytes = (s, n) => Array.from(s.padEnd(n, ' ').slice(0, n), c => c.charCodeAt(0));
const num = id => { const v = $(id).value.trim(); return v === '' ? NaN : Number(v); };
const tidy = v => isFinite(v) ? Number(v.toPrecision(7)) : '';

/* ----- Measurement type of the connected device -----
   Worked out from what the device itself reports, in this order: the matched device profile,
   the device variable class of the PV (Command 54, HART Common Table 21), then the PV unit
   code (Command 15, HART Common Table 2). Until one of these is known, the app stays generic. */
const UNIT_GROUPS = [
  ['temperature', 'Temperature', [32,33,35,34]],
  ['pressure', 'Pressure', [7,8,12,11,237,6,1,4,238,239,145,3,2,5,9,10,13,14]],
  ['level', 'Level and length', [45,49,48,44,47]],
  ['flow', 'Volumetric flow', [19,28,29,24,17,16,15,26,27,22,23,25,18,30,31]],
  ['massflow', 'Mass flow', [75,73,74,76,78,77,79,82,80,81,83,70,71,72]],
  ['volume', 'Volume', [43,41,40,42,46]],
  ['mass', 'Mass', [61,60,62,63,64,65]],
  ['density', 'Density', [92,91,97,96,95,93,94,90]],
  ['electrical', 'Electrical', [36,37,39,58,38]],
  ['analytical', 'Analytical', [59,66,67,56]],
  ['other', 'Other', [57,20,21,54,55,68,69]]
];
const KIND_LABEL = Object.fromEntries(UNIT_GROUPS.map(([k, l]) => [k, l]));
// Unit groups offered for each kind. A temperature input can also be read as mV or ohms.
const KIND_UNITS = { temperature:['temperature','electrical'], electrical:['electrical','temperature'] };
const DV_CLASS_KIND = {64:'temperature',65:'pressure',66:'flow',68:'volume',69:'level',71:'mass',72:'massflow',73:'density',81:'analytical'};
const unitKind = c => c == null ? null : (UNIT_GROUPS.find(g => g[2].includes(c))?.[0] ?? null);
let pvClass = null;   // device variable class of the PV, once Command 54 has been read

function measKind(){
  if (prof?.profile.kind) return { kind: prof.profile.kind, from: 'device profile' };
  if (DV_CLASS_KIND[pvClass]) return { kind: DV_CLASS_KIND[pvClass], from: 'PV device variable class' };
  const k = unitKind(lastDet?.range?.units);
  return k ? { kind: k, from: 'PV units' } : { kind: null, from: '' };
}

// Wording for trims and push-button ranging, matched to what the device measures.
function kindText(kind){
  switch (kind){
    case 'pressure': return { ref:'a reference pressure', apply:'Apply the reference pressure',
      zeroHint:'These use the pressure applied right now. Vent or apply the reference pressure first and let it settle.',
      zeroBtn:'Zero PV (position correction)', zero:['The pressure applied right now becomes zero (position correction).', 'Make sure the transmitter is vented or at the true zero reference.'],
      now:'pressure applied right now' };
    case 'temperature': return { ref:'a reference temperature or a sensor simulator on the input', apply:'Put the sensor in the reference bath or dry-block, or set the sensor simulator on the input',
      zeroHint:'These use the temperature the device measures right now. Bring the sensor to the reference temperature, or set the simulator, and let it settle.',
      zeroBtn:'Zero PV (offset)', zero:['The temperature measured right now becomes zero.', 'Make sure the sensor is at the true zero reference.'],
      now:'temperature measured right now' };
    case 'level': return { ref:'a reference level', apply:'Bring the level to the reference point',
      zeroHint:'These use the level the device measures right now. Bring the level to the reference point first and let it settle.',
      zeroBtn:'Zero PV', zero:['The level measured right now becomes zero.', 'Make sure the level is at the true zero reference.'],
      now:'level measured right now' };
    default: { const n = KIND_LABEL[kind] ? KIND_LABEL[kind].toLowerCase() + ' value' : 'value';
      return { ref:`a reference ${n} from a calibrator`, apply:`Apply the reference ${n}`,
      zeroHint:`These use the ${n} the device measures right now. Bring the input to the reference first and let it settle.`,
      zeroBtn:'Zero PV', zero:[`The ${n} measured right now becomes zero.`, 'Make sure the input is at the true zero reference.'],
      now:`${n} measured right now` }; }
  }
}

function fillUnitSelect(kind, keep){
  const sel = $('fUnits');
  sel.innerHTML = '';
  const show = kind ? (KIND_UNITS[kind] || [kind]) : UNIT_GROUPS.map(g => g[0]);
  UNIT_GROUPS.filter(g => show.includes(g[0])).forEach(([, label, codes]) => {
    const og = document.createElement('optgroup'); og.label = label;
    codes.forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = UNITS[c]; og.appendChild(o); });
    sel.appendChild(og);
  });
  if (keep != null && ![...sel.options].some(o => +o.value === keep)){
    const o = document.createElement('option'); o.value = keep; o.textContent = unitName(keep); sel.appendChild(o);
  }
  if (keep != null) sel.value = keep;
}

// Applies the measurement type to every label that depends on it.
function applyKind(){
  const { kind } = measKind(), t = kindText(kind);
  const cur = $('fUnits').value;
  fillUnitSelect(kind, cur !== '' ? +cur : lastDet?.range?.units ?? null);
  $('stIntro').textContent = `Corrects the sensor reading against ${t.ref}.`;
  $('stApply').textContent = `${t.apply}, wait for the live reading to settle, then enter the calibrator's value. Do the lower point first.`;
  $('zrHint').textContent = t.zeroHint;
  $('wZero').textContent = t.zeroBtn;
}

fillUnitSelect(null);
for (let a = 0; a <= 63; a++){ const o = document.createElement('option'); o.value = a; o.textContent = a; $('fPoll').appendChild(o); }

function fillForms(det){
  $('cfgCard').classList.remove('hidden');
  $('fTag').value = det.tag || '';
  $('fDesc').value = det.desc || '';
  $('fMsg').value = det.msg || '';
  $('fLongTag').value = det.longTag || '';
  if (det.date){ const [d, m, y] = det.date.split('/'); $('fDate').value = `${y}-${m}-${d}`; }
  $('wLongTag').disabled = dev.rev < 6;
  const r = det.range;
  if (r){
    fillUnitSelect(measKind().kind, r.units);
    $('fLrv').value = tidy(r.lrv); $('fUrv').value = tidy(r.urv); $('fDamp').value = tidy(r.damping);
    $('wpWarn').classList.toggle('hidden', r.wp !== 1);
  }
  $('fPoll').value = dev.poll;
  applyKind();
}

function cfgMsg(text, cls){ const n = $('cfgNote'); n.textContent = text; n.className = 'cfgnote ' + (cls || ''); }

function confirmDialog(title, lines, output){
  return new Promise(res => {
    const dlg = $('dlg');
    $('dlgTitle').textContent = title;
    $('dlgList').innerHTML = '';
    lines.forEach(l => { const li = document.createElement('li'); li.textContent = l; $('dlgList').appendChild(li); });
    $('dlgSafe').classList.toggle('hidden', !output);
    $('dlgSafeChk').checked = false;
    $('dlgOk').disabled = !!output;
    $('dlgSafeChk').onchange = () => { $('dlgOk').disabled = !$('dlgSafeChk').checked; };
    const finish = v => { dlg.onclose = null; if (dlg.open) dlg.close(); res(v); };
    $('dlgOk').onclick = () => finish(true);
    $('dlgCancel').onclick = () => finish(false);
    dlg.onclose = () => res(false);
    dlg.showModal();
  });
}

function setCfgBusy(on){
  cfgBusy = on;
  $('cfgCard').style.opacity = on ? '.55' : '';
  $('cfgCard').style.pointerEvents = on ? 'none' : '';
}

function addChange(label, detail, result, cls){
  changes.push({ t: new Date(), label, detail, result, cls });
  $('histCard').classList.remove('hidden');
  const li = document.createElement('li'); li.className = cls === 'bad' ? 'bad' : '';
  li.textContent = label;
  const s = document.createElement('small');
  s.textContent = `${changes[changes.length-1].t.toLocaleTimeString()}. ${detail} ${result}`;
  li.appendChild(s);
  $('hist').prepend(li);
}

// Core write wrapper
async function runWrite({ label, lines, output=false, n, data=[], detail='', refresh=true, confirm=true, raw=false }){
  if (!dev || cfgBusy) return null;
  if (confirm && !(await confirmDialog(label, lines, output))) return null;
  setCfgBusy(true);
  const wasLive = live; live = false;
  while (liveRunning) await sleep(50);
  cfgMsg(`${label}: writing…`, '');
  let r = null;
  try {
    r = await cmd(n, data, { raw });
    if (raw){
      const s0 = r.status[0];
      if (s0 !== 0 && s0 !== 8 && s0 !== 14) throw Object.assign(new Error(r.rcText), { reply: r });
      if (s0) r.warning = r.rcText;
    }
    const res = r.warning ? `Done with warning: ${r.warning}.` : 'Done.';
    log(`WRITE ${label}: ${res}`);
    addChange(label, detail, res, r.warning ? 'warn' : 'ok');
    cfgMsg(`${label}: ${r.warning ? 'written with a warning: ' + r.warning : 'written'}${refresh ? '. Re-reading the device…' : '.'}`, r.warning ? 'warn' : 'ok');
    if (refresh){
      try { renderDevice(dev, await loadDetails()); cfgMsg(`${label}: written and re-read from the device. Check the values above.`, r.warning ? 'warn' : 'ok'); }
      catch(e){ log(e.message, 'er'); }
    }
  } catch(e){
    log(`WRITE ${label} failed: ${e.message}`, 'er');
    addChange(label, detail, `Failed: ${e.message.replace(/^Command \d+: /,'')}.`, 'bad');
    cfgMsg(`${label} failed: ${e.message.replace(/^Command \d+: /,'')}.`, 'bad');
    if (raw && e.reply) r = e.reply;
  }
  setCfgBusy(false);
  if (wasLive){ live = true; liveLoop(); }
  return r;
}

/* ----- Loop test ----- */
function setLoopFixed(v){
  loopFixed = v;
  $('fixedBanner').classList.toggle('hidden', v == null);
  if (v != null) $('fixedText').textContent = `Loop test: output fixed at ${fmt(v)} mA`;
}
async function setLoop(mA){
  if (!isFinite(mA) || mA < 3.5 || mA > 23) { cfgMsg('Enter a current between 3.5 and 23 mA.', 'bad'); return null; }
  const entering = loopFixed == null;
  const r = await runWrite({
    label: `Loop test ${fmt(mA)} mA`, n: 40, data: fbytes(mA), refresh: false, output: true, confirm: entering,
    lines: ['The 4–20 mA output will stop following the process and hold this value until you exit loop test.', `Output: ${fmt(mA)} mA`],
    detail: `Output fixed at ${fmt(mA)} mA.`
  });
  if (r){ const actual = f32(r.data, 0); setLoopFixed(isFinite(actual) ? actual : mA); }
  return r;
}
async function exitLoop(){
  const r = await runWrite({ label:'Exit loop test', n:40, data:fbytes(0), refresh:false, confirm:false, detail:'Output returned to normal.' });
  if (r){ setLoopFixed(null); resetTrim(); }
  return r;
}

/* ----- Trim wizard ----- */
function trimStage(stage){
  // stage: 0 start, 1 at 4 mA, 2 trimmed 4, 3 at 20 mA, 4 trimmed 20
  $('trLow').disabled = $('tr2').disabled = stage !== 1;
  $('tr3').disabled = stage !== 2;
  $('trHigh').disabled = $('tr4').disabled = stage !== 3;
  $('tr5').disabled = stage < 1;
}
function resetTrim(){ trimStage(0); $('trLow').value = ''; $('trHigh').value = ''; }
async function trimAt(target, inputId, n, nextStage){
  const m = num(inputId);
  if (!isFinite(m)) return cfgMsg('Enter the reading from your reference meter.', 'bad');
  const lines = [`Reference meter reading: ${m.toFixed(3)} mA`, `Target: ${target.toFixed(3)} mA`];
  if (Math.abs(m - target) > 0.5) lines.push('This reading is more than 0.5 mA from the target. Check the meter and wiring before trimming.');
  const r = await runWrite({ label:`Trim ${target} mA`, lines, n, data:fbytes(m), refresh:false, detail:`Reference read ${m.toFixed(3)} mA at ${target} mA.` });
  if (r) trimStage(nextStage);
}

/* ----- Sensor trim (Commands 50, 80, 81, 82, 83) ----- */
let st = null;
const TRIM_SUPPORT = {0:'Not supported',1:'Single point',2:'Upper point only',3:'Lower and upper points'};
// Device-specific sensor trim (profile.trim), e.g. Rosemount 644 rev 8: Cmds 142–146 per its FDS.
const profTrim = () => { const t = prof?.profile.trim; return t && dev && !isSim() && t.revs.includes(dev.devRev) ? t : null; };
async function readCustomTrim(t, units){
  const d = (await cmd(t.info, [t.sensor, units], { longBusy: true })).data;
  if (d.length < 19) throw new Error(`Unexpected Command ${t.info} reply`);
  return { mode: d[2], maxL: f32(d,3), minL: f32(d,7), upper: f32(d,11), lower: f32(d,15) };
}
async function checkSensorTrim(){
  if (!dev || cfgBusy) return;
  const t = profTrim();
  if (t){
    setCfgBusy(true); cfgMsg('Reading sensor trim…', ''); st = null; $('stBody').classList.add('hidden');
    try {
      const units = (await cmd(t.units, [t.sensor])).data[1];
      const i = await readCustomTrim(t, units);
      st = { custom: t, dv: t.sensor, support: 3, units, mode: i.mode, minL: i.minL, maxL: i.maxL, minU: i.minL, maxU: i.maxL,
             lastL: i.mode === 1 ? i.lower : NaN, lastU: i.mode === 1 ? i.upper : NaN, minDiff: NaN };
      renderSensorTrim();
      cfgMsg(`Sensor trim is available on this device (Commands ${t.info}–${t.units}). Currently using ${i.mode === 1 ? 'a user trim' : 'the factory trim'}.`, 'ok');
    } catch(e){ st = null; cfgMsg(`Sensor trim check failed: ${e.message.replace(/^Command \d+: /,'')}.`, 'bad'); }
    setCfgBusy(false);
    return;
  }
  setCfgBusy(true);
  cfgMsg('Checking sensor trim support…', '');
  st = null; $('stBody').classList.add('hidden');
  dvList = null; dvMap = null; $('dvBody').classList.add('hidden'); $('dvList').innerHTML = ''; $('dvLoad').textContent = 'Load';
  $('dvHint').textContent = 'Reads every device variable with its type, live value, status and limits (HART Commands 9, 50 and 54).';
  try {
    let pvDv = 0;
    try { const r50 = await cmd(50); pvDv = r50.data[0]; } catch(e){ log(`Command 50 not available, assuming device variable 0: ${e.message}`); }
    const g = (await cmd(81, [pvDv])).data;
    if (g.length < 23) throw new Error('Unexpected Command 81 reply');
    st = { dv: pvDv, support: g[1], units: g[2],
           minL: f32(g,3), maxL: f32(g,7), minU: f32(g,11), maxU: f32(g,15), minDiff: f32(g,19), lastL: NaN, lastU: NaN };
    try { const p = (await cmd(80, [pvDv])).data; if (p.length >= 10){ st.lastL = f32(p,2); st.lastU = f32(p,6); } } catch(e){ log(e.message, 'er'); }
    if (!st.support){ cfgMsg('The device reports that this variable cannot be sensor-trimmed.', 'bad'); st = null; }
    else { renderSensorTrim(); cfgMsg('Sensor trim is supported. Follow the steps below.', 'ok'); }
  } catch(e){
    st = null;
    const msg = /not implemented/i.test(e.message)
      ? `This device does not support the standard sensor trim commands. Use ${P.hostTool(dev.mfrId)}, or Zero PV for a zero offset if the device supports it.`
      : `Sensor trim check failed: ${e.message.replace(/^Command \d+: /,'')}.`;
    cfgMsg(msg, 'bad');
  }
  setCfgBusy(false);
}
function renderSensorTrim(){
  const u = unitName(st.units);
  document.querySelectorAll('.stU').forEach(e => e.textContent = u);
  const single = st.support === 1, hasLow = st.support === 1 || st.support === 3, hasHigh = st.support === 2 || st.support === 3;
  $('stLowLi').classList.toggle('hidden', !hasLow);
  $('stHighLi').classList.toggle('hidden', !hasHigh);
  $('stLowLbl').textContent = single ? 'Trim point' : 'Lower trim point';
  $('stLowBtn').textContent = single ? 'Trim' : 'Trim lower point';
  const rows = st.custom
    ? [['Sensor', st.dv + 1], ['Calibration mode', st.mode === 1 ? 'User trim' : st.mode === 0 ? 'Factory trim' : `Code ${st.mode}`]]
    : [['Device variable', st.dv], ['Trim points', TRIM_SUPPORT[st.support] ?? `Code ${st.support}`]];
  if (hasLow) rows.push([single ? 'Allowed range' : 'Lower point allowed', `${fmt(st.minL)} to ${fmt(st.maxL)} ${u}`], ['Last ' + (single ? 'trim point' : 'lower point'), isFinite(st.lastL) ? `${fmt(st.lastL)} ${u}` : '—']);
  if (hasHigh) rows.push(['Upper point allowed', `${fmt(st.minU)} to ${fmt(st.maxU)} ${u}`], ['Last upper point', isFinite(st.lastU) ? `${fmt(st.lastU)} ${u}` : '—']);
  if (st.support === 3 && isFinite(st.minDiff)) rows.push(['Minimum difference between points', `${fmt(st.minDiff)} ${u}`]);
  fillTable($('stInfo'), rows);
  if (hasLow && isFinite(st.lastL) && $('stLow').value === '') $('stLow').value = tidy(st.lastL);
  if (hasHigh && isFinite(st.lastU) && $('stHigh').value === '') $('stHigh').value = tidy(st.lastU);
  $('stBody').classList.remove('hidden');
}
async function customTrim(point){
  const t = st.custom, low = point === 1, u = unitName(st.units);
  const v = num(low ? 'stLow' : 'stHigh');
  if (!isFinite(v)) return cfgMsg('Enter the reference value from your calibrator.', 'bad');
  if (isFinite(st.minL) && isFinite(st.maxL) && (v < st.minL || v > st.maxL)) return cfgMsg(`That value is outside the sensor trim limits (${fmt(st.minL)} to ${fmt(st.maxL)} ${u}).`, 'bad');
  const other = low ? st.lastU : st.lastL;
  if (st.mode === 1 && isFinite(other) && (low ? v >= other : v <= other))
    return cfgMsg(`The ${low ? 'lower' : 'upper'} point must be ${low ? 'below' : 'above'} the ${low ? 'upper' : 'lower'} trim point (${fmt(other)} ${u}).`, 'bad');
  const name = `Sensor trim ${low ? 'lower' : 'upper'} point`;
  const lines = [`Reference value: ${fmt(v)} ${u}`, `Live reading before trim: ${$('stLive').textContent}`,
    'The device corrects its sensor reading to match the reference. The output will shift to suit.',
    'Use two points well apart, near the ends of the range you use. If the correction is too large, the device rejects it and returns to factory trim.'];
  if (st.mode !== 1) lines.push(`The calibration mode is changed to User trim first (Command ${t.mode}).`);
  if (!(await confirmDialog(name, lines, true))) return;
  if (st.mode !== 1){
    const m = await runWrite({ label:'Set calibration mode to User trim', n:t.mode, data:[t.sensor, 1], refresh:false, confirm:false, detail:'Calibration mode: User trim.' });
    if (!m) return;
    st.mode = 1;
  }
  const r = await runWrite({ label:name, n: low ? t.lower : t.upper, data:[t.sensor, st.units, ...fbytes(v)], output:true, refresh:false, confirm:false,
    detail:`Reference ${fmt(v)} ${u}, reading before trim ${$('stLive').textContent}.` });
  if (!r) return;
  // The trim takes up to 30 s; Command 48 byte 2 then reports whether it was rejected (FDS section 7.3).
  cfgMsg(`${name}: applying (can take up to 30 seconds)…`, '');
  setCfgBusy(true);
  try {
    const s = (await cmd(48, [], { longBusy: true })).data;
    const i = await readCustomTrim(t, st.units);
    Object.assign(st, { mode: i.mode, lastL: i.mode === 1 ? i.lower : NaN, lastU: i.mode === 1 ? i.upper : NaN });
    renderSensorTrim();
    if (s.length > 2 && (s[2] & 0x18)){
      const why = s[2] & 0x10 ? 'the trim failed' : 'the correction was too large';
      addChange(name, 'Rejected by the device', `Rejected: ${why}. Device returned to ${i.mode === 1 ? 'user' : 'factory'} trim.`, 'bad');
      cfgMsg(`${name}: the device reports ${why}${i.mode === 1 ? '' : ' and has returned to factory trim'}. Check the reference value and that the two points are well apart.`, 'bad');
    } else cfgMsg(`${name}: done. Check the live reading now matches your calibrator.`, 'ok');
  } catch(e){ log(e.message, 'er'); cfgMsg(`${name}: written, but the result could not be read back: ${e.message.replace(/^Command \d+: /,'')}.`, 'warn'); }
  setCfgBusy(false);
}
async function sensorTrim(point){
  if (!st) return;
  if (st.custom) return customTrim(point);
  const low = point === 1, u = unitName(st.units);
  const v = num(low ? 'stLow' : 'stHigh');
  if (!isFinite(v)) return cfgMsg('Enter the reference value from your calibrator.', 'bad');
  const [mn, mx] = low ? [st.minL, st.maxL] : [st.minU, st.maxU];
  if (isFinite(mn) && isFinite(mx) && (v < mn || v > mx)) return cfgMsg(`That value is outside the device's allowed range (${fmt(mn)} to ${fmt(mx)} ${u}).`, 'bad');
  const name = st.support === 1 ? 'Sensor trim' : `Sensor trim ${low ? 'lower' : 'upper'} point`;
  const r = await runWrite({ label:name, n:82, data:[st.dv, point, st.units, ...fbytes(v)], output:true, refresh:false,
    lines:[`Reference value: ${fmt(v)} ${u}`, `Live reading before trim: ${$('stLive').textContent}`,
           'The device will correct its sensor reading to match the reference. The output will shift to suit.'],
    detail:`Reference ${fmt(v)} ${u}, reading before trim ${$('stLive').textContent}.` });
  if (r){
    try { const p = (await cmd(80, [st.dv])).data; if (p.length >= 10){ st.lastL = f32(p,2); st.lastU = f32(p,6); } } catch(e){}
    renderSensorTrim();
    cfgMsg(`${name}: done. Check the live reading now matches your calibrator.`, 'ok');
  }
}
async function resetSensorTrim(){
  if (!st) return;
  if (st.custom){
    const r = await runWrite({ label:'Restore factory sensor trim', n:st.custom.mode, data:[st.custom.sensor, 0], output:true, refresh:false,
      lines:['The calibration mode is set to Factory trim. User trim points are ignored and the factory calibration is used.'],
      detail:'Calibration mode: Factory trim.' });
    if (r){ $('stLow').value = ''; $('stHigh').value = ''; await checkSensorTrim(); }
    return;
  }
  const r = await runWrite({ label:'Restore factory sensor trim', n:83, data:[st.dv], output:true, refresh:false,
    lines:['All sensor trim adjustments made in the field are removed and the factory calibration is restored.'],
    detail:'Sensor trim reset to factory.' });
  if (r){ $('stLow').value = ''; $('stHigh').value = ''; await checkSensorTrim(); }
}

/* ----- Button handlers ----- */
function bindWrites(){
  $('wTag').onclick = () => {
    const tag = $('fTag').value.toUpperCase(), desc = $('fDesc').value.toUpperCase(), date = $('fDate').value;
    if (!packedOk(tag) || !packedOk(desc)) return cfgMsg('Tag and descriptor can only use uppercase letters, numbers, spaces and basic symbols.', 'bad');
    if (!date) return cfgMsg('Pick a date.', 'bad');
    const [y, m, d] = date.split('-').map(Number);
    if (y < 1900 || y > 2155) return cfgMsg('The date must be between 1900 and 2155.', 'bad');
    runWrite({ label:'Write tag, descriptor and date', n:18,
      data:[...packAscii(tag,6), ...packAscii(desc,12), d, m, y - 1900],
      lines:[`Tag: ${lastDet?.tag ?? ''} → ${tag}`, `Descriptor: ${lastDet?.desc ?? ''} → ${desc}`, `Date: ${lastDet?.date ?? ''} → ${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`],
      detail:`Tag ${lastDet?.tag ?? ''} → ${tag}. Descriptor ${lastDet?.desc ?? ''} → ${desc}.` });
  };
  $('wLongTag').onclick = () => {
    const s = $('fLongTag').value;
    if ([...s].some(c => c.charCodeAt(0) > 255)) return cfgMsg('The long tag contains characters HART cannot store.', 'bad');
    runWrite({ label:'Write long tag', n:22, data:latin1Bytes(s, 32), lines:[`${lastDet?.longTag ?? ''} → ${s}`], detail:`Long tag ${lastDet?.longTag ?? ''} → ${s}.` });
  };
  $('wMsg').onclick = () => {
    const s = $('fMsg').value.toUpperCase();
    if (!packedOk(s)) return cfgMsg('The message can only use uppercase letters, numbers, spaces and basic symbols.', 'bad');
    runWrite({ label:'Write message', n:17, data:packAscii(s, 24), lines:[`${lastDet?.msg ?? ''} → ${s}`], detail:`Message → ${s}.` });
  };
  $('wRange').onclick = () => {
    const u = +$('fUnits').value, lrv = num('fLrv'), urv = num('fUrv');
    if (!isFinite(lrv) || !isFinite(urv)) return cfgMsg('Enter both range values.', 'bad');
    if (lrv === urv) return cfgMsg('The upper and lower range values cannot be the same.', 'bad');
    const r = lastDet?.range, ou = r ? unitName(r.units) : '';
    const lines = [
      `LRV (4 mA): ${r ? fmt(r.lrv) + ' ' + ou : '?'} → ${fmt(lrv)} ${unitName(u)}`,
      `URV (20 mA): ${r ? fmt(r.urv) + ' ' + ou : '?'} → ${fmt(urv)} ${unitName(u)}`
    ];
    if (urv < lrv) lines.push('URV is below LRV, so the output will be reverse-acting.');
    runWrite({ label:'Write range', n:35, data:[u, ...fbytes(urv), ...fbytes(lrv)], output:true, lines,
      detail:`Range ${r ? fmt(r.lrv) + '–' + fmt(r.urv) + ' ' + ou : '?'} → ${fmt(lrv)}–${fmt(urv)} ${unitName(u)}.` });
  };
  $('wUnits').onclick = () => {
    const u = +$('fUnits').value, r = lastDet?.range;
    runWrite({ label:'Change PV units', n:44, data:[u], lines:[`${r ? unitName(r.units) : '?'} → ${unitName(u)}`, 'The range is converted to the new units. The output does not change.'],
      detail:`PV units ${r ? unitName(r.units) : '?'} → ${unitName(u)}.` });
  };
  $('wDamp').onclick = () => {
    const v = num('fDamp');
    if (!isFinite(v) || v < 0) return cfgMsg('Enter a damping value of 0 seconds or more.', 'bad');
    const r = lastDet?.range;
    runWrite({ label:'Write damping', n:34, data:fbytes(v), lines:[`${r ? fmt(r.damping) : '?'} s → ${fmt(v)} s`], detail:`Damping ${r ? fmt(r.damping) : '?'} s → ${fmt(v)} s.` });
  };
  document.querySelectorAll('[data-ma]').forEach(b => b.onclick = () => setLoop(Number(b.dataset.ma)));
  $('wLoopCustom').onclick = () => setLoop(num('fLoopMa'));
  $('wLoopExit').onclick = () => { if (loopFixed == null) return cfgMsg('Loop test is not active.', ''); exitLoop(); };
  $('btnBannerExit').onclick = exitLoop;

  $('tr1').onclick = async () => { if (await setLoop(4)) trimStage(1); };
  $('tr2').onclick = () => trimAt(4, 'trLow', 45, 2);
  $('tr3').onclick = async () => { if (await setLoop(20)) trimStage(3); };
  $('tr4').onclick = () => trimAt(20, 'trHigh', 46, 4);
  $('tr5').onclick = exitLoop;

  $('dvLoad').onclick = loadDeviceVariables;
  $('dmWrite').onclick = writeDvMapping;
  $('stCheck').onclick = checkSensorTrim;
  $('stLowBtn').onclick = () => sensorTrim(1);
  $('stHighBtn').onclick = () => sensorTrim(2);
  $('stReset').onclick = resetSensorTrim;
  $('wZero').onclick = () => { const t = kindText(measKind().kind); runWrite({ label:'Zero PV', n:43, output:true,
    lines:t.zero, detail:`PV zeroed at the ${t.now.replace(/ right now$/, '')}.` }); };
  $('wSetLrv').onclick = () => { const t = kindText(measKind().kind); runWrite({ label:'Set LRV to applied', n:37, output:true,
    lines:[`The ${t.now} becomes the 4 mA point.`, 'The span is kept the same, so the URV moves too.'], detail:`LRV set to the ${t.now.replace(/ right now$/, '')}.` }); };
  $('wSetUrv').onclick = () => { const t = kindText(measKind().kind); runWrite({ label:'Set URV to applied', n:36, output:true,
    lines:[`The ${t.now} becomes the 20 mA point.`, 'The LRV stays where it is.'], detail:`URV set to the ${t.now.replace(/ right now$/, '')}.` }); };

  $('wPoll').onclick = async () => {
    const a = +$('fPoll').value, on = $('fLoopMode').checked;
    const lines = [`Poll address: ${dev.poll} → ${a}`];
    if (!on) lines.push('The 4–20 mA output will be parked at 4 mA (multidrop).');
    const r = await runWrite({ label:'Write poll address', n:6, data: dev.rev >= 6 ? [a, on ? 1 : 0] : [a], output: !on, lines,
      detail:`Poll address ${dev.poll} → ${a}${on ? '' : ', output parked'}.` });
    if (r){ dev.poll = a; $('addr').value = Math.min(a, 15); }
  };
  $('wClearCfg').onclick = async () => {
    let data = [];
    if (dev.rev >= 7){
      try { const r0 = await cmd(0); data = [r0.data[14], r0.data[15]]; }
      catch(e){ return cfgMsg(`Could not read the change counter: ${e.message}`, 'bad'); }
    }
    runWrite({ label:'Clear configuration changed flag', n:38, data, confirm:false, detail:'Flag acknowledged.' });
  };
  $('wReset').onclick = async () => {
    const poll = dev.poll;
    const r = await runWrite({ label:'Restart device', n:42, output:true, refresh:false,
      lines:['The transmitter will reboot. Its output may go to the alarm level during start-up.'], detail:'Device restarted.' });
    if (r){
      setLoopFixed(null); resetTrim();
      cfgMsg('Device is restarting. Reconnecting in a few seconds…', 'warn');
      await sleep(6000);
      await connectDevice(poll);
    }
  };
  $('btnHistShare').onclick = async () => {
    const head = `HART changes: ${lastDet?.longTag || lastDet?.tag || ''} (device ID ${dev?.devId ?? '—'})`;
    const text = [head, ...changes.map(c => `${c.t.toLocaleString()}  ${c.label}. ${c.detail} ${c.result}`)].join('\n');
    try { if (navigator.share) return await navigator.share({ title:'HART changes', text }); } catch(e){ if (e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text); $('btnHistShare').textContent = 'Copied'; }
    catch(e){ $('btnHistShare').textContent = 'Blocked'; }
    setTimeout(() => $('btnHistShare').textContent = 'Share', 2500);
  };
  window.addEventListener('beforeunload', e => { if (loopFixed != null){ e.preventDefault(); e.returnValue = ''; } });
}
bindWrites();

/* ================= Device variables (Commands 9, 50, 51, 54) ================= */
const DV_CLASS = {0:'Not classified',64:'Temperature',65:'Pressure',66:'Volumetric flow',67:'Velocity',68:'Volume',69:'Length',
  70:'Time',71:'Mass',72:'Mass flow',73:'Density',74:'Viscosity',75:'Angular velocity',76:'Area',77:'Energy',78:'Force',
  79:'Power',80:'Frequency',81:'Analytical'};
const DV_QUALITY = ['bad','uncertain','fixed','good'];
const DV_QUALITY_TEXT = {bad:'Bad',uncertain:'Uncertain',fixed:'Fixed or manual',good:'Good'};
const DV_LIMIT = ['','Low limited','High limited','Constant'];
const SLOT = ['PV','SV','TV','QV'];
let dvList = null, dvMap = null, dvBatch = 0;

async function loadDeviceVariables(){
  if (!dev || cfgBusy) return;
  setCfgBusy(true); $('dvLoad').disabled = true;
  const wasLive = live; live = false;
  while (liveRunning) await sleep(50);
  const n = Math.min(dev.nVars ?? 8, 240);
  const list = [];
  try {
    try { dvMap = Array.from((await cmd(50)).data.slice(0,4)); } catch(e){ dvMap = null; log(e.message, 'er'); }
    for (let c = 0; c < n; c++){
      $('dvHint').textContent = `Reading device variable ${c + 1} of ${n}…`;
      try {
        const d = (await cmd(54, [c], { quiet:true })).data;
        if (d.length < 22) continue;
        list.push({ code:c, serial:(d[1]<<16)|(d[2]<<8)|d[3], limUnits:d[4], usl:f32(d,5), lsl:f32(d,9),
          damping:f32(d,13), minSpan:f32(d,17), cls:d[21], family:d[22] ?? null });
      } catch(e){
        if (/not implemented/i.test(e.message)){ throw new Error('This device does not support Command 54 (device variable information).'); }
        log(`DV ${c}: ${e.message}`);   // usually "Invalid selection" for unused codes
      }
    }
    dvList = list;
    const pvDv = dvMap ? list.find(v => v.code === dvMap[0]) : null;
    if (pvDv && pvDv.cls !== pvClass){ pvClass = pvDv.cls; applyKind(); renderSensor(); renderDevice2(); }
    renderDvList();
    await readDvValues(true);
    $('dvHint').textContent = `${list.length} device variable${list.length === 1 ? '' : 's'}. Names come from the manufacturer's DD, so variables are shown by number and type.`;
    $('dvLoad').textContent = 'Reload';
  } catch(e){
    $('dvHint').textContent = e.message.replace(/^Command \d+: /,'');
  }
  $('dvLoad').disabled = false; setCfgBusy(false);
  if (wasLive){ live = true; liveLoop(); }
}

function dvLabel(v){ return `DV ${v.code}: ${DV_CLASS[v.cls] ?? 'Class ' + v.cls}`; }

function renderDvList(){
  const ul = $('dvList'); ul.innerHTML = '';
  dvList.forEach(v => {
    const li = document.createElement('li'); li.id = `dv-${v.code}`;
    const mapped = dvMap ? dvMap.map((c, i) => c === v.code ? SLOT[i] : null).filter(Boolean) : [];
    li.innerHTML = `<div class="dvtop"><span class="dvname"></span><span class="dvval">—</span></div><div class="dvstat">Not read yet</div>
      <details><summary>Limits and details</summary><table></table></details>`;
    const nm = li.querySelector('.dvname'); nm.textContent = dvLabel(v);
    mapped.forEach(m => { const b = document.createElement('span'); b.className = 'dvmap'; b.textContent = m; nm.appendChild(b); });
    const u = unitName(v.limUnits);
    fillTable(li.querySelector('table'), [
      ['Upper sensor limit', `${fmt(v.usl)} ${u}`], ['Lower sensor limit', `${fmt(v.lsl)} ${u}`],
      ['Minimum span', `${fmt(v.minSpan)} ${u}`], ['Damping', `${fmt(v.damping)} s`],
      ['Sensor serial number', v.serial || '—']
    ]);
    ul.appendChild(li);
  });
  // Mapping selects
  ['dmPV','dmSV','dmTV','dmQV'].forEach((id, i) => {
    const sel = $(id); sel.innerHTML = '';
    const add = (val, text) => { const o = document.createElement('option'); o.value = val; o.textContent = text; sel.appendChild(o); };
    if (i > 0) add(250, 'Not used');
    dvList.forEach(v => add(v.code, dvLabel(v)));
    if (dvMap){
      if (![...sel.options].some(o => +o.value === dvMap[i])) add(dvMap[i], `Code ${dvMap[i]}`);
      sel.value = dvMap[i];
    }
  });
  $('dmWrite').disabled = !dvMap;
  $('dvBody').classList.remove('hidden');
}

function applyDvValues(data, count){
  for (let k = 0; k < count; k++){
    const o = 1 + k * 8;
    if (o + 8 > data.length) break;
    const code = data[o], units = data[o+2], val = f32(data, o+3), st = data[o+7];
    const li = $(`dv-${code}`); if (!li) continue;
    const q = DV_QUALITY[(st >> 6) & 3], lim = DV_LIMIT[(st >> 4) & 3];
    li.className = q;
    li.querySelector('.dvval').textContent = isFinite(val) ? `${fmt(val)} ${unitName(units)}` : 'Not available';
    li.querySelector('.dvstat').textContent = [DV_QUALITY_TEXT[q], lim, st & 0x08 ? 'More status available' : ''].filter(Boolean).join(', ');
  }
}

// Reads one batch (or all, if all=true). HART 7 allows 8 variables per Command 9, HART 6 allows 4.
async function readDvValues(all, quiet=true){
  if (!dvList || !dvList.length) return;
  const per = dev.rev >= 7 ? 8 : 4, batches = Math.ceil(dvList.length / per);
  const run = async b => {
    const codes = dvList.slice(b * per, b * per + per).map(v => v.code);
    try { applyDvValues((await cmd(9, codes, { quiet })).data, codes.length); }
    catch(e){ log(`Command 9: ${e.message}`, 'er'); }
  };
  if (all){ for (let b = 0; b < batches; b++) await run(b); }
  else { dvBatch = (dvBatch + 1) % batches; await run(dvBatch); }
}

async function writeDvMapping(){
  const next = ['dmPV','dmSV','dmTV','dmQV'].map(id => +$(id).value);
  if (!dvMap) return;
  const name = c => { const v = dvList.find(x => x.code === c); return c === 250 ? 'Not used' : v ? dvLabel(v) : `Code ${c}`; };
  const lines = SLOT.map((s, i) => `${s}: ${name(dvMap[i])}${next[i] !== dvMap[i] ? ' → ' + name(next[i]) : ' (unchanged)'}`);
  const pvChanged = next[0] !== dvMap[0];
  const r = await runWrite({ label:'Write variable mapping', n:51, data:next, output:pvChanged, lines,
    detail: SLOT.map((s, i) => `${s} ${name(dvMap[i])}${next[i] !== dvMap[i] ? ' → ' + name(next[i]) : ''}`).join(', ') + '.' });
  if (r){
    try { dvMap = Array.from((await cmd(50)).data.slice(0,4)); } catch(e){}
    renderDvList(); await readDvValues(true);
  }
}

/* ================= Device profiles (profiles.js) ================= */
const P = window.HARTProfiles, H = window.HART;
let prof = null;         // { profile, revision, documented } for the connected device
let snRead = null;       // last sensor configuration reply data

// Some makers' software shows Command 16 (final assembly number) as the transmitter serial number.
// Only for profiles where that was checked against the manufacturer's software.
function devIdLabel(info){
  const m = P.match({ manufacturerId: info.mfrId, deviceType: info.devType, deviceRevision: info.devRev });
  return m?.profile.deviceIdLabel || 'Device ID';
}
function fanLabel(info){
  const m = P.match({ manufacturerId: info.mfrId, deviceType: info.devType, deviceRevision: info.devRev });
  return m?.profile.finalAssemblyIsSerial ? 'Serial number (final assembly)' : 'Final assembly number';
}

const isSim = () => !!transport?.isSim;
const parseHex = s => {
  const t = String(s || '').replace(/0x/gi, '').replace(/[^0-9a-f]/gi, '');
  if (t.length % 2) return null;
  return t.match(/../g)?.map(h => parseInt(h, 16)) ?? [];
};

function renderProfile(info){
  prof = P.match({ manufacturerId: info.mfrId, deviceType: info.devType, deviceRevision: info.devRev });
  const card = $('profCard');
  if (!prof){
    card.classList.remove('hidden');
    $('profTitle').textContent = 'No device profile';
    $('profBody').textContent = 'This device is handled with HART universal and common-practice commands only. Device-specific functions need a profile built from the manufacturer\'s Field Device Specification or a capture.';
    $('profFlags').innerHTML = '';
  } else {
    const p = prof.profile, rev = prof.revision;
    card.classList.remove('hidden');
    $('profTitle').textContent = p.model;
    $('profBody').textContent = p.fds;
    const flags = [];
    if (p.suspect && p.captured?.[info.devRev]) flags.push([rev?.note || `Device revision ${info.devRev}: reads decoded from a capture and checked against the manufacturer's software. The specification on hand is not genuine, so nothing else device-specific is used.`, 'warn']);
    else if (p.suspect) flags.push(['The specification for this model is not genuine. Device-specific data is unverified.', 'bad']);
    else if (!rev) flags.push([`Device revision ${info.devRev} is not covered by the specification on hand.`, 'warn']);
    else if (!rev.documented) flags.push([rev.note || `Device revision ${info.devRev} is not documented.`, 'warn']);
    else flags.push([`Device revision ${info.devRev} (HART ${rev.hart}) matches the specification.`, 'ok']);
    if (p.sensor) flags.push([`Sensor setup: read Command ${p.sensor.read}, write Command ${p.sensor.write}. See Tools.`, '']);
    if (isSim()) flags.push(['Simulated device. Its device-specific layout is for practice only.', 'warn']);
    $('profFlags').innerHTML = flags.map(([t, c]) => `<li class="${c}">${esc(t)}</li>`).join('');
  }
  renderSensor();
  renderConsole();
}

/* ================= Temperature sensor setup ================= */
function snMsg(text, cls){ const n = $('snNote'); n.textContent = text; n.className = 'cfgnote ' + (cls || ''); n.classList.toggle('hidden', !text); }
// Built-in layout from the profile (real devices only; the simulator has its own layout), otherwise a learned one.
const snTemplate = () => {
  if (!prof?.profile.sensor) return null;
  const b = !isSim() && prof.profile.sensorLayout?.[dev.devRev];
  return b ? { ...b, profileId: prof.profile.id, devRev: dev.devRev } : P.templates.get(prof.profile.id, dev.devRev, isSim());
};

function renderSensor(){
  const card = $('snCard');
  if (!dev){ card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  const p = prof?.profile;
  const has = !!p?.sensor;
  $('snNone').classList.toggle('hidden', has);
  $('snBody').classList.toggle('hidden', !has);
  const { kind } = measKind();
  $('snTitle').textContent = kind === 'temperature' || has ? 'Temperature sensor setup' : 'Sensor setup';
  if (!has){
    // Only temperature inputs have a sensor type and wiring to set; hide the card for anything else.
    if (kind && kind !== 'temperature' && kind !== 'electrical'){ card.classList.add('hidden'); return; }
    $('snNone').textContent = 'There is no sensor setup profile for this device. Sensor type and wiring are set with manufacturer-specific commands, so a profile needs the manufacturer\'s Field Device Specification or a capture.';
    return;
  }
  $('snNoTpl').textContent = `The byte layout for this command isn't set yet, so writing is locked. Record ${P.hostTool(dev.mfrId)} changing the sensor type and open the capture in the Capture tab, or enter the layout from the Field Device Specification under "Enter layout by hand".`;
  $('snModel').textContent = `${p.model}, device revision ${dev.devRev}`;
  // Sensor type options
  const sel = $('snType'), cur = sel.value;
  sel.innerHTML = '';
  [['rtd', 'RTD and ohms'], ['tc', 'Thermocouple and millivolts']].forEach(([k, label]) => {
    const og = document.createElement('optgroup'); og.label = label;
    p.sensor.types.filter(t => t[2] === k).forEach(([code, name]) => { const o = document.createElement('option'); o.value = code; o.textContent = `${name} (code ${code})`; og.appendChild(o); });
    sel.appendChild(og);
  });
  if (cur !== '') sel.value = cur;
  const w = $('snWire'); if (!w.options.length) P.CONNECTIONS.forEach(([c, n]) => { const o = document.createElement('option'); o.value = c; o.textContent = n; w.appendChild(o); });
  syncWire();

  const t = snTemplate();
  const rows = [['Read command', p.sensor.read], ['Write command', p.sensor.write]];
  if (t){
    rows.push(['Byte layout', t.source === 'builtin' ? 'Built in (Field Device Specification, confirmed on hardware)' : t.source === 'capture' ? `Learned from a capture, ${new Date(t.savedAt).toLocaleDateString()}` : `Entered by hand, ${new Date(t.savedAt).toLocaleDateString()}`]);
    rows.push(['Sensor type / wiring byte (write)', `${t.typeIdx} / ${t.connIdx ?? '—'}`]);
    if (t.readTypeIdx != null) rows.push(['Sensor type / wiring byte (read)', `${t.readTypeIdx} / ${t.readConnIdx ?? '—'}`]);
  } else rows.push(['Byte layout', 'Not set yet']);
  fillTable($('snInfo'), rows);
  $('snNoTpl').classList.toggle('hidden', !!t);
  $('snTplClear').classList.toggle('hidden', !t || t.source === 'builtin');
  $('snWrite').disabled = !t || !snRead;
  $('snPreview').disabled = !t || !snRead;
  renderSnRead();
}

function syncWire(){
  const p = prof?.profile; if (!p?.sensor) return;
  const t = p.sensor.types.find(x => x[0] === +$('snType').value);
  $('snWire').disabled = t?.[2] === 'tc';
  $('snWireHint').classList.toggle('hidden', t?.[2] !== 'tc');
}

function renderSnRead(){
  const box = $('snRead');
  if (!snRead){ box.innerHTML = '<p class="hint">Not read yet.</p>'; return; }
  const t = snTemplate(), p = prof.profile;
  let html = `<div class="bytes">${snRead.map((b, i) => `<span title="Byte ${i}">${b.toString(16).toUpperCase().padStart(2, '0')}<small>${i}</small></span>`).join('')}</div>`;
  if (t && t.readTypeIdx != null && snRead.length > t.readTypeIdx){
    const ty = snRead[t.readTypeIdx], cn = t.readConnIdx != null ? snRead[t.readConnIdx] : null;
    html += `<table class="kv"><tr><td>Sensor type</td><td>${esc(P.sensorName(p, ty))}</td></tr>${cn != null ? `<tr><td>Wiring</td><td>${esc(P.connName(cn))}</td></tr>` : ''}</table>`;
  } else {
    const c = P.candidates(p, snRead);
    html += `<p class="hint">The byte layout isn't set, so the reply is shown raw. Bytes that could be a sensor type: ${c.type.map(i => `${i} (${esc(P.sensorName(p, snRead[i]))})`).join(', ') || 'none'}. Learn the layout from a capture in the Capture tab.</p>`;
  }
  box.innerHTML = html;
}

async function pauseLive(fn){
  const wasLive = live; live = false;
  while (liveRunning) await sleep(50);
  try { return await fn(); }
  finally { if (wasLive && dev){ live = true; liveLoop(); } }
}

async function readSensor(){
  const p = prof?.profile; if (!p?.sensor || !dev) return;
  const t = snTemplate();
  $('snReadBtn').disabled = true; snMsg('Reading sensor setup…');
  try {
    const r = await pauseLive(() => cmd(p.sensor.read, t?.readReq || [], { raw:true }));
    if (r.status[0] && r.status[0] !== 8){
      snRead = null;
      snMsg(`The device answered Command ${p.sensor.read} with "${r.rcText}". ${r.status[0] === 5 ? 'It expects request data, so the layout has to come from a capture or the FDS.' : ''}`, 'bad');
    } else {
      snRead = Array.from(r.data);
      snMsg(`Read ${snRead.length} bytes with Command ${p.sensor.read}.`, 'ok');
    }
  } catch(e){ snRead = null; snMsg(e.message, 'bad'); }
  $('snReadBtn').disabled = false;
  renderSensor();
}

function buildSensorWrite(){
  const t = snTemplate(), p = prof.profile;
  const type = +$('snType').value, kind = p.sensor.types.find(x => x[0] === type)?.[2];
  const base = t.mirror ? [...snRead] : [...t.writeBase];
  if (t.typeIdx >= base.length) throw new Error('The stored layout does not fit the current reply. Learn it again.');
  base[t.typeIdx] = type;
  if (t.connIdx != null && kind === 'rtd') base[t.connIdx] = +$('snWire').value;
  return base;
}

function previewSensor(){
  try {
    const data = buildSensorWrite(), n = prof.profile.sensor.write;
    $('snBytes').textContent = `Command ${n}, data: ${hex(data)}\nFrame: ${hex(frame(0x82, dev.longAddr, n, data))}`;
    $('snBytes').classList.remove('hidden');
    snMsg(`Dry run: nothing was sent. Compare these bytes with a capture of ${P.hostTool(dev.mfrId)} making the same change.`, '');
  } catch(e){ snMsg(e.message, 'bad'); }
}

async function writeSensor(){
  const p = prof.profile, t = snTemplate();
  let data; try { data = buildSensorWrite(); } catch(e){ return snMsg(e.message, 'bad'); }
  const type = +$('snType').value, kind = p.sensor.types.find(x => x[0] === type)?.[2];
  const before = t.readTypeIdx != null && snRead ? P.sensorName(p, snRead[t.readTypeIdx]) : 'unknown';
  const lines = [
    `Sensor type: ${before} → ${P.sensorName(p, type)}`,
    kind === 'rtd' && t.connIdx != null ? `Wiring: ${P.connName(+$('snWire').value)}` : 'Wiring: unchanged',
    `Command ${p.sensor.write} data: ${hex(data)}`,
    'Changing the sensor type can reset the sensor trim, units and range. Check them afterwards.',
  ];
  if (t.source === 'manual') lines.push('This layout was entered by hand, not learned from a capture. Check the bytes against the FDS.');
  const r = await runWrite({ label:'Write sensor setup', n:p.sensor.write, data, output:true, lines,
    detail:`Sensor ${before} → ${P.sensorName(p, type)}.` });
  if (r){
    await readSensor();
    snMsg(r.warning
      ? `Sensor setup written. The device returned a warning (response code ${r.status[0]}), which the FDS uses to flag that trim, units or range were reset. Read back above. Check range, units and trim on the Device tab.`
      : 'Sensor setup written and read back above. Check range, units and trim on the Device tab.', r.warning ? 'warn' : 'ok');
  }
}

function saveManualTemplate(){
  const p = prof?.profile; if (!p?.sensor) return;
  const readReq = parseHex($('mtRead').value), writeBase = parseHex($('mtWrite').value);
  const typeIdx = parseInt($('mtType').value, 10), connIdx = $('mtConn').value === '' ? null : parseInt($('mtConn').value, 10);
  const rType = $('mtRType').value === '' ? null : parseInt($('mtRType').value, 10), rConn = $('mtRConn').value === '' ? null : parseInt($('mtRConn').value, 10);
  const mirror = $('mtMirror').checked;
  if (readReq == null || writeBase == null) return snMsg('Request bytes must be hex pairs, for example "00" or "01 04".', 'bad');
  if (!mirror && !writeBase.length) return snMsg('Enter the write data, or tick "write uses the read reply layout".', 'bad');
  if (!Number.isInteger(typeIdx)) return snMsg('Enter the byte number of the sensor type in the write data.', 'bad');
  P.templates.set({ profileId:p.id, devRev:dev.devRev, sim:isSim(), readReq, writeBase, typeIdx, connIdx, readTypeIdx:rType, readConnIdx:rConn,
    mirror, source:'manual', savedAt:Date.now() });
  snMsg('Layout saved for this device type and revision.', 'ok');
  renderSensor();
}

/* ================= Command console ================= */
// Commands that move the 4–20 mA output or restart the device, so they get the safety check.
const OUTPUT_CMDS = new Set([35, 36, 37, 40, 41, 42, 43, 45, 46, 47, 51, 79, 82, 83]);
const conHistory = [];

function renderConsole(){
  $('conCard').classList.toggle('hidden', !dev);
  const dl = $('conList');
  if (!dl.options.length || dl.dataset.prof !== (prof?.profile.id || '')){
    const all = { ...Object.fromEntries(Object.entries(H.COMMANDS).map(([n, c]) => [n, c.name])) };
    Object.entries(prof?.profile.commands || {}).forEach(([n, c]) => { all[n] = c.name; });
    dl.innerHTML = Object.entries(all).map(([n, name]) => `<option value="${n}">${esc(name)}</option>`).join('');
    dl.dataset.prof = prof?.profile.id || '';
  }
  conInfo();
}

function conInfo(){
  const n = parseInt($('conCmd').value, 10);
  if (!Number.isInteger(n)){ $('conWhat').textContent = 'Enter a command number from 0 to 255.'; return; }
  const d = H.describeCommand(n, prof?.profile);
  const rw = { r:'Read', w:'Write', x:'Action' }[d.rw] || 'Unknown effect, treated as a write';
  const layer = { universal:'Universal', common:'Common practice', device:'Device-specific', expansion:'Expansion', expanded:'Expanded', reserved:'Reserved' }[d.layer] || d.layer;
  $('conWhat').textContent = [d.name === layer ? null : d.name, layer, rw].filter(Boolean).join('. ') + '.';
}

async function sendConsole(){
  if (!dev) return;
  const n = parseInt($('conCmd').value, 10), data = parseHex($('conData').value);
  if (!Number.isInteger(n) || n < 0 || n > 255 || n === 31) return conOut('Enter a command number from 0 to 255 (31 is the expansion command and isn\'t sent directly).', 'bad');
  if (data == null) return conOut('Data must be hex byte pairs, for example "01 04" or "0104".', 'bad');
  const d = H.describeCommand(n, prof?.profile);
  let r;
  $('conSend').disabled = true;
  try {
    if (d.rw === 'r'){
      r = await pauseLive(() => cmd(n, data, { raw:true }));
    } else {
      r = await runWrite({ label:`Console: Command ${n}`, n, data, raw:true, refresh:false,
        output: OUTPUT_CMDS.has(n) || d.layer === 'device' || d.rw === '?',
        lines:[`${d.name} (Command ${n})`, `Data: ${data.length ? hex(data) : 'none'}`,
          d.rw === '?' ? 'The app doesn\'t know what this command does. Only send it if the device manual or FDS says it is safe.' : 'The device will act on this command.'],
        detail:`Command ${n} data ${data.length ? hex(data) : 'none'}.` });
      if (!r){ $('conSend').disabled = false; return conOut('Cancelled. Nothing was sent.', ''); }
    }
  } catch(e){ $('conSend').disabled = false; return conOut(e.message, 'bad'); }
  $('conSend').disabled = false;
  showConsoleReply(n, data, r, d);
}

function conOut(text, cls){ const n = $('conNote'); n.textContent = text; n.className = 'cfgnote ' + (cls || ''); n.classList.toggle('hidden', !text); }

function showConsoleReply(n, data, r, d){
  const s0 = r.status[0], ok = s0 === 0 || s0 === 8 || s0 === 14;
  const flags = H.statusText(r.status[1]);
  const dec = ok ? H.safeDecode(d.def?.rsp, Uint8Array.from(r.data)) : null;
  const lens = d.layer === 'device' && r.data.length >= 4 ? H.floatLens(Uint8Array.from(r.data)).slice(0, 6) : [];
  const fmtv = v => typeof v === 'number' && !Number.isInteger(v) ? +v.toPrecision(7) : (typeof v === 'object' ? JSON.stringify(v) : v);
  conOut('', '');
  const res = $('conResult');
  res.innerHTML = `<p class="conhead ${ok ? 'ok' : 'bad'}">Command ${n}: ${esc(r.rcText || 'OK')}</p>
    <table class="kv">
      <tr><td>Sent</td><td class="mono">${data.length ? hex(data) : 'no data'}</td></tr>
      <tr><td>Reply data</td><td class="mono">${r.data.length ? hex(r.data) : 'none'}</td></tr>
      <tr><td>Device status</td><td>${esc(flags.join(', ') || 'No flags')}</td></tr>
      ${dec ? Object.entries(dec).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(fmtv(v))}</td></tr>`).join('') : ''}
    </table>
    ${lens.length ? `<p class="hint">Possible floats in the reply: ${lens.map(x => `byte ${x.offset} = ${+x.value.toPrecision(6)}`).join(', ')}</p>` : ''}`;
  res.classList.remove('hidden');
  conHistory.unshift(`${new Date().toLocaleTimeString()}  ${n}  [${data.length ? hex(data) : '—'}]  →  ${r.rcText || 'OK'}  [${r.data.length ? hex(r.data) : '—'}]`);
  conHistory.length = Math.min(conHistory.length, 25);
  $('conHist').textContent = conHistory.join('\n');
  $('conHistWrap').classList.remove('hidden');
}

/* ================= Device report ================= */
// Reads the device afresh with universal and common-practice commands only, then hands a
// plain data object to report.js. No device-specific commands are sent from here.
const REPORT_FIELDS = [['rpSite','site',true],['rpLocation','location',false],['rpPurpose','purpose',true],['rpNotes','notes',false],['rpModel','nameplate',false]];
const rstore = { get(k){ try { return localStorage.getItem(k); } catch(e){ return null; } }, set(k,v){ try { localStorage.setItem(k,v); } catch(e){} } };
REPORT_FIELDS.forEach(([id, key, keep]) => { if (keep){ const v = rstore.get('hart-report-' + key); if (v != null) $(id).value = v; } });

function rptMsg(text, cls){ const n = $('rpNote'); n.textContent = text; n.className = 'cfgnote ' + (cls || ''); n.classList.toggle('hidden', !text); }

async function collectReport(){
  const info = dev, created = new Date();
  const det = await loadDetails();
  renderDevice(info, det);   // keep the Device tab in step with what the report shows
  const tryCmd = async (n, data=[]) => { try { return (await cmd(n, data, { quiet:true })).data; } catch(e){ log(`Report: ${e.message}`); return null; } };

  const job = {};
  REPORT_FIELDS.forEach(([id, key, keep]) => { job[key] = $(id).value.trim(); if (keep) rstore.set('hart-report-' + key, job[key]); });

  const mfr = MFR[info.mfrId] || `Manufacturer ${hx(info.mfrId)}`;
  const device = {
    mfr, model: prof?.profile.model?.replace(/^Rosemount\s+/, '') || null,
    devTypeHex: hx(info.devType, info.rev >= 7 ? 4 : 2), devId: info.devId, devIdDec: info.devIdDec, devIdLabel: devIdLabel(info), hartRev: info.rev,
    devRev: info.devRev, swRev: info.swRev, hwRev: info.hwRev, fan: det.fan, fanLabel: fanLabel(info), poll: info.poll,
    cfgCount: info.cfgCount, tag: det.tag, longTag: det.longTag, desc: det.desc, msg: det.msg, date: det.date
  };
  if (device.mfr && device.model && prof?.profile.model?.startsWith(device.mfr)) device.model = prof.profile.model.slice(device.mfr.length).trim();

  // Range and output (Command 15), loop current mode (Command 7, HART 6 and later)
  let range = null;
  if (det.range){
    const r = det.range;
    range = {
      unitsText: unitName(r.units), lrvText: fmt(r.lrv), urvText: fmt(r.urv), spanText: fmt(r.urv - r.lrv),
      dampingText: fmt(r.damping), transferText: TRANSFER[r.transfer] ?? `Code ${r.transfer}`,
      alarmText: ALARM[r.alarm] ?? `Code ${r.alarm}`, wpText: WRITEPROT[r.wp] ?? `Code ${r.wp}`
    };
    if (info.rev >= 6){
      const d7 = await tryCmd(7);
      if (d7 && d7.length >= 2) range.loopModeText = d7[1] === 0 ? 'Disabled (multidrop, fixed at 4 mA)' : 'Enabled (4–20 mA follows PV)';
    }
  }

  // Sensor (Command 14), plus the sensor setup from Tools when its layout is known
  let sensor = null;
  const d14 = await tryCmd(14);
  if (d14 && d14.length >= 16){
    const u = unitName(d14[3]), serial = (d14[0] << 16) | (d14[1] << 8) | d14[2];
    sensor = { serial: serial || null, unitsText: u, uslText: fmt(f32(d14,4)), lslText: fmt(f32(d14,8)), minSpanText: fmt(f32(d14,12)) };
  }
  if (prof?.profile.sensor){
    sensor = sensor || {};
    const t = snTemplate(), p = prof.profile;
    if (snRead && t && t.readTypeIdx != null && snRead.length > t.readTypeIdx){
      sensor.type = P.sensorName(p, snRead[t.readTypeIdx]);
      if (t.readConnIdx != null && snRead.length > t.readConnIdx) sensor.wiring = P.connName(snRead[t.readConnIdx]);
    } else {
      sensor.note = t ? 'Read the sensor setup under Tools to include sensor type and wiring.' : 'Sensor type and wiring are not included until the sensor setup layout is learned from a capture (see Tools).';
    }
  }

  // Process values (Command 3) with the PV/SV/TV/QV mapping (Command 50)
  let dyn = null;
  const d3 = await tryCmd(3);
  if (d3 && d3.length >= 4){
    const mA = f32(d3, 0);
    let map = null;
    if (info.rev >= 5){ const d50 = await tryCmd(50); if (d50 && d50.length >= 4) map = Array.from(d50.slice(0,4)); }
    const vars = [];
    for (let i = 0, o = 4; o + 5 <= d3.length && i < 4; i++, o += 5){
      const code = map ? map[i] : null;
      const v = dvList?.find(x => x.code === code);
      vars.push({ slot: SLOT[i], dv: code == null || code === 250 ? null : (v ? `DV ${v.code} · ${DV_CLASS[v.cls] ?? 'Class ' + v.cls}` : `DV ${code}`),
        valueText: fmt(f32(d3, o + 1)), unitsText: unitName(d3[o]),
        limits: v ? `${fmt(v.lsl)} to ${fmt(v.usl)} ${unitName(v.limUnits)}` : null });
    }
    let pctText = null;
    const d2 = await tryCmd(2);
    if (d2 && d2.length >= 8) pctText = fmt(f32(d2, 4));
    dyn = { at: new Date(), mAText: fmt(mA), pctText, vars,
      mapNote: map ? null : 'variable mapping not read' };
    if (!dvList) dyn.mapNote = 'sensor limits per variable appear once device variables are loaded on the Variables tab';
  }

  // Status (status byte from the last reply, extended status and Command 48)
  const s = lastDeviceStatus ?? 0, flags = [], ext = [];
  STATUS_BITS.forEach(([bit, t, sub, cls]) => { if (s & bit) flags.push({ title: t, sub, cls }); });
  const e = det.cmd48 && det.cmd48.length > 6 ? det.cmd48[6] : info.ext;
  if (e) EXT_BITS.forEach(([bit, t]) => { if (e & bit) ext.push({ title: t, sub: 'NAMUR NE 107 category', cls: bit & 0x0C ? 'bad' : 'warn' }); });
  const status = { flags, ext, cmd48: det.cmd48 && det.cmd48.some(b => b) ? hex(det.cmd48) : null };

  const modelCode = prof?.profile.noModelCode ? {
    notStored: true,
    note: `This device doesn't store its model code: ${P.hostTool(info.mfrId)} shows only "${prof.profile.noModelCode}".`
  } : {
    note: prof && (!prof.profile.suspect || prof.profile.captured)
      ? `${mfr} holds the full model code in manufacturer-specific commands, which are not mapped for device revision ${info.devRev} yet. Capture ${P.hostTool(info.mfrId)} opening Device Information on this revision to add them.`
      : 'The full model code is held in manufacturer-specific commands, which are not mapped for this device yet.'
  };

  // Device-specific reads decoded for this exact profile and device revision (profiles.js).
  // Only plain reads that need no request data, and never anything marked as a guess.
  const defs = prof ? P.trustedCommands(prof.profile, info.devRev) : {};
  const safeRead = n => { const c = defs[n]; return c && c.rw === 'r' && !c.req && c.rsp && c.confidence !== 'guess' ? c : null; };
  const readDecoded = async n => { const c = safeRead(n); if (!c) return null; const d = await tryCmd(+n); if (!d || !d.length) return null; try { return c.rsp(d); } catch(e){ log(`Report: Command ${n} decode failed: ${e.message}`); return null; } };
  const byName = re => Object.keys(defs).filter(n => re.test(defs[n].name) && safeRead(n)).sort((a, b) => +a - +b);
  const cmdsUsed = [];

  const models = [];
  for (const n of byName(/^Read model number \d/)){
    const v = await readDecoded(n); if (!v) continue;
    const [label, text] = Object.entries(v)[0];
    cmdsUsed.push(n);
    if (text && text !== '(blank)') models.push([label, text.trim()]);
  }
  if (models.length){
    modelCode.model = models[0][1];
    modelCode.lines = models.slice(1).map(([l, v]) => [l, v]);
    modelCode.firstLabel = models[0][0];
  }
  for (const n of byName(/^Read materials of construction/)){
    const v = await readDecoded(n); if (!v) continue;
    cmdsUsed.push(n);
    modelCode.materials = Object.entries(v)
      .filter(([k, x]) => x != null && !/not yet identified|possibly|configuration, range/i.test(k))
      .map(([k, x]) => { const s = String(x), unsure = /\?\s*$/.test(s);
        return { label: k.replace(/^\[[\d-]+\]\s*/, ''), value: s.replace(/\s*\?\s*$/, ''), unsure }; });
    modelCode.materialsPartial = defs[n].confidence === 'partial';
  }
  let alarms = null;
  for (const n of byName(/^Read alarm and saturation levels/)){
    const v = await readDecoded(n); if (!v) continue;
    cmdsUsed.push(n);
    alarms = Object.entries(v).filter(([k, x]) => /\(mA\)/.test(k) && typeof x === 'number' && isFinite(x)).map(([k, x]) => [k.replace(' (mA)', ''), `${fmt(x)} mA`]);
  }
  if (range && alarms?.length) range.alarmLevels = alarms;
  if (cmdsUsed.length) modelCode.source = `Commands ${cmdsUsed.join(', ')}, decoded from a capture of ${P.hostTool(info.mfrId)} on device revision ${info.devRev}${prof.revision?.documented ? '' : ' (not in the FDS on hand)'}`;

  return {
    meta: { created, appVersion: APP_VER, sim: isSim() },
    job, device, modelCode, range, sensor, dyn, status,
    changes: changes.map(c => ({ ...c }))
  };
}

async function createReport(){
  if (!dev || cfgBusy) return;
  if (!window.HARTReport) return rptMsg('The report module did not load. Reload the page.', 'bad');
  const btn = $('rpCreate'); btn.disabled = true;
  rptMsg('Reading the device for the report…');
  try {
    const data = await pauseLive(collectReport);
    const no = window.HARTReport.open(data);
    log(`Report ${no} created`);
    rptMsg(`Report ${no} is ready. Use "Save as PDF" and choose Save as PDF as the printer.`, 'ok');
  } catch(e){
    log(`Report failed: ${e.message}`, 'er');
    rptMsg(`The report could not be created: ${e.message}`, 'bad');
  }
  btn.disabled = false;
}

function bindTools(){
  $('rpCreate').onclick = createReport;
  $('snReadBtn').onclick = readSensor;
  $('snPreview').onclick = previewSensor;
  $('snWrite').onclick = writeSensor;
  $('snType').onchange = syncWire;
  $('snTplClear').onclick = () => { if (!prof) return; P.templates.remove(prof.profile.id, dev.devRev, isSim()); snMsg('Layout removed.', ''); renderSensor(); };
  $('mtSave').onclick = saveManualTemplate;
  $('conSend').onclick = sendConsole;
  $('conCmd').oninput = conInfo;
  $('conCmd').onkeydown = $('conData').onkeydown = e => { if (e.key === 'Enter') sendConsole(); };
}
bindTools();

// Bridge for capture.js
window.HARTApp = {
  traffic: () => traffic.slice(),
  isSim,
  device: () => dev,
  profile: () => prof,
  templatesChanged: () => renderSensor(),
  log,
};

/* ================= Wiring ================= */
for (let a = 0; a <= 15; a++){ const o = document.createElement('option'); o.value = a; o.textContent = a; $('addr').appendChild(o); }
$('btnConnect').onclick = connect;
$('btnDisc').onclick = disconnect;
$('btnScan').onclick = scan;
$('btnLive').onclick = () => {
  live = !live;
  $('btnLive').textContent = live ? 'Pause' : 'Resume';
  if (live) liveLoop(); else $('liveAge').textContent = 'Paused';
};
$('btnRefresh').onclick = async () => {
  if (!dev) return;
  const wasLive = live; live = false;
  while (liveRunning) await sleep(50);
  $('btnRefresh').disabled = true;
  try { renderDevice(dev, await loadDetails()); } catch(e){ log(e.message, 'er'); }
  $('btnRefresh').disabled = false;
  if (wasLive){ live = true; liveLoop(); }
};
$('btnClear').onclick = () => { logEl.innerHTML = ''; logLines.length = 0; };
$('btnCopy').onclick = async () => {
  const text = logLines.join('\n'), btn = $('btnCopy');
  const done = m => { btn.textContent = m; setTimeout(() => btn.textContent = 'Copy log', 2500); };
  try { await navigator.clipboard.writeText(text); return done('Copied'); } catch(e){}
  const ta = $('logText'); ta.value = text; ta.classList.remove('hidden');
  ta.focus(); ta.select(); ta.setSelectionRange(0, text.length);
  let ok = false; try { ok = document.execCommand('copy'); } catch(e){}
  if (ok) return done('Copied');
  $('copyHelp').classList.remove('hidden'); done('Copy blocked');
};
$('btnShare').onclick = async () => {
  try { await navigator.share({ title:'HART log', text:logLines.join('\n') }); }
  catch(e){ if (e.name !== 'AbortError'){ $('btnShare').textContent = 'Share blocked'; setTimeout(() => $('btnShare').textContent = 'Share log', 2500); } }
};
if (!navigator.share) $('btnShare').classList.add('hidden');
if ('usb' in navigator) navigator.usb.addEventListener('disconnect', e => { if (transport instanceof UsbSerialTransport && (!e.device || e.device === transport.dev)) lostConnection(); });
// Release the modem when the page closes, so Android doesn't keep a stale entry for it in the USB picker.
window.addEventListener('pagehide', () => { try { transport?.close(); } catch(e){} });
if ('serial' in navigator) navigator.serial.addEventListener('disconnect', () => { if (transport instanceof SerialTransport) lostConnection(); });

log(`Started: ${navigator.userAgent}`);
log(`serial=${'serial' in navigator} usb=${'usb' in navigator} android=${isAndroid}`);
})();


/* ================= App shell: navigation, install, theme, offline ================= */
(() => {
'use strict';
const APP_VERSION = '4.8.1'; // must match VERSION in sw.js
const $ = id => document.getElementById(id);

// Navigation
function show(view){
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.dataset.view === view));
  document.querySelectorAll('.tab').forEach(t => {
    const on = t.dataset.view === view;
    t.classList.toggle('active', on);
    if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
  window.scrollTo({ top: 0 });
}
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => show(t.dataset.view)));
document.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => show(b.dataset.goto)));

// About
$('appVersion').textContent = APP_VERSION;
const access = [('serial' in navigator) && 'Web Serial', ('usb' in navigator) && 'WebUSB'].filter(Boolean);
$('appAccess').textContent = access.length ? access.join(' and ') : 'Not available in this browser';
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
$('appInstalled').textContent = standalone() ? 'Yes' : 'No';

// Theme
const store = { get(k){ try { return localStorage.getItem(k); } catch(e){ return null; } }, set(k,v){ try { localStorage.setItem(k,v); } catch(e){} } };
function applyTheme(t){
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
const savedTheme = store.get('hart-theme') || 'auto';
$('themeSel').value = savedTheme; applyTheme(savedTheme);
$('themeSel').addEventListener('change', e => { store.set('hart-theme', e.target.value); applyTheme(e.target.value); });

// Install (Chrome and Edge show this when the app meets PWA criteria)
let deferredPrompt = null;
const installBtns = [$('btnInstall'), $('btnInstall2')];
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); deferredPrompt = e;
  installBtns.forEach(b => b.classList.remove('hidden'));
});
installBtns.forEach(b => b.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice.catch(() => {});
  deferredPrompt = null;
  installBtns.forEach(x => x.classList.add('hidden'));
}));
window.addEventListener('appinstalled', () => {
  installBtns.forEach(x => x.classList.add('hidden'));
  $('appInstalled').textContent = 'Yes';
});

// Offline support and updates
// Registering sw.js?v=<APP_VERSION> means a cached copy of an older sw.js
// (on the phone or at Cloudflare) can never hide an update.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')){
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!refreshing){ refreshing = true; location.reload(); } });
  navigator.serviceWorker.register(`sw.js?v=${APP_VERSION}`, { updateViaCache: 'none' }).then(reg => {
    const offer = w => {
      $('updateToast').classList.remove('hidden');
      $('btnUpdate').onclick = () => w.postMessage('SKIP_WAITING');
    };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    // An installed app brought back from recent apps doesn't reload, so check when it's shown again.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(err => console.warn('Service worker registration failed', err));
}
})();
