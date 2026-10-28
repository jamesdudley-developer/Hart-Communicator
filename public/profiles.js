/* Device profiles: the device-specific layer above HART universal and common-practice commands.
   Sources, in order of preference where they overlap:
   - captures of AMS checked against the AMS screens (captured),
   - the manufacturer's device description extracted from its DTM installer (dd, data in dd-data.js),
   - Rosemount HART Field Device Specifications (FDS) reviewed 2026-10-14 (project doc claude/fds-inventory.md).
   HART device-specific layouts must not be guessed. Where none of these sources covers a device
   revision, the sensor layout is a "template": learned from a capture of AMS doing the change, or
   entered from the FDS by hand, stored per device type and device revision on this device only. */
(() => {
'use strict';

const ROSEMOUNT = 0x26;

// Sensor type codes, common across 644 / 3144P / 648 (FDS sensor type tables).
const SENSOR_TYPES = [
  [0, 'Ohms', 'rtd'], [1, 'PT100 α 0.00385', 'rtd'], [2, 'PT100 α 0.003916', 'rtd'], [3, 'PT200 α 0.00385', 'rtd'],
  [4, 'PT500 α 0.00385', 'rtd'], [5, 'Ni120', 'rtd'], [6, 'Cu10', 'rtd'], [7, 'PT1000 α 0.00385', 'rtd'],
  [8, 'Callendar-Van Dusen', 'rtd'], [10, 'Cu50 (code 10)', 'rtd'], [11, 'Cu50 (code 11)', 'rtd'],
  [12, 'Cu100 (code 12)', 'rtd'], [13, 'Cu100 (code 13)', 'rtd'], [14, 'PT50', 'rtd'],
  [15, 'PT100 α 0.00391', 'rtd'], [16, 'PT200 α 0.003916', 'rtd'],
  [128, 'Millivolts', 'tc'], [129, 'Type B', 'tc'], [130, 'Type E', 'tc'], [131, 'Type J', 'tc'],
  [132, 'Type K', 'tc'], [133, 'Type N', 'tc'], [134, 'Type R', 'tc'], [135, 'Type S', 'tc'],
  [136, 'Type T', 'tc'], [137, 'DIN Type L', 'tc'], [140, 'DIN Type U', 'tc'], [141, 'W5Re26', 'tc'],
  [143, 'GOST Type L', 'tc'],
];
const SENSOR_3144P_EXTRA = [[9, 'Special RTD / Ohms', 'rtd'], [142, 'Special TC / mV', 'tc']];
const CONNECTIONS = [[2, '2-wire'], [3, '3-wire'], [4, '4-wire']];

/* ---------- Device-specific commands from manufacturer device descriptions (dd-data.js) ----------
   Extracted from Emerson DTM installers (the DD compiled into each DTM), see tools/dd-extract and the
   project doc claude/dd-extraction-handoff.md. Each command carries its request and reply layouts. */
const HCF_SPECIAL = { 250: 'Not used', 251: 'None', 252: 'Unknown', 253: 'Special' }; // HART common tables

function ddField(f, d, enums) {
  const H = window.HART;
  const o = f.o, n = f.n;
  const uint = () => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + d[o + i]; return v; };
  switch (f.t) {
    case 'f': return H.f32(d, o);
    case 'F': return new DataView(Uint8Array.from(d.slice(o, o + 8)).buffer).getFloat64(0, false);
    case 'u': return uint();
    case 'i': { const v = uint(), m = 2 ** (8 * n); return v >= m / 2 ? v - m : v; }
    case 'B': return (d[o] >> f.bit) & 1 ? 'On' : 'Off';
    case 'e': {
      const v = uint(), tab = enums[f.e] || {};
      // Unit codes without their own table in the DD use the HART common units table.
      if (!f.e && /unit/i.test(f.k) && H.unitName) return `${H.unitName(v)} (${v})`;
      const t = tab[v] ?? HCF_SPECIAL[v];
      return t != null ? `${t} (${v})` : `code ${v}`;
    }
    case 'b': {
      const v = uint(), tab = enums[f.e] || {};
      const on = Object.entries(tab).filter(([c]) => +c && (v & +c) === +c).map(([, l]) => l);
      return on.length ? on.join(', ') : (v ? `bits ${H.toHex(d.slice(o, o + n))}` : 'None');
    }
    case 'p': return (H.packedAscii(d, o, n) || '').trim() || '(blank)';
    case 'a': return String.fromCharCode(...d.slice(o, o + n).filter(b => b)).trim() || '(blank)';
    case 'd': return `${d[o]}/${d[o + 1]}/${1900 + d[o + 2]}`;
    default: return H.toHex(d.slice(o, o + n));
  }
}
const fieldsLen = fs => fs.every(f => f.o != null && f.n) ? Math.max(0, ...fs.map(f => f.o + f.n)) : null;
// Several transactions: use the one whose layout length matches the data, otherwise the first.
const pickTr = (trs, side, len) => trs.find(t => t[side].length && fieldsLen(t[side]) === len) || trs.find(t => t[side].length) || null;
function ddDecode(fields, d, enums) {
  const out = {};
  for (const f of fields) {
    if (f.o == null || !f.n) { if (f.o != null && f.o < d.length) out[`${f.l} (raw)`] = window.HART.toHex(d.slice(f.o)); break; }
    if (f.o + f.n > d.length) break;
    let k = f.l; for (let i = 2; k in out; i++) k = `${f.l} (${i})`;
    out[k] = ddField(f, d, enums);
  }
  const used = fieldsLen(fields);
  if (used != null && d.length > used) out['Extra bytes (not in the DD)'] = window.HART.toHex(d.slice(used));
  return out;
}
const ddHint = trs => trs.map(t => t.req.length
  ? 'Request: ' + t.req.map(f => `${f.l} (${f.n ?? '?'} byte${f.n === 1 ? '' : 's'}${f.v != null ? `, always ${f.v.toString(16).padStart(2, '0').toUpperCase()}` : ''})`).join(', ')
  : 'No request data').filter((v, i, a) => a.indexOf(v) === i).join(' or ');

function ddCommands(key) {
  const DD = window.HARTDD, dev = DD?.devices?.[key];
  if (!dev) return {};
  const out = {};
  for (const [n, c] of Object.entries(dev.commands)) {
    const hasReq = c.tr.some(t => t.req.length), hasRsp = c.tr.some(t => t.rsp.length);
    out[n] = {
      name: c.name, rw: c.rw, confidence: 'dd', source: 'dd', ddName: c.dd, ddSource: dev.source,
      hint: ddHint(c.tr), layout: c.tr,
      req: hasReq ? d => { const t = pickTr(c.tr, 'req', d.length); return t ? ddDecode(t.req, d, DD.enums) : null; } : undefined,
      rsp: hasRsp ? d => { const t = pickTr(c.tr, 'rsp', d.length); return t ? ddDecode(t.rsp, d, DD.enums) : null; } : undefined,
    };
  }
  return out;
}

/* Rosemount pressure transmitters, device-specific reads decoded from passive captures of AMS
   Device Configurator opening Device Information, checked field by field against the AMS screens.
   - 3051C device revision 7 (HART 5): LT-405AA, final assembly 2169430, captured 20 Oct 2026.
   - 2088 device revision 9 (HART 5): PI-5102, model 2088G1S22A2S1B4I7Q4, captured 23 Oct 2026.
   Commands 128, 142, 148, 160 and 162 have the same layout on both. Field names and code tables for
   Commands 128 and 142 come from the Rosemount 2051 device description (device revision 10), whose
   layout matches every byte confirmed in the captures (bytes 0-21 of Command 128). These revisions send
   one more byte than the 2051 layout at the end of Command 128, so bytes 22-24 stay unconfirmed.
   confidence: 'confirmed' = every value matched AMS; 'partial' = some bytes mapped; 'guess' = unmapped;
   'dd' = from the manufacturer's device description, not yet checked on this exact revision. */
function rmtPressureCaptured({ with139 = false } = {}) {
  const H = window.HART;
  const model = n => d => ({ [`Model number ${n}`]: H.packedAscii(d, 0, 24) || '(blank)' });
  const dd = ddCommands('2051r10');
  const dd128 = dd[128]?.layout?.[0]?.rsp || [], dd142 = dd[142]?.layout?.[0]?.rsp || [];
  const cmds = {
    128: {
      name: 'Read materials of construction', rw: 'r', confidence: 'partial',
      rsp: d => {
        const out = {};
        dd128.filter(f => f.o + f.n <= 22).forEach(f => { if (f.o + f.n <= d.length) out[`[${f.o}${f.n > 1 ? `-${f.o + f.n - 1}` : ''}] ${f.l}`] = ddField(f, d, window.HARTDD.enums); });
        if (d.length > 22) out['[22-24] Not yet identified (local keys and configuration in the 2051 layout; this revision sends one more byte)'] = H.toHex(d.slice(22));
        return out;
      },
    },
    142: {
      name: 'Read alarm and saturation levels', rw: 'r', confidence: 'confirmed',
      rsp: d => {
        const out = { 'High alarm (mA)': H.f32(d, 0), 'Low alarm (mA)': H.f32(d, 4), 'High saturation (mA)': H.f32(d, 8), 'Low saturation (mA)': H.f32(d, 12) };
        const ty = dd142.find(f => f.o === 16);
        if (d.length > 16) out['[16] Alarm/saturation type (from the 2051 DD)'] = ty ? ddField(ty, d, window.HARTDD.enums) : d[16];
        return out;
      },
    },
    148: { name: 'Read model number 1', rw: 'r', confidence: 'confirmed', rsp: model(1) },
    160: { name: 'Read model number 2', rw: 'r', confidence: 'confirmed', rsp: model(2) },
    162: { name: 'Read model number 3', rw: 'r', confidence: 'confirmed', rsp: model(3) },
  };
  if (with139) cmds[139] = {
    name: 'Read local buttons or security (unconfirmed)', rw: 'r', confidence: 'guess',
    req: d => ({ index: d[0] }),
    rsp: d => ({ raw: H.toHex(d), note: 'Probably the local zero/span buttons (0 = enabled). Toggle them in AMS on a bench unit and capture again to confirm.' }),
  };
  return cmds;
}

/* 644 device revision 8 (HART 5): read decoded from a passive capture of AMS opening Device Information on
   TIT406-2 (23 Oct 2026) and checked against the AMS Alarm Type and Security tab.
   Cmd 189 = four big-endian floats: high alarm 21.75, low alarm 3.75, high saturation 20.50, low saturation 3.90 mA
   (Rosemount levels). Same order as the 3051 Cmd 142, without the trailing byte. */
function rmt644r8() {
  const H = window.HART;
  const CAL = { 0: 'Factory trim', 1: 'User trim' };
  const sensorRsp = d => ({ sensor: d[0] + 1, 'Sensor type': d[1] === 250 ? 'Not used' : sensorName(PROFILES.find(p => p.id === 'rmt-644'), d[1]), Connection: d[2] === 250 ? 'Not used' : connName(d[2]) });
  return {
    136: { name: 'Read 2-wire lead correction', rw: 'r', confidence: 'confirmed', req: d => ({ sensor: d[0] + 1 }), rsp: d => ({ sensor: d[0] + 1, 'Lead correction (ohms)': H.f32(d, 1), note: 'Only applied to 2-wire RTD and ohm inputs' }) },
    152: { name: 'Read LCD configuration', rw: 'r', confidence: 'confirmed', rsp: d => ({ 'Display code (byte 1)': d[0], 'Decimal point code': d[1], 'Bar graph code': d[2], 'Display code (byte 2)': d[3], 'Display type': { 0: 'None', 1: 'LOI', 2: 'LCD' }[d[4]] ?? d[4], 'LOI password': d[5] ? 'Enabled' : 'Disabled' }) },
    174: { name: 'Read Callendar-Van Dusen constants', rw: 'r', confidence: 'confirmed', req: d => ({ sensor: d[0] + 1 }), rsp: d => ({ sensor: d[0] + 1, R0: H.f32(d, 1), A: H.f32(d, 5), B: H.f32(d, 9), C: H.f32(d, 13), note: 'Only used with the special CVD sensor type' }) },
    196: { name: 'Read sensor drift alert options', rw: 'r', confidence: 'confirmed', req: d => ({ units: d[0] }), rsp: d => ({ units: d[0], 'Drift alert': { 0: 'Warning', 1: 'Alarm', 2: 'Disabled', 250: 'Not used' }[d[1]] ?? d[1], 'Drift limit': H.f32(d, 3), 'Drift damping (s)': H.f32(d, 7) }) },
    140: { name: 'Read sensor configuration', rw: 'r', confidence: 'confirmed', req: d => ({ sensor: d[0] + 1 }), rsp: sensorRsp },
    141: { name: 'Write sensor configuration', rw: 'w', confidence: 'confirmed', req: sensorRsp },
    138: { name: 'Read device options', rw: 'r', confidence: 'confirmed', rsp: d => ({ 'Device options (bits)': H.toHex([d[0]]), 'Dual sensor': !!(d[0] & 1), 'Hot Backup': !!(d[0] & 4), 'Drift alert': !!(d[0] & 16), 'DA1 diagnostics': !!(d[0] & 64) }) },
    142: { name: 'Read sensor trim information', rw: 'r', confidence: 'confirmed', req: d => ({ sensor: d[0], units: d[1] }),
      rsp: d => ({ sensor: d[0], units: d[1], 'Calibration mode': CAL[d[2]] ?? d[2], 'Upper trim limit': H.f32(d, 3), 'Lower trim limit': H.f32(d, 7), 'Upper trim value': H.f32(d, 11), 'Lower trim value': H.f32(d, 15) }) },
    143: { name: 'Perform sensor trim upper', rw: 'w', confidence: 'confirmed', req: d => ({ sensor: d[0], units: d[1], value: H.f32(d, 2) }) },
    144: { name: 'Perform sensor trim lower', rw: 'w', confidence: 'confirmed', req: d => ({ sensor: d[0], units: d[1], value: H.f32(d, 2) }) },
    145: { name: 'Write calibration mode', rw: 'w', confidence: 'confirmed', req: d => ({ sensor: d[0], mode: CAL[d[1]] ?? d[1] }) },
    146: { name: 'Read trim units', rw: 'r', confidence: 'confirmed', req: d => ({ sensor: d[0] }), rsp: d => ({ sensor: d[0], units: d[1] }) },
    178: { name: 'Read latched device status', rw: 'r', confidence: 'confirmed', rsp: d => ({ bytes: H.toHex(d), 'Excess trim correction attempted': !!(d[2] & 8), 'Sensor trim failure': !!(d[2] & 16), 'Operation failure': !!(d[3] & 4) }) },
    179: { name: 'Clear latched device status', rw: 'w', confidence: 'confirmed' },
    181: { name: 'Write calibrator mode', rw: 'w', confidence: 'confirmed', req: d => ({ mode: d[0] === 0 ? 'Enable' : d[0] === 1 ? 'Disable' : d[0] }) },
    189: {
      name: 'Read alarm and saturation levels', rw: 'r', confidence: 'confirmed',
      rsp: d => ({ 'High alarm (mA)': H.f32(d, 0), 'Low alarm (mA)': H.f32(d, 4), 'High saturation (mA)': H.f32(d, 8), 'Low saturation (mA)': H.f32(d, 12) }),
    },
  };
}

// FDS commands, then the device description for this revision, then anything decoded from captures
// (captures checked on hardware win where they overlap).
const ddFor = (p, devRev) => (p.dd?.[devRev] ? ddCommands(p.dd[devRev]) : {});
const commandsFor = (p, devRev) => ({ ...p.commands, ...ddFor(p, devRev), ...(p.captured?.[devRev] || {}) });
// Commands safe to send: FDS commands only when the FDS is genuine, plus DD and capture-verified commands.
const trustedCommands = (p, devRev) => p.suspect ? { ...ddFor(p, devRev), ...(p.captured?.[devRev] || {}) } : commandsFor(p, devRev);
const ddSource = (p, devRev) => (p.dd?.[devRev] && window.HARTDD?.devices?.[p.dd[devRev]]?.source) || null;

const sensorCommands = (read, write) => ({
  [read]: { name: 'Read sensor configuration (FDS)', rw: 'r' },
  [write]: { name: 'Write sensor configuration (FDS)', rw: 'w' },
});

const PROFILES = [
  {
    id: 'rmt-644', model: 'Rosemount 644H / 644R', kind: 'temperature',
    manufacturerId: ROSEMOUNT, typeLow: 0x18,
    fds: 'FDS for device revision 8 (HART 5.9). Command 17 "HART7" switches the unit to device revision 9.',
    revisions: { 8: { hart: 5, documented: true }, 9: { hart: 7, documented: false, note: 'HART 7 mode (device revision 9) is not covered by the FDS on hand.' } },
    sensor: { read: 140, write: 141, types: SENSOR_TYPES, connections: CONNECTIONS },
    commands: sensorCommands(140, 141),
    // AMS Device Information on TIT406-2 (rev 8, 23 Oct 2026) shows Model "644" only: no model number is
    // stored in the device. It shows the Cmd 0 device ID as "Electronics Serial Number".
    // Sensor trim through device-specific commands (FDS rev 8 section 10.13–10.17, matched by an AMS capture
    // on TIT406-2, 23 Oct 2026). The 644 does not use common-practice Commands 80–83.
    trim: { revs: [8], sensor: 0, units: 146, info: 142, upper: 143, lower: 144, mode: 145, latched: 178, clearLatched: 179 },
    // Built-in Cmd 140/141 layout for rev 8 (FDS rev 8, confirmed on TIT406-2 19 and 23 Oct 2026):
    // read request [sensor]; reply and write data [sensor, sensor type, connection]. Real devices only.
    sensorLayout: { 8: { readReq: [0], readTypeIdx: 1, readConnIdx: 2, mirror: true, writeBase: [], typeIdx: 1, connIdx: 2, source: 'builtin' } },
    noModelCode: '644', deviceIdLabel: 'Electronics serial number (device ID)',
    captured: { 8: rmt644r8() },
  },
  {
    id: 'rmt-3144p', model: 'Rosemount 3144P', kind: 'temperature',
    manufacturerId: ROSEMOUNT, typeLow: 0x19, expandedType: 0x2619,
    fds: 'FDS revision 6 (H7D): HART 7.2, device revision 6. Command 17 "HART5" switches to device revision 5.',
    revisions: { 6: { hart: 7, documented: true }, 5: { hart: 5, documented: true } },
    sensor: { read: 140, write: 141, types: [...SENSOR_TYPES, ...SENSOR_3144P_EXTRA].sort((a, b) => a[0] - b[0]), connections: CONNECTIONS },
    commands: sensorCommands(140, 141),
    // Device revision 5: every device-specific command from Emerson's 3144P DTM device description.
    dd: { 5: '3144Pr5' },
    // DD rev 5 Cmd 140/141: request [sensor number]; reply and write data [sensor number, sensor type, connection].
    // Same layout as the 644 rev 8, which is confirmed on hardware.
    sensorLayout: { 5: { readReq: [0], readTypeIdx: 1, readConnIdx: 2, mirror: true, writeBase: [], typeIdx: 1, connIdx: 2, source: 'dd' } },
    // Same trim commands and layouts as the 644 rev 8 (142-146). Latched status (178) is left out of the trim
    // panel because the 644 bit meanings aren't checked for the 3144P; the console decodes it from the DD.
    trim: { revs: [5], sensor: 0, units: 146, info: 142, upper: 143, lower: 144, mode: 145 },
  },
  {
    id: 'rmt-648', model: 'Rosemount 648 Wireless', kind: 'temperature',
    manufacturerId: ROSEMOUNT, typeLow: 0x58, expandedType: 0x2658,
    fds: 'FDS for device revision 2 (Feb 2011), HART 7.1. Wired HART through the maintenance terminals.',
    revisions: { 2: { hart: 7, documented: true } },
    sensor: { read: 154, write: 155, types: SENSOR_TYPES, connections: CONNECTIONS },
    commands: sensorCommands(154, 155),
    dd: { 2: '648r2' },
    // DTM rev 2 Cmd 154/155: request [02] (sensor 1 device variable); reply and write data [02, sensor type, connection].
    sensorLayout: { 2: { readReq: [2], readTypeIdx: 1, readConnIdx: 2, mirror: true, writeBase: [], typeIdx: 1, connIdx: 2, source: 'dd' } },
  },
  {
    id: 'rmt-775', model: 'Rosemount 775 THUM Adapter', kind: null,
    manufacturerId: ROSEMOUNT, typeLow: 0x4F, expandedType: 0x264F,
    fds: 'No FDS on hand. Device-specific commands come from Emerson\'s THUM Wireless DTM (device revision 1).',
    revisions: { 1: { hart: 7, documented: true } },
    sensor: null, commands: {},
    dd: { 1: '775r1' },
  },
  {
    id: 'rmt-3051c', model: 'Rosemount 3051C', kind: 'pressure',
    manufacturerId: ROSEMOUNT, typeLow: 0x06, expandedType: 0x2606,
    fds: 'FDS revision 1.1 (Jun 2012): HART 7.2 device revision 10, HART 5 device revision 9.',
    revisions: {
      10: { hart: 7, documented: true }, 9: { hart: 5, documented: true },
      7: { hart: 5, documented: false, note: 'Device revision 7 is older than the FDS on hand. Its device-specific reads were decoded from a capture of AMS, not from the FDS.' },
    },
    sensor: null, commands: {},
    // Per-revision commands decoded from captures, applied only to that device revision.
    captured: { 7: rmtPressureCaptured({ with139: true }) },
  },
  {
    id: 'rmt-2051', model: 'Rosemount 2051', kind: 'pressure', suspect: true,
    manufacturerId: ROSEMOUNT, typeLow: 0x55, expandedType: 0x2655,
    fds: 'The FDS on hand is a copy of the 3051C document with the model name and device type changed, so it is not used. Device revision 10 uses the device description from Emerson\'s 2051 DTM instead.',
    revisions: { 10: { hart: 7, documented: true, note: 'Device revision 10: device-specific commands from the device description in Emerson\'s 2051 DTM (V10.02).' } },
    sensor: null, commands: {},
    dd: { 10: '2051r10' },
  },
  {
    id: 'rmt-2088', model: 'Rosemount 2088', kind: 'pressure', suspect: true,
    manufacturerId: ROSEMOUNT, typeLow: 0x23,
    fds: 'The FDS on hand is a copy of the 3051C document with the model name and device type changed. Treat device-specific details as unverified, except the reads decoded from a capture for device revision 9.',
    revisions: { 9: { hart: 5, documented: false, note: 'Device revision 9: model numbers, materials and alarm levels were decoded from a capture of AMS on PI-5102 and checked against the AMS screens. Nothing else device-specific is used.' } },
    sensor: null, commands: {},
    // Captured reads are trusted even though the FDS is suspect: they were checked against AMS.
    captured: { 9: rmtPressureCaptured() },
    // AMS shows Command 16 (final assembly number) as the transmitter "Serial Number" (PI-5102: 3577792).
    finalAssemblyIsSerial: true,
  },
];

// Match on manufacturer plus device type. HART 5 replies carry only the low byte of the
// device type; HART 7 replies carry the expanded 16-bit type.
function match({ manufacturerId, deviceType, deviceRevision }) {
  const p = PROFILES.find(x => x.manufacturerId === (manufacturerId & 0xff) && x.typeLow === (deviceType & 0xff) &&
    (deviceType <= 0xff || !x.expandedType || x.expandedType === deviceType));
  if (!p) return null;
  const rev = p.revisions[deviceRevision] || null;
  return { profile: p, revision: rev, documented: !!rev?.documented && !p.suspect };
}

// The manufacturer's own configuration software. Named only when the manufacturer ID from
// Command 0 identifies the maker; otherwise the wording stays generic.
const HOST_TOOLS = { 0x26: 'AMS Device Manager or AMS Device Configurator', 0x62: 'PACTware with the VEGA DTM', 0x11: 'FieldCare or DeviceCare' };
const hostTool = manufacturerId => HOST_TOOLS[manufacturerId & 0xff] || "the manufacturer's configuration software";

const sensorName = (p, code) => (p?.sensor?.types.find(t => t[0] === code) || [code, `Code ${code}`])[1];
const connName = code => (CONNECTIONS.find(c => c[0] === code) || [code, `Code ${code}`])[1];

/* ---------- Templates (learned or entered layouts) ---------- */
const KEY = 'hart-templates-v1';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const save = all => { try { localStorage.setItem(KEY, JSON.stringify(all)); return true; } catch { return false; } };
const tKey = (profileId, devRev, sim) => `${profileId}|${devRev}|${sim ? 'sim' : 'real'}`;

const templates = {
  get(profileId, devRev, sim) { return load()[tKey(profileId, devRev, sim)] || null; },
  set(t) { const all = load(); all[tKey(t.profileId, t.devRev, t.sim)] = t; return save(all); },
  remove(profileId, devRev, sim) { const all = load(); delete all[tKey(profileId, devRev, sim)]; return save(all); },
  list() { return Object.values(load()); },
};

// Byte positions in `bytes` whose value could be a sensor type or a wiring code.
function candidates(profile, bytes) {
  const types = new Set(profile.sensor.types.map(t => t[0]));
  const conns = new Set(CONNECTIONS.map(c => c[0]));
  const out = { type: [], conn: [] };
  Array.from(bytes).forEach((b, i) => { if (types.has(b)) out.type.push(i); if (conns.has(b)) out.conn.push(i); });
  return out;
}

window.HARTProfiles = { PROFILES, SENSOR_TYPES, CONNECTIONS, match, commandsFor, trustedCommands, ddSource, ddCommands, sensorName, connName, templates, candidates, hostTool };
})();
