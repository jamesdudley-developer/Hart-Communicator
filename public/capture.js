/* Capture tab: decode serial-monitor logs, listen passively with a second modem,
   compare before/after captures, analyse this app's own traffic, and learn
   device-specific byte layouts (sensor setup templates) from a capture. */
(() => {
'use strict';
const H = window.HART, P = window.HARTProfiles;
const $ = s => document.getElementById(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const h2 = n => (n == null ? '—' : '0x' + n.toString(16).toUpperCase().padStart(2, '0'));

const live = { listener: null, rec: null, running: false, slot: 'a', timer: null, msg: '' };
const state = { a: null, b: null, aName: '', bName: '', aChunks: null, filter: 'interesting', compare: null, open: new Set() };

// Analyse twice: the first pass finds the device, the second labels its device-specific
// commands from the matching profile (for example Command 141 as a sensor setup write).
function analyzeWithProfile(chunks) {
  const first = H.analyze(chunks), id = first.identity;
  const m = id ? P.match({ manufacturerId: id.manufacturerId ?? -1, deviceType: id.expandedDeviceType ?? id.deviceType, deviceRevision: id.deviceRevision }) : null;
  if (!m) return first;
  const commands = P.commandsFor(m.profile, id.deviceRevision);
  return Object.keys(commands).length ? H.analyze(chunks, { profile: { ...m.profile, commands } }) : first;
}

function loadChunks(slot, chunks, name) {
  state[slot] = analyzeWithProfile(chunks);
  state[slot + 'Name'] = name;
  if (slot === 'a') { state.aChunks = chunks; state.open.clear(); }
  state.compare = state.a && state.b ? H.compareSessions(state.a, state.b) : null;
  render();
}
async function loadFile(slot, file) {
  const { chunks } = H.importAny(await file.arrayBuffer());
  loadChunks(slot, chunks, file.name);
}

/* ---------- Listen ---------- */
function explain(e) {
  if (e?.name === 'NotFoundError') return 'No modem selected.';
  if (e?.name === 'SecurityError' || /permission|policy|disallowed/i.test(e?.message || '')) return 'The browser blocked hardware access on this page. Open the app in its own tab.';
  if (e?.name === 'InvalidStateError' || /already open|claim/i.test(e?.message || '')) return 'That modem is already in use. Select the second modem, not the one the configuration software or this app is using.';
  if (e?.name === 'NetworkError') return 'The modem disconnected. Check the USB or OTG cable.';
  return e?.message || String(e);
}
async function connectListen(route) {
  live.msg = '';
  try {
    if (live.listener) await live.listener.close().catch(() => {});
    live.listener = await H.requestListener(route);
    await startListen();
  } catch (e) { live.listener = null; live.msg = explain(e); renderLive(); }
}
async function startListen() {
  if (!live.listener) return;
  live.msg = '';
  live.rec = new H.Recorder();
  const slot = live.slot;
  state[slot] = null; state[slot + 'Name'] = `Live capture ${live.rec.started.toLocaleTimeString()}`;
  if (slot === 'a') state.open.clear();
  live.running = true;
  const refresh = () => {
    live.timer = null;
    state[slot] = analyzeWithProfile(live.rec.chunks);
    if (slot === 'a') state.aChunks = live.rec.chunks;
    state.compare = state.a && state.b ? H.compareSessions(state.a, state.b) : null;
    render();
  };
  try {
    await H.listen(live.listener, {
      isRunning: () => live.running,
      onChunk: b => { live.rec.add(b); live.timer ||= setTimeout(refresh, 400); },
      onError: e => {
        live.rec.errors++;
        if (e?.name === 'NetworkError' || e?.name === 'NotFoundError') { live.msg = explain(e); stopListen(); }
        else { live.msg = `Line error (${live.rec.errors}): ${e?.message || e}. Recording continues.`; renderLive(); }
      },
    });
  } catch (e) {
    live.running = false; live.msg = explain(e);
    await live.listener.close().catch(() => {}); live.listener = null;
  }
  render();
}
async function stopListen() {
  live.running = false;
  clearTimeout(live.timer); live.timer = null;
  if (live.listener) { await live.listener.close().catch(() => {}); live.listener = null; }
  if (live.rec) {
    state[live.slot] = analyzeWithProfile(live.rec.chunks);
    if (live.slot === 'a') state.aChunks = live.rec.chunks;
    state.compare = state.a && state.b ? H.compareSessions(state.a, state.b) : null;
  }
  render();
}
function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function saveListen() {
  if (!live.rec) return;
  download(`hart-capture-${live.rec.started.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`, live.rec.toText(state[live.slot + 'Name']));
}

/* ---------- Clear ---------- */
// Discards both captures and the listen recording. Needs a second tap within 3 s.
let clearArmed = null;
function disarmClear() {
  clearTimeout(clearArmed); clearArmed = null;
  $('cpClear').textContent = 'Clear captures';
  $('cpClear').classList.remove('danger');
}
function clearCaptures() {
  if (live.running) return;
  if (!clearArmed) {
    $('cpClear').textContent = 'Tap again to discard';
    $('cpClear').classList.add('danger');
    clearArmed = setTimeout(disarmClear, 3000);
    return;
  }
  disarmClear();
  Object.assign(state, { a: null, b: null, aName: '', bName: '', aChunks: null, compare: null });
  state.open.clear();
  live.rec = null; live.msg = '';
  $('cpFileA').value = ''; $('cpFileB').value = '';
  $('cpOutWrap').classList.add('hidden'); $('cpOut').value = '';
  render();
}

/* ---------- Transaction list ---------- */
function roles(f) {
  const raw = f.raw, addrLen = raw[0] & 0x80 ? 5 : 1, exp = (raw[0] >> 5) & 3, cmdIdx = 1 + addrLen + exp;
  const r = ['delim', ...Array(addrLen).fill('addr'), ...Array(exp).fill('exp'), 'cmd', 'bc'];
  const n = raw[cmdIdx + 1];
  let k = 0;
  if (f.dir !== 'req') { r.push('rc', 'st'); k = 2; }
  if (raw[cmdIdx] === 31) { r.push('cmd', 'cmd'); k += 2; }
  for (; k < n; k++) r.push('data');
  r.push('chk');
  return r;
}
const ROLE_LABEL = { delim: 'Delimiter', addr: 'Address', exp: 'Expansion', cmd: 'Command', bc: 'Byte count', rc: 'Response code', st: 'Device status', data: 'Data', chk: 'Checksum' };
function strip(f, changed = []) {
  if (!f) return '';
  const rl = roles(f), dataStart = rl.indexOf('data');
  return `<div class="strip">${Array.from(f.raw).map((b, i) => {
    const di = dataStart >= 0 ? i - dataStart : -1;
    const hit = rl[i] === 'data' && changed.includes(di);
    return `<span class="b r-${rl[i]}${hit ? ' hit' : ''}" title="${ROLE_LABEL[rl[i]]}${rl[i] === 'data' ? ' [' + di + ']' : ''}">${b.toString(16).toUpperCase().padStart(2, '0')}</span>`;
  }).join('')}</div>`;
}
function kv(obj) {
  if (!obj) return '';
  const fmt = v => typeof v === 'number' && !Number.isInteger(v) ? +v.toPrecision(7) : (typeof v === 'object' ? JSON.stringify(v) : v);
  return `<table class="kv">${Object.entries(obj).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(fmt(v))}</td></tr>`).join('')}</table>`;
}
function txRow(t) {
  const tags = [];
  if (t.layer === 'device' || t.layer === 'expanded') tags.push('<span class="tag dev">Device-specific</span>');
  if (t.confidence) tags.push(`<span class="tag ${t.confidence === 'confirmed' ? 'ok' : 'guess'}">${{ confirmed: 'Decoded', partial: 'Partly decoded', guess: 'Unconfirmed' }[t.confidence]}</span>`);
  if (t.isWrite) tags.push(`<span class="tag wr">${t.writeCertainty === 'known' ? 'Write' : 'Likely write'}</span>`);
  if (t.causedConfigChange) tags.push('<span class="tag cfg">Set config-changed</span>');
  if (t.changedIdx) tags.push('<span class="tag chg">Value changed</span>');
  if (t.rsp && !t.ok) tags.push(`<span class="tag err">${esc(t.rcText)}</span>`);
  if (!t.rsp) tags.push('<span class="tag err">No reply</span>');
  const open = state.open.has(t.index);
  let body = '';
  if (open) {
    const st = t.rsp ? H.statusText(t.rsp.deviceStatus) : [];
    body = `<div class="detail">
      ${t.req ? `<h4>Request from host</h4>${strip(t.req)}${kv(t.decodedReq)}` : ''}
      ${t.rsp ? `<h4>Reply from device</h4>${strip(t.rsp, t.changedIdx || [])}
        <p class="hint">Response: ${esc(t.rcText || '—')}. Status: ${esc(st.join(', ') || 'none')}.</p>${kv(t.decodedRsp)}` : ''}
      ${t.prevHex ? `<p class="hint">Previous reply data: <code>${t.prevHex}</code></p>` : ''}
      ${t.floatLens?.length ? `<h4>Possible floats in reply data</h4><p class="hint">${t.floatLens.slice(0, 8).map(x => `[${x.offset}] ${+x.value.toPrecision(6)}`).join(' · ')}</p>` : ''}
    </div>`;
  }
  return `<li class="tx${open ? ' open' : ''}" data-i="${t.index}">
    <button class="row" aria-expanded="${open}">
      <span class="num">${t.command}</span>
      <span class="name">${esc(t.name)}<small>${t.time || ''} · #${t.index}</small></span>
      <span class="tags">${tags.join('')}</span>
    </button>${body}</li>`;
}
function passes(t) {
  switch (state.filter) {
    case 'all': return true;
    case 'writes': return t.isWrite;
    case 'device': return t.layer === 'device' || t.layer === 'expanded';
    case 'changed': return !!t.changedIdx;
    case 'errors': return (t.rsp && !t.ok) || !t.rsp;
    default: return t.isWrite || t.changedIdx || t.layer === 'device' || t.layer === 'expanded' || (t.rsp && !t.ok);
  }
}

/* ---------- Learning a sensor setup layout ---------- */
let teach = null;

function findTeach(s) {
  const id = s.identity;
  if (!id) return null;
  const m = P.match({ manufacturerId: id.manufacturerId ?? -1, deviceType: id.expandedDeviceType ?? id.deviceType, deviceRevision: id.deviceRevision });
  if (!m?.profile.sensor) return null;
  const sc = m.profile.sensor;
  const writes = s.tx.filter(t => t.command === sc.write && t.req && t.rsp && t.ok);
  if (!writes.length) return { m, id, none: true };
  const w = writes[writes.length - 1];
  const reads = s.tx.filter(t => t.command === sc.read && t.rsp && t.ok);
  const before = [...reads].reverse().find(t => t.index < w.index) || null;
  const after = reads.find(t => t.index > w.index) || null;
  const wr = Array.from(w.req.data), ar = after ? Array.from(after.rsp.data) : null, br = before ? Array.from(before.rsp.data) : null;
  const cand = P.candidates(m.profile, wr);
  const changed = br && ar && br.length === ar.length ? ar.map((b, i) => b !== br[i] ? i : -1).filter(i => i >= 0) : [];
  const typeIdx = cand.type.find(i => changed.includes(i)) ?? cand.type[0] ?? null;
  return {
    m, id, w, before, after, wr, ar, cand, changed, typeIdx,
    connIdx: cand.conn.find(i => i !== typeIdx) ?? null,
    mirror: !!(ar && ar.length === wr.length && wr.every((b, i) => b === ar[i])),
    readReq: Array.from((after || before)?.req?.data || []),
    sim: window.HARTSim?.isSimId(id.deviceId) || false,
  };
}

function renderTeach() {
  const s = state.a, box = $('cpTeach');
  teach = s ? findTeach(s) : null;
  if (!teach) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const p = teach.m.profile, sc = p.sensor;
  if (teach.none) {
    $('cpTeachBody').innerHTML = `<p class="hint">This capture is from a ${esc(p.model)} but has no successful Command ${sc.write}. Record ${esc(P.hostTool(teach.id.manufacturerId ?? -1))} changing the sensor type, then open that capture.</p>`;
    return;
  }
  const opts = (list, sel, none) => (none ? `<option value="">None</option>` : '') + list.map(i => `<option value="${i}"${i === sel ? ' selected' : ''}>Byte ${i} = ${teach.wr[i]}</option>`).join('');
  const rev = teach.m.revision;
  const revNote = !rev || !rev.documented ? `<p class="cfgnote warn">Device revision ${teach.id.deviceRevision} isn't covered by the specification on hand. The layout is saved for this revision only.</p>` : '';
  $('cpTeachBody').innerHTML = `
    <p class="hint">${esc(p.model)}, device revision ${teach.id.deviceRevision}${teach.sim ? ' (simulator)' : ''}. Found Command ${sc.write} (transaction #${teach.w.index}) with data:</p>
    <div class="bytes">${teach.wr.map((b, i) => `<span>${b.toString(16).toUpperCase().padStart(2, '0')}<small>${i}</small></span>`).join('')}</div>
    ${revNote}
    <div class="row2">
      <label>Sensor type is<select id="tcType">${opts(teach.cand.type, teach.typeIdx, false)}</select></label>
      <label>Wiring is<select id="tcConn">${opts(teach.cand.conn, teach.connIdx, true)}</select></label>
    </div>
    <p class="hint" id="tcWhat"></p>
    <p class="hint">${teach.after ? (teach.mirror ? `The read reply after the write (Command ${sc.read}) has the same layout, so the app will build writes from a fresh read.` : `The read reply after the write has a different layout. Writes will use the captured data as a template.`) : `There's no Command ${sc.read} reply after the write, so the app can't show the current sensor type until you read it.`}</p>
    <div class="btns"><button class="primary" id="tcSave">Save layout for this device type</button></div>
    <p class="hint" id="tcMsg"></p>`;
  const what = () => {
    const ti = $('tcType').value === '' ? null : +$('tcType').value, ci = $('tcConn').value === '' ? null : +$('tcConn').value;
    $('tcWhat').textContent = ti == null ? 'No byte in the write could be a sensor type.' :
      `The write sets ${P.sensorName(p, teach.wr[ti])}${ci != null ? `, ${P.connName(teach.wr[ci])}` : ''}. Check that matches what you set in ${P.hostTool(teach.id.manufacturerId ?? -1)}.`;
    $('tcSave').disabled = ti == null;
  };
  $('tcType').onchange = $('tcConn').onchange = what; what();
  $('tcSave').onclick = () => {
    const ti = +$('tcType').value, ci = $('tcConn').value === '' ? null : +$('tcConn').value;
    let rti = null, rci = null;
    if (teach.ar) {
      if (teach.mirror) { rti = ti; rci = ci; }
      else {
        rti = teach.ar.indexOf(teach.wr[ti]); if (rti < 0) rti = null;
        if (ci != null) { rci = teach.ar.findIndex((b, i) => b === teach.wr[ci] && i !== rti); if (rci < 0) rci = null; }
      }
    }
    const ok = P.templates.set({ profileId: p.id, devRev: teach.id.deviceRevision, sim: teach.sim, readReq: teach.readReq, writeBase: teach.wr,
      typeIdx: ti, connIdx: ci, readTypeIdx: rti, readConnIdx: rci, mirror: teach.mirror, source: 'capture', note: state.aName, savedAt: Date.now() });
    $('tcMsg').textContent = ok ? 'Saved. Open Tools to read and write the sensor setup on this device type.' : 'Could not save. The browser may be blocking storage.';
    window.HARTApp?.templatesChanged();
    window.HARTApp?.log(`Learned ${p.model} sensor layout from capture "${state.aName}"`);
  };
}

/* ---------- Render ---------- */
function renderLive() {
  const sup = H.liveSupport();
  $('lsSerial').classList.toggle('hidden', !sup.serial || live.running);
  $('lsUsb').classList.toggle('hidden', !sup.usb || live.running);
  $('lsNone').classList.toggle('hidden', sup.serial || sup.usb);
  $('lsStart').classList.toggle('hidden', live.running || !live.listener);
  $('lsStop').classList.toggle('hidden', !live.running);
  $('lsSave').disabled = !live.rec?.chunks.length || live.running;
  $('cpClear').disabled = live.running || !(state.a || state.b || live.rec);
  if ($('cpClear').disabled && clearArmed) disarmClear();
  document.querySelectorAll('input[name=slot]').forEach(r => { r.disabled = live.running; r.checked = r.value === live.slot; });
  const r = live.rec, ses = live.slot === 'b' ? state.b : state.a;
  $('lsState').textContent = live.running
    ? `Listening via ${live.listener.kind} · ${r.bytes} bytes · ${ses?.stats.transactions ?? 0} transactions`
    : r ? `Stopped · ${r.bytes} bytes recorded` : live.listener ? `Ready · ${live.listener.kind}` : 'Not connected';
  $('lsDot').dataset.on = live.running;
  $('lsMsg').textContent = live.msg; $('lsMsg').classList.toggle('hidden', !live.msg);
}

function render() {
  renderLive();
  const s = state.a;
  $('cpResult').classList.toggle('hidden', !s);
  $('cpAName').textContent = state.aName || 'None loaded';
  $('cpBName').textContent = state.bName || 'None loaded';
  if (!s) return;
  const id = s.identity;
  const m = id ? P.match({ manufacturerId: id.manufacturerId ?? -1, deviceType: id.expandedDeviceType ?? id.deviceType, deviceRevision: id.deviceRevision }) : null;
  $('cpIdentity').innerHTML = id ? kv({
    'Profile': m ? m.profile.model : 'None',
    'Manufacturer ID': h2(id.manufacturerId),
    'Device type': id.expandedDeviceType != null ? '0x' + id.expandedDeviceType.toString(16).toUpperCase() : h2(id.deviceType),
    'Device revision': id.deviceRevision, 'HART revision': id.hartRevision,
    'Software revision': id.softwareRevision, 'Device ID': id.deviceId,
  }) : '<p class="hint">No Command 0 reply in this capture. Start the capture before the configuration software connects to the device.</p>';
  const st = s.stats;
  $('cpStats').innerHTML = `${state.aName ? esc(state.aName) + ': ' : ''}${st.transactions} transactions · ${st.writes} writes · ${st.changes} changed reads · ${st.errors} errors${st.badChecksums ? ` · <b>${st.badChecksums} bad checksums</b>` : ''}`;
  const rows = s.tx.filter(passes);
  $('cpList').innerHTML = rows.length ? rows.map(txRow).join('') : '<li class="none">Nothing matches this filter. Choose <b>All</b> to see every transaction.</li>';
  const cmp = state.compare;
  $('cpCompare').classList.toggle('hidden', !cmp);
  if (cmp) $('cpCompareBody').innerHTML = cmp.length ? cmp.map(c => `<div class="cmp"><b>Command ${c.command}</b>${c.req ? ` request <code>${c.req}</code>` : ''}<br>Bytes ${c.changedIdx.join(', ')} changed<div class="pair"><span>Before</span><code>${c.before}</code><span>After</span><code>${c.after}</code></div></div>`).join('') : '<p class="hint">No configuration reads differ between the two captures.</p>';
  document.querySelectorAll('#cpResult .seg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.f === state.filter));
  renderTeach();
}

async function copyOut(text) {
  const box = $('cpOut');
  box.value = text;
  $('cpOutWrap').classList.remove('hidden');
  try { await navigator.clipboard.writeText(text); $('cpOutMsg').textContent = 'Copied to clipboard.'; }
  catch { box.select(); $('cpOutMsg').textContent = 'Select the text below and copy it.'; }
}

/* ---------- Wiring ---------- */
$('cpFileA').addEventListener('change', e => e.target.files[0] && loadFile('a', e.target.files[0]));
$('cpFileB').addEventListener('change', e => e.target.files[0] && loadFile('b', e.target.files[0]));
$('cpDemo').addEventListener('click', () => loadChunks('a', H.importAny(new TextEncoder().encode(H.DEMO_CAPTURE).buffer).chunks, 'Demo capture (synthetic)'));
$('cpSession').addEventListener('click', () => {
  const t = window.HARTApp?.traffic() || [];
  if (!t.length) { $('cpAName').textContent = 'No traffic yet. Connect to a device first.'; return; }
  loadChunks('a', t, `This app's traffic, ${new Date().toLocaleTimeString()}`);
});
$('cpList').addEventListener('click', e => {
  const li = e.target.closest('.tx'); if (!li || !e.target.closest('.row')) return;
  const i = +li.dataset.i; state.open.has(i) ? state.open.delete(i) : state.open.add(i); render();
});
document.querySelectorAll('#cpResult .seg button').forEach(b => b.addEventListener('click', () => { state.filter = b.dataset.f; render(); }));
$('cpReport').addEventListener('click', () => copyOut(H.textReport(state.a, state.compare, state.aName)));
$('cpDraft').addEventListener('click', () => copyOut(JSON.stringify(H.profileDraft(state.a, state.compare, state.aName), null, 2)));
$('lsStart').addEventListener('click', () => startListen());
$('lsSerial').addEventListener('click', () => connectListen('serial'));
$('lsUsb').addEventListener('click', () => connectListen('usb'));
$('lsStop').addEventListener('click', stopListen);
$('lsSave').addEventListener('click', saveListen);
$('cpClear').addEventListener('click', clearCaptures);
document.querySelectorAll('input[name=slot]').forEach(r => r.addEventListener('change', () => { live.slot = r.value; renderLive(); }));
render();
})();
