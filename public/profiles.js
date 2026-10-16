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
    revisions: { 10: { hart: 7, documented: true }, 9: { hart: 5, documented: true } },
    sensor: null, commands: {},
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
    fds: 'The FDS on hand is a copy of the 3051C document with the model name and device type changed. Treat device-specific details as unverified.',
    revisions: {}, sensor: null, commands: {},
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

window.HARTProfiles = { PROFILES, SENSOR_TYPES, CONNECTIONS, match, sensorName, connName, templates, candidates };
})();
