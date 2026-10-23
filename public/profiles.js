/* Device profiles: the device-specific layer above HART universal and common-practice commands.
   Source: Rosemount HART Field Device Specifications (FDS) reviewed 2026-10-14
   (project doc claude/fds-inventory.md). Only facts stated in those documents are recorded here.

   Byte layouts of device-specific commands are NOT hard-coded. The FDS text that holds them is
   not part of this app, and HART device-specific layouts must not be guessed. A layout becomes
   usable only as a "template": learned from a capture of AMS (or another approved tool)
   doing the change, or entered from the FDS by hand. Templates are stored per device type and
   device revision on this device only. */
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

/* Rosemount pressure transmitters, device-specific reads decoded from passive captures of AMS
   Device Configurator opening Device Information, checked field by field against the AMS screens.
   Not from an FDS.
   - 3051C device revision 7 (HART 5): LT-405AA, final assembly 2169430, captured 20 Oct 2026.
   - 2088 device revision 9 (HART 5): PI-5102, model 2088G1S22A2S1B4I7Q4, captured 23 Oct 2026.
   Commands 128, 142, 148, 160 and 162 have the same layout on both.
   confidence: 'confirmed' = every value matched AMS; 'partial' = some bytes mapped; 'guess' = unmapped. */
const HCF_SPECIAL = { 250: 'Not used', 251: 'None', 252: 'Unknown', 253: 'Special' }; // HART common tables
const MATERIAL = { 2: '316 SST', 10: 'PTFE', ...HCF_SPECIAL };
const FILL_FLUID = { 1: 'Silicone oil', ...HCF_SPECIAL };
const SEAL_TYPE = { 3: 'EFW', 6: 'RTW', ...HCF_SPECIAL };
const SEAL_COUNT = { 1: 'One seal', 2: 'Two seals', ...HCF_SPECIAL };
const PROC_CONN = { 14: 'Remote seal', 44: '1/2 in NPTF', ...HCF_SPECIAL };
const PROC_CONN_CONFIRMED = new Set([44]); // matched AMS on PI-5102; 14 seen once only

function rmtPressureCaptured({ with139 = false } = {}) {
  const H = window.HART;
  const code = (table, v) => v == null ? null : (v in table ? `${table[v]} (${v})` : `code ${v}`);
  const unsure = v => v == null ? null : `${v} ?`;
  const model = n => d => ({ [`Model number ${n}`]: H.packedAscii(d, 0, 24) || '(blank)' });
  const cmds = {
    128: {
      name: 'Read materials of construction', rw: 'r', confidence: 'partial',
      rsp: d => ({
        '[0] Process connection': PROC_CONN_CONFIRMED.has(d[0]) ? code(PROC_CONN, d[0]) : unsure(code(PROC_CONN, d[0])),
        '[1] Process connection material': code(MATERIAL, d[1]),
        '[2] O-ring material': code(MATERIAL, d[2]),
        '[3] Not yet identified': d[3],
        '[4] Drain/vent material': code(MATERIAL, d[4]),
        '[5] Remote seal type': code(SEAL_TYPE, d[5]),
        '[6] Remote seal fill fluid': code(FILL_FLUID, d[6]),
        '[7] Remote seal diaphragm': code(MATERIAL, d[7]),
        '[8] Number of remote seals': unsure(code(SEAL_COUNT, d[8])),
        '[9] Sensor fill fluid': unsure(code(FILL_FLUID, d[9])),
        '[10] Isolator material': code(MATERIAL, d[10]),
        '[12] Sensor range': d[12] == null ? null : `Range ${d[12]}`,
        '[11, 13] Not yet identified (sensor type and configuration)': d.length >= 14 ? `${H.toHex([d[11], d[13]])}` : null,
        '[14-24] Not yet identified': d.length > 14 ? H.toHex(d.slice(14)) : null,
      }),
    },
    142: {
      name: 'Read alarm and saturation levels', rw: 'r', confidence: 'confirmed',
      rsp: d => ({ 'High alarm (mA)': H.f32(d, 0), 'Low alarm (mA)': H.f32(d, 4), 'High saturation (mA)': H.f32(d, 8), 'Low saturation (mA)': H.f32(d, 12), '[16] Not yet identified': d[16] ?? null }),
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

// FDS commands plus any decoded from captures for this device revision.
const commandsFor = (p, devRev) => ({ ...p.commands, ...(p.captured?.[devRev] || {}) });
// Commands safe to send: FDS commands only when the FDS is genuine, plus capture-verified reads.
const trustedCommands = (p, devRev) => p.suspect ? { ...(p.captured?.[devRev] || {}) } : commandsFor(p, devRev);

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
  },
  {
    id: 'rmt-3144p', model: 'Rosemount 3144P', kind: 'temperature',
    manufacturerId: ROSEMOUNT, typeLow: 0x19, expandedType: 0x2619,
    fds: 'FDS revision 6 (H7D): HART 7.2, device revision 6. Command 17 "HART5" switches to device revision 5.',
    revisions: { 6: { hart: 7, documented: true }, 5: { hart: 5, documented: true } },
    sensor: { read: 140, write: 141, types: [...SENSOR_TYPES, ...SENSOR_3144P_EXTRA].sort((a, b) => a[0] - b[0]), connections: CONNECTIONS },
    commands: sensorCommands(140, 141),
  },
  {
    id: 'rmt-648', model: 'Rosemount 648 Wireless', kind: 'temperature',
    manufacturerId: ROSEMOUNT, typeLow: 0x58, expandedType: 0x2658,
    fds: 'FDS for device revision 2 (Feb 2011), HART 7.1. Wired HART through the maintenance terminals.',
    revisions: { 2: { hart: 7, documented: true } },
    sensor: { read: 154, write: 155, types: SENSOR_TYPES, connections: CONNECTIONS },
    commands: sensorCommands(154, 155),
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
    manufacturerId: ROSEMOUNT, typeLow: 0x55,
    fds: 'The FDS on hand is a copy of the 3051C document with the model name and device type changed. Treat device-specific details as unverified.',
    revisions: {}, sensor: null, commands: {},
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

window.HARTProfiles = { PROFILES, SENSOR_TYPES, CONNECTIONS, match, commandsFor, trustedCommands, sensorName, connName, templates, candidates, hostTool };
})();
