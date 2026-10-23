/* HART protocol core: frame codec, byte-stream scanner, command dictionary,
   serial-log importers, capture analysis and the passive listen mode.
   Shared by the communicator, the command console and the Capture tab.
   Layer: protocol foundation. Device-specific knowledge lives in profiles.js. */
(() => {
'use strict';
// ---- src/hart/types.js ----
// HART data type readers and writers (big-endian, IEEE 754 single).

function f32(bytes, o = 0) {
  if (bytes.length < o + 4) return null;
  return new DataView(Uint8Array.from(bytes.slice(o, o + 4)).buffer).getFloat32(0, false);
}
function f32Bytes(v) {
  const dv = new DataView(new ArrayBuffer(4));
  dv.setFloat32(0, v, false);
  return Array.from(new Uint8Array(dv.buffer));
}
function u(bytes, o, n) {
  if (bytes.length < o + n) return null;
  let v = 0;
  for (let i = 0; i < n; i++) v = v * 256 + bytes[o + i];
  return v;
}
function packedAscii(bytes, o, n) {
  let s = '';
  for (let i = o; i + 2 < o + n && i + 2 < bytes.length; i += 3) {
    const w = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    for (let k = 3; k >= 0; k--) {
      let c = (w >> (k * 6)) & 0x3f;
      if (!(c & 0x20)) c |= 0x40;
      s += String.fromCharCode(c);
    }
  }
  return s.replace(/\s+$/, '');
}
function packAscii(str, n) {
  const chars = str.toUpperCase().padEnd((n / 3) * 4, ' ').slice(0, (n / 3) * 4);
  const out = [];
  for (let i = 0; i < chars.length; i += 4) {
    let w = 0;
    for (let k = 0; k < 4; k++) w = (w << 6) | (chars.charCodeAt(i + k) & 0x3f);
    out.push((w >> 16) & 0xff, (w >> 8) & 0xff, w & 0xff);
  }
  return out;
}
function latin1(bytes, o, n) {
  return String.fromCharCode(...bytes.slice(o, o + n)).replace(/[\0\s]+$/, '');
}
function hartDate(bytes, o) {
  if (bytes.length < o + 3) return null;
  return `${bytes[o]}/${bytes[o + 1]}/${1900 + bytes[o + 2]}`;
}

// Every 4-byte window read as a float, keeping only plausible engineering values.
// Used when decoding unknown (device-specific) payloads.
function floatLens(bytes) {
  const hits = [];
  for (let o = 0; o + 4 <= bytes.length; o++) {
    const v = f32(bytes, o);
    if (v === null || !isFinite(v)) continue;
    const a = Math.abs(v);
    if (v === 0 || (a > 1e-4 && a < 1e7)) {
      const nice = Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-3 * Math.max(1, a);
      if (v !== 0 || o % 4 === 0) hits.push({ offset: o, value: v, nice });
    }
  }
  return hits;
}

// Common HART engineering unit codes (HCF common tables).
const UNITS = {
  1: 'inH2O@68°F', 2: 'inHg', 3: 'ftH2O', 4: 'mmH2O', 5: 'mmHg', 6: 'psi', 7: 'bar',
  8: 'mbar', 9: 'g/cm²', 10: 'kg/cm²', 11: 'Pa', 12: 'kPa', 13: 'torr', 14: 'atm',
  32: '°C', 33: '°F', 34: '°R', 35: 'K', 36: 'mV', 37: 'Ω', 39: 'mA', 57: '%', 58: 'V',
  237: 'MPa', 238: 'inH2O@4°C', 239: 'mmH2O@4°C', 250: 'not used', 251: 'none',
};
const unitName = c => (c in UNITS ? UNITS[c] : `unit ${c}`);

// ---- src/hart/frame.js ----
// HART data-link frame codec and byte-stream scanner.
// Layer: protocol foundation. No device knowledge lives here.

const FRAME_TYPES = { 1: 'BACK', 2: 'STX', 6: 'ACK' };
const TYPE_CODES = { BACK: 1, STX: 2, ACK: 6 };

function xorChecksum(bytes, start = 0, end = bytes.length) {
  let c = 0;
  for (let i = start; i < end; i++) c ^= bytes[i];
  return c;
}

function toHex(bytes, sep = ' ') {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0').toUpperCase()).join(sep);
}

function isDelimiter(b) {
  return (b & 0x07) in FRAME_TYPES && (b & 0x18) === 0; // async physical layer only
}

// Build a frame. For ACK/BACK pass status: [responseCode, deviceStatus].
function encodeFrame({
  type = 'STX', command, data = [], status = null,
  longAddress = null, pollAddress = 0, primaryMaster = true, burst = false,
  preambles = 5,
}) {
  const delim = TYPE_CODES[type] | (longAddress ? 0x80 : 0);
  const m = (primaryMaster ? 0x80 : 0) | (burst ? 0x40 : 0);
  const body = [delim];
  if (longAddress) body.push(m | (longAddress[0] & 0x3f), ...longAddress.slice(1, 5));
  else body.push(m | (pollAddress & 0x3f));
  const expanded = command > 255;
  const payload = [];
  if (status) payload.push(status[0], status[1]);
  if (expanded) payload.push((command >> 8) & 0xff, command & 0xff);
  payload.push(...data);
  body.push(expanded ? 31 : command, payload.length, ...payload);
  body.push(xorChecksum(body));
  return Uint8Array.from([...new Array(preambles).fill(0xff), ...body]);
}

// Decode one frame starting at the delimiter index. Returns null if incomplete.
function decodeAt(buf, i, preambleCount = 0) {
  const d = buf[i];
  const long = (d & 0x80) !== 0;
  const expBytes = (d >> 5) & 0x03;
  const addrLen = long ? 5 : 1;
  const hdr = 1 + addrLen + expBytes + 2;
  if (buf.length < i + hdr) return null;
  const bc = buf[i + hdr - 1];
  const total = hdr + bc + 1;
  if (buf.length < i + total) return null;

  const raw = buf.slice(i, i + total);
  const type = FRAME_TYPES[d & 0x07];
  const a0 = raw[1];
  const address = {
    master: (a0 & 0x80) ? 'primary' : 'secondary',
    burst: (a0 & 0x40) !== 0,
  };
  if (long) {
    address.long = toHex(raw.slice(1, 6), '');
    address.longBytes = [a0 & 0x3f, ...raw.slice(2, 6)];
  } else {
    address.poll = a0 & 0x3f;
  }
  let p = 1 + addrLen + expBytes;
  let command = raw[p];
  let body = raw.slice(p + 2, p + 2 + bc);

  const f = {
    type,
    dir: type === 'STX' ? 'req' : type === 'ACK' ? 'rsp' : 'burst',
    command,
    expanded: false,
    address,
    byteCount: bc,
    raw: Uint8Array.from(raw),
    preambles: preambleCount,
    checksumOk: xorChecksum(raw, 0, total - 1) === raw[total - 1],
    responseCode: null,
    deviceStatus: null,
    commError: false,
    data: null,
  };

  if (type !== 'STX') {
    if (body.length >= 2) {
      f.commError = (body[0] & 0x80) !== 0;
      f.responseCode = body[0];
      f.deviceStatus = body[1];
      body = body.slice(2);
    }
  }
  if (command === 31 && body.length >= 2) {
    f.command = (body[0] << 8) | body[1];
    f.expanded = true;
    body = body.slice(2);
  }
  f.data = Uint8Array.from(body);
  f.length = total;
  return f;
}

// Incremental scanner. Feed bytes as they arrive (from a log or a live port).
class FrameScanner {
  constructor({ minPreambles = 2 } = {}) {
    this.buf = [];
    this.minPreambles = minPreambles;
    this.skipped = 0;
  }

  push(bytes, meta = {}) {
    for (const b of bytes) this.buf.push(b);
    const out = [];
    for (;;) {
      const r = this._next();
      if (!r) break;
      Object.assign(r, meta);
      out.push(r);
    }
    return out;
  }

  _next() {
    const buf = this.buf;
    let ff = 0;
    for (let i = 0; i < buf.length; i++) {
      const b = buf[i];
      if (b === 0xff) { ff++; continue; }
      if (ff >= this.minPreambles && isDelimiter(b)) {
        const f = decodeAt(buf, i, ff);
        if (!f) return null; // wait for more bytes
        if (!f.checksumOk && f.byteCount > 200) { ff = 0; continue; } // likely false sync
        this.skipped += i - ff;
        this.buf = buf.slice(i + f.length);
        return f;
      }
      ff = 0;
    }
    // keep a tail that could still be a preamble run
    let keep = 0;
    while (keep < buf.length && buf[buf.length - 1 - keep] === 0xff) keep++;
    this.skipped += buf.length - keep;
    this.buf = buf.slice(buf.length - keep);
    return null;
  }

  leftover() { return this.buf.length; }
}

// ---- src/hart/commands.js ----
// Command dictionary: universal + common-practice layers.
// Device-specific commands (128–253) are never defined here; they come from profiles.


function commandClass(n) {
  if (n <= 22 || n === 38 || n === 48) return 'universal';
  if (n === 31) return 'expansion';
  if (n >= 32 && n <= 126) return 'common';
  if (n >= 128 && n <= 253) return 'device';
  if (n > 255) return 'expanded';
  return 'reserved';
}

const RESPONSE_CODES = {
  0: 'Success', 1: 'Undefined', 2: 'Invalid selection', 3: 'Passed parameter too large',
  4: 'Passed parameter too small', 5: 'Too few data bytes received', 6: 'Device-specific command error',
  7: 'In write-protect mode', 8: 'Warning (update failure / set to nearest)', 9: 'Lower range value too high',
  10: 'Lower range value too low', 11: 'Upper range value too high', 12: 'Upper range value too low',
  13: 'Both range values out of limits', 14: 'Warning: span too small', 16: 'Access restricted',
  32: 'Busy', 33: 'Delayed response initiated', 34: 'Delayed response running', 35: 'Delayed response dead',
  36: 'Delayed response conflict', 64: 'Command not implemented',
};
function responseText(rc) {
  if (rc === null || rc === undefined) return '';
  if (rc & 0x80) {
    const bits = [];
    if (rc & 0x40) bits.push('vertical parity');
    if (rc & 0x20) bits.push('overrun');
    if (rc & 0x10) bits.push('framing');
    if (rc & 0x08) bits.push('longitudinal parity');
    if (rc & 0x02) bits.push('buffer overflow');
    return 'Comm error: ' + (bits.join(', ') || 'unspecified');
  }
  return RESPONSE_CODES[rc] || `Code ${rc}`;
}

const STATUS_BITS = [
  [0x80, 'Device malfunction'], [0x40, 'Configuration changed'], [0x20, 'Cold start'],
  [0x10, 'More status available'], [0x08, 'Loop current fixed'], [0x04, 'Loop current saturated'],
  [0x02, 'Non-primary variable out of limits'], [0x01, 'Primary variable out of limits'],
];
const statusText = s => STATUS_BITS.filter(([b]) => s & b).map(([, t]) => t);

const unitVal = (d, o) => ({ unit: unitName(d[o]), value: f32(d, o + 1) });

// Identity reply shared by commands 0, 11, and 21.
// HART Common Tables 6 (alarm selection), 3 (transfer function) and 7 (write protect).
const ALARM_SEL = { 0: 'High', 1: 'Low', 239: 'Hold last value', 250: 'Not used', 251: 'None' };
const TRANSFER_FN = { 0: 'Linear', 1: 'Square root', 4: 'Special curve', 250: 'Not used', 251: 'None' };
const WRITE_PROT = { 0: 'Not protected', 1: 'Write protected', 250: 'Not used', 251: 'None' };
const enumText = (v, table) => v == null ? null : (v in table ? `${v} (${table[v]})` : `${v}`);

function decodeIdentity(d) {
  if (d.length < 12) return null;
  const hartRev = d[4];
  const id = {
    hartRevision: hartRev,
    deviceTypeMsb: d[1],
    deviceType: d[2],
    expandedDeviceType: hartRev >= 7 ? (d[1] << 8) | d[2] : null,
    manufacturerId: hartRev >= 7 ? (d.length >= 19 ? u(d, 17, 2) : null) : d[1],
    minPreambles: d[3],
    deviceRevision: d[5],
    softwareRevision: d[6],
    hardwareRevision: d[7] >> 3,
    signaling: d[7] & 0x07,
    flags: d[8],
    deviceId: u(d, 9, 3),
  };
  if (d.length >= 16) {
    id.maxDeviceVariables = d[13];
    id.configChangeCounter = u(d, 14, 2);
  }
  if (d.length >= 21) id.privateLabel = u(d, 19, 2);
  if (d.length >= 22) id.deviceProfile = d[21];
  return id;
}

// name, rw (r = read, w = write, x = action), req/rsp decoders return plain objects.
const COMMANDS = {
  0: { name: 'Read unique identifier', rw: 'r', rsp: decodeIdentity },
  1: { name: 'Read primary variable', rw: 'r', rsp: d => unitVal(d, 0) },
  2: { name: 'Read loop current and percent of range', rw: 'r', rsp: d => ({ current_mA: f32(d, 0), percent: f32(d, 4) }) },
  3: {
    name: 'Read dynamic variables and loop current', rw: 'r', rsp: d => {
      const r = { current_mA: f32(d, 0) };
      ['PV', 'SV', 'TV', 'QV'].forEach((k, i) => { if (d.length >= 9 + i * 5) r[k] = unitVal(d, 4 + i * 5); });
      return r;
    },
  },
  6: { name: 'Write polling address', rw: 'w', req: d => ({ pollAddress: d[0], loopCurrentMode: d[1] }) },
  7: { name: 'Read loop configuration', rw: 'r', rsp: d => ({ pollAddress: d[0], loopCurrentMode: d[1] }) },
  8: { name: 'Read dynamic variable classifications', rw: 'r', rsp: d => ({ classes: Array.from(d) }) },
  9: {
    name: 'Read device variables with status', rw: 'r',
    req: d => ({ slots: Array.from(d) }),
    rsp: d => {
      const r = { extendedStatus: d[0], slots: [] };
      for (let o = 1; o + 8 <= d.length; o += 8)
        r.slots.push({ code: d[o], class: d[o + 1], unit: unitName(d[o + 2]), value: f32(d, o + 3), status: d[o + 7] });
      return r;
    },
  },
  11: { name: 'Read unique identifier by tag', rw: 'r', req: d => ({ tag: packedAscii(d, 0, 6) }), rsp: decodeIdentity },
  12: { name: 'Read message', rw: 'r', rsp: d => ({ message: packedAscii(d, 0, 24) }) },
  13: { name: 'Read tag, descriptor, date', rw: 'r', rsp: d => ({ tag: packedAscii(d, 0, 6), descriptor: packedAscii(d, 6, 12), date: hartDate(d, 18) }) },
  14: { name: 'Read PV transducer information', rw: 'r', rsp: d => ({ serial: u(d, 0, 3), unit: unitName(d[3]), upperLimit: f32(d, 4), lowerLimit: f32(d, 8), minSpan: f32(d, 12) }) },
  15: {
    name: 'Read device information', rw: 'r', rsp: d => ({
      alarmSelect: enumText(d[0], ALARM_SEL), transferFunction: enumText(d[1], TRANSFER_FN), rangeUnit: unitName(d[2]),
      URV: f32(d, 3), LRV: f32(d, 7), damping_s: f32(d, 11), writeProtect: enumText(d[15], WRITE_PROT),
      ...(d.length >= 17 ? { distributor: d[16] } : {}),
    }),
  },
  16: { name: 'Read final assembly number', rw: 'r', rsp: d => ({ finalAssembly: u(d, 0, 3) }) },
  17: { name: 'Write message', rw: 'w', req: d => ({ message: packedAscii(d, 0, 24) }) },
  18: { name: 'Write tag, descriptor, date', rw: 'w', req: d => ({ tag: packedAscii(d, 0, 6), descriptor: packedAscii(d, 6, 12), date: hartDate(d, 18) }) },
  19: { name: 'Write final assembly number', rw: 'w', req: d => ({ finalAssembly: u(d, 0, 3) }) },
  20: { name: 'Read long tag', rw: 'r', rsp: d => ({ longTag: latin1(d, 0, 32) }) },
  21: { name: 'Read unique identifier by long tag', rw: 'r', rsp: decodeIdentity },
  22: { name: 'Write long tag', rw: 'w', req: d => ({ longTag: latin1(d, 0, 32) }) },
  33: {
    name: 'Read device variables', rw: 'r', req: d => ({ codes: Array.from(d) }),
    rsp: d => { const s = []; for (let o = 0; o + 6 <= d.length; o += 6) s.push({ code: d[o], unit: unitName(d[o + 1]), value: f32(d, o + 2) }); return { slots: s }; },
  },
  34: { name: 'Write PV damping', rw: 'w', req: d => ({ damping_s: f32(d, 0) }) },
  35: { name: 'Write PV range values', rw: 'w', req: d => ({ unit: unitName(d[0]), URV: f32(d, 1), LRV: f32(d, 5) }) },
  36: { name: 'Set PV upper range value', rw: 'x' },
  37: { name: 'Set PV lower range value', rw: 'x' },
  38: { name: 'Reset configuration changed flag', rw: 'x' },
  40: { name: 'Enter/exit fixed current mode', rw: 'x', req: d => ({ current_mA: f32(d, 0) }) },
  41: { name: 'Perform self test', rw: 'x' },
  42: { name: 'Perform device reset', rw: 'x' },
  43: { name: 'Set PV zero', rw: 'x' },
  44: { name: 'Write PV units', rw: 'w', req: d => ({ unit: unitName(d[0]) }) },
  45: { name: 'Trim loop current zero', rw: 'x', req: d => ({ measured_mA: f32(d, 0) }) },
  46: { name: 'Trim loop current gain', rw: 'x', req: d => ({ measured_mA: f32(d, 0) }) },
  47: { name: 'Write PV transfer function', rw: 'w', req: d => ({ transferFunction: d[0] }) },
  48: { name: 'Read additional device status', rw: 'r' },
  50: { name: 'Read dynamic variable assignments', rw: 'r', rsp: d => ({ PV: d[0], SV: d[1], TV: d[2], QV: d[3] }) },
  51: { name: 'Write dynamic variable assignments', rw: 'w', req: d => ({ PV: d[0], SV: d[1], TV: d[2], QV: d[3] }) },
  53: { name: 'Write device variable units', rw: 'w', req: d => ({ code: d[0], unit: unitName(d[1]) }) },
  54: {
    name: 'Read device variable information', rw: 'r', req: d => ({ code: d[0] }),
    rsp: d => ({ code: d[0], serial: u(d, 1, 3), unit: unitName(d[4]), upperLimit: f32(d, 5), lowerLimit: f32(d, 9), damping_s: f32(d, 13), minSpan: f32(d, 17) }),
  },
  55: { name: 'Write device variable damping', rw: 'w', req: d => ({ code: d[0], damping_s: f32(d, 1) }) },
  59: { name: 'Write number of response preambles', rw: 'w', req: d => ({ preambles: d[0] }) },
  71: { name: 'Lock device', rw: 'x' },
  72: { name: 'Squawk', rw: 'x' },
  76: { name: 'Read lock device state', rw: 'r' },
  79: { name: 'Write device variable (simulate)', rw: 'x' },
  80: { name: 'Read device variable trim points', rw: 'r', req: d => ({ code: d[0] }), rsp: d => ({ code: d[0], unit: unitName(d[1]), lower: f32(d, 2), upper: f32(d, 6) }) },
  81: {
    name: 'Read device variable trim guidelines', rw: 'r', req: d => ({ code: d[0] }),
    rsp: d => ({ code: d[0], points: d[1], unit: unitName(d[2]), minLower: f32(d, 3), maxLower: f32(d, 7), minUpper: f32(d, 11), maxUpper: f32(d, 15), minDiff: f32(d, 19) }),
  },
  82: { name: 'Write device variable trim point', rw: 'x', req: d => ({ code: d[0], point: d[1], unit: unitName(d[2]), value: f32(d, 3) }) },
  83: { name: 'Reset device variable trim', rw: 'x', req: d => ({ code: d[0] }) },
  89: { name: 'Set real-time clock', rw: 'w' },
  90: { name: 'Read real-time clock', rw: 'r' },
  103: { name: 'Write burst period', rw: 'w' },
  104: { name: 'Write burst trigger', rw: 'w' },
  105: { name: 'Read burst mode configuration', rw: 'r' },
  107: { name: 'Write burst device variables', rw: 'w' },
  108: { name: 'Write burst mode command number', rw: 'w' },
  109: { name: 'Burst mode control', rw: 'w' },
};

// Commands whose values move on their own; excluded from config-change tracking.
const DYNAMIC_COMMANDS = new Set([1, 2, 3, 9, 33, 48, 90]);

function describeCommand(n, profile = null) {
  const p = profile?.commands?.[n];
  if (p) return { name: p.name, rw: p.rw || '?', layer: 'device', def: p };
  const c = COMMANDS[n];
  const cls = commandClass(n);
  if (c) return { name: c.name, rw: c.rw, layer: cls, def: c };
  if (cls === 'device') return { name: 'Device-specific', rw: '?', layer: 'device', def: null };
  return { name: cls === 'expanded' ? 'Expanded command' : 'Unknown', rw: '?', layer: cls, def: null };
}

function safeDecode(fn, data) {
  if (!fn) return null;
  try { return fn(data); } catch { return null; }
}

// ---- src/capture/importers.js ----
// Turns serial-port-monitor exports into ordered byte chunks with direction tags.
// Handles: HHD Free Serial Port Monitor / Device Monitoring Studio text exports,
// Electronic Team (Eltima) Serial Port Monitor exports, Portmon logs, CSV hex,
// plain hex pastes, and raw binary captures.
// Direction is optional: HART delimiters already identify requests and replies.

const WRITE_RE = /\b(write|written|tx|sent|send|irp_mj_write|master\s*->|request)\b|^\s*>/i;
const READ_RE = /\b(read|rx|received|receive|irp_mj_read|<-\s*slave|response)\b|^\s*</i;
const HEX2 = /^[0-9a-fA-F]{2}$/;
const TIME_RE = /(\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?)/;

function hexRunFromLine(line) {
  // Portmon style: "... Length 10: FF FF ..."
  const lm = line.match(/Length\s+\d+:\s*(.*)$/i);
  if (lm) line = lm[1];
  // Drop a leading offset column like "00000010:" or "0010  "
  line = line.replace(/^\s*[0-9a-fA-F]{4,8}[:h]?\s{1,}(?=[0-9a-fA-F]{2}\b)/, ' ');
  const tokens = line.trim().split(/[\s,;]+/);
  let best = [], cur = [];
  for (const t of tokens) {
    const tt = t.replace(/^0x/i, '');
    if (HEX2.test(tt)) cur.push(parseInt(tt, 16));
    else { if (cur.length > best.length) best = cur; cur = []; }
  }
  if (cur.length > best.length) best = cur;
  return best;
}

// Continuous hex with no spaces, e.g. "FFFFFF0280000082"
function denseHex(line) {
  const m = line.trim().match(/^[0-9a-fA-F]{8,}$/);
  if (!m || m[0].length % 2) return null;
  return m[0].match(/../g).map(h => parseInt(h, 16));
}

function importText(text) {
  const chunks = [];
  let dir = null, time = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, ' ');
    if (!line.trim()) continue;
    const isWrite = WRITE_RE.test(line), isRead = READ_RE.test(line);
    const tm = line.match(TIME_RE);
    if (tm) time = tm[1];
    if (isWrite !== isRead) dir = isWrite ? 'tx' : 'rx';
    if (/ioctl|set_rts|set_dtr|clr_rts|clr_dtr|baud|purge|wait_on_mask|open|close/i.test(line) && !/length\s+\d+:/i.test(line)) continue;
    const bytes = denseHex(line) || hexRunFromLine(line);
    // Ignore lone tokens on header lines (dates, counters).
    if (bytes.length >= 2 || (bytes.length === 1 && /^\s*[0-9a-fA-F]{2}(\s|$)/.test(line))) {
      chunks.push({ bytes, dir, time });
    }
  }
  return chunks;
}

function importBinary(arrayBuffer) {
  return [{ bytes: Array.from(new Uint8Array(arrayBuffer)), dir: null, time: null }];
}

// Decide text vs binary from content.
function importAny(arrayBuffer) {
  const u8 = new Uint8Array(arrayBuffer);
  let printable = 0;
  const n = Math.min(u8.length, 4096);
  for (let i = 0; i < n; i++) {
    const b = u8[i];
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127)) printable++;
  }
  if (n && printable / n > 0.85) return { kind: 'text', chunks: importText(new TextDecoder('latin1').decode(u8)) };
  return { kind: 'binary', chunks: importBinary(arrayBuffer) };
}

// ---- src/capture/session.js ----
// Builds a decoded session from imported chunks:
// frames -> transactions -> identity, config changes, write candidates, profile draft.




const READS_WITH_REQUEST_DATA = new Set([9, 11, 21, 33, 54, 80, 81, 105]);

function framesFromChunks(chunks) {
  const scanners = {};
  const frames = [];
  let seq = 0;
  for (const c of chunks) {
    const key = c.dir || 'any';
    scanners[key] ||= new FrameScanner();
    for (const f of scanners[key].push(c.bytes, { srcDir: c.dir, time: c.time })) {
      f.seq = seq++;
      frames.push(f);
    }
  }
  const leftover = Object.values(scanners).reduce((a, s) => a + s.leftover(), 0);
  const skipped = Object.values(scanners).reduce((a, s) => a + s.skipped, 0);
  return { frames, leftover, skipped };
}

const addrKey = a => a.long || `poll${a.poll}`;

function buildTransactions(frames) {
  const tx = [];
  const pending = [];
  let lastReqRaw = null;
  for (const f of frames) {
    if (f.dir === 'req') {
      const rawHex = toHex(f.raw, '');
      if (rawHex === lastReqRaw && f.srcDir === 'rx') { f.echo = true; continue; } // modem echo
      lastReqRaw = rawHex;
      const t = { req: f, rsp: null, command: f.command, address: addrKey(f.address) };
      pending.push(t);
      tx.push(t);
    } else if (f.dir === 'rsp') {
      lastReqRaw = null;
      let match = null;
      for (let i = pending.length - 1; i >= 0; i--) {
        if (pending[i].command === f.command && pending[i].address === addrKey(f.address)) { match = pending[i]; pending.splice(i, 1); break; }
      }
      if (match) match.rsp = f;
      else tx.push({ req: null, rsp: f, command: f.command, address: addrKey(f.address), orphan: true });
    } else {
      tx.push({ req: null, rsp: f, command: f.command, address: addrKey(f.address), burst: true });
    }
  }
  return tx;
}

function analyze(chunks, { profile = null } = {}) {
  const { frames, leftover, skipped } = framesFromChunks(chunks);
  const tx = buildTransactions(frames);
  let identity = null;
  const lastData = new Map();
  let prevConfigFlag = null;

  tx.forEach((t, i) => {
    t.index = i;
    t.time = t.req?.time || t.rsp?.time || '';
    const info = describeCommand(t.command, profile);
    t.name = info.name;
    t.layer = info.layer;
    t.rw = info.rw;
    t.confidence = info.def?.confidence || null;
    const reqData = t.req?.data || new Uint8Array();
    const rspData = t.rsp?.data || null;
    t.reqHex = toHex(reqData);
    t.rspHex = rspData ? toHex(rspData) : '';
    t.rc = t.rsp?.responseCode ?? null;
    t.rcText = responseText(t.rc);
    t.ok = t.rsp && !t.rsp.commError && (t.rc === 0 || (t.rc >= 8 && t.rc <= 14) || t.rc === 24);
    t.statusFlags = t.rsp ? statusText(t.rsp.deviceStatus) : [];
    t.decodedReq = reqData.length ? safeDecode(info.def?.req, reqData) : null;
    t.decodedRsp = rspData && t.ok ? safeDecode(info.def?.rsp, rspData) : null;
    if (t.layer === 'device' && rspData && rspData.length >= 4) t.floatLens = floatLens(rspData);

    // Identity from the first good command 0 / 11 / 21 reply.
    if (!identity && t.ok && [0, 11, 21].includes(t.command)) identity = decodeIdentity(rspData);

    // Write detection.
    // HART write replies echo the written data, so an unknown command whose reply
    // equals its request data is treated as a candidate write.
    const echoes = rspData && reqData.length > 0 && rspData.length === reqData.length &&
      reqData.every((b, k) => b === rspData[k]);
    t.isWrite = (t.rw === 'w' || t.rw === 'x') ||
      ((t.layer === 'device' || t.layer === 'expanded') && echoes && !READS_WITH_REQUEST_DATA.has(t.command));
    t.writeCertainty = t.rw === 'w' || t.rw === 'x' ? 'known' : t.isWrite ? 'candidate' : null;

    // Configuration-changed flag rising edge marks the write that caused it.
    if (t.rsp) {
      const flag = (t.rsp.deviceStatus & 0x40) !== 0;
      if (flag && prevConfigFlag === false) t.configFlagRose = true;
      prevConfigFlag = flag;
    }

    // Track changed bytes for repeated reads.
    if (rspData && t.ok && !t.isWrite) {
      const key = `${t.address}|${t.command}|${t.reqHex}`;
      const prev = lastData.get(key);
      if (prev && !DYNAMIC_COMMANDS.has(t.command)) {
        const changed = [];
        const n = Math.max(prev.length, rspData.length);
        for (let k = 0; k < n; k++) if (prev[k] !== rspData[k]) changed.push(k);
        if (changed.length) { t.changedIdx = changed; t.prevHex = toHex(prev); }
      }
      lastData.set(key, rspData);
    }
  });

  // Attribute config-flag rises to the nearest preceding write.
  tx.forEach((t, i) => {
    if (!t.configFlagRose) return;
    for (let k = i; k >= 0 && k >= i - 6; k--) if (tx[k].isWrite) { tx[k].causedConfigChange = true; break; }
  });

  const stats = {
    frames: frames.length, transactions: tx.length, leftoverBytes: leftover, skippedBytes: skipped,
    badChecksums: frames.filter(f => !f.checksumOk).length,
    deviceSpecific: [...new Set(tx.filter(t => t.layer === 'device').map(t => t.command))].sort((a, b) => a - b),
    writes: tx.filter(t => t.isWrite).length,
    changes: tx.filter(t => t.changedIdx).length,
    errors: tx.filter(t => t.rsp && !t.ok).length,
  };
  return { tx, identity, stats, latest: lastData };
}

// Compare the last reply for each read between two captures (before / after).
function compareSessions(a, b) {
  const out = [];
  for (const [key, bData] of b.latest) {
    const aData = a.latest.get(key);
    if (!aData || DYNAMIC_COMMANDS.has(+key.split('|')[1])) continue;
    const idx = [];
    for (let k = 0; k < Math.max(aData.length, bData.length); k++) if (aData[k] !== bData[k]) idx.push(k);
    if (idx.length) {
      const [address, command, req] = key.split('|');
      out.push({ address, command: +command, req, before: toHex(aData), after: toHex(bData), changedIdx: idx });
    }
  }
  return out.sort((x, y) => x.command - y.command);
}

const hex2 = n => (n == null ? null : '0x' + n.toString(16).toUpperCase().padStart(2, '0'));

// Draft device profile from a capture. Always unverified until checked on a bench device.
function profileDraft(session, compare = null, label = '') {
  const id = session.identity || {};
  const byCmd = {};
  for (const t of session.tx.filter(t => t.layer === 'device' || t.layer === 'expanded')) {
    const c = (byCmd[t.command] ||= { command: t.command, requests: new Set(), responseLengths: new Set(), writes: 0, causedConfigChange: false, changedBytes: new Set(), samples: [] });
    c.requests.add(t.reqHex);
    if (t.rsp) c.responseLengths.add(t.rsp.data.length);
    if (t.isWrite) c.writes++;
    if (t.causedConfigChange) c.causedConfigChange = true;
    (t.changedIdx || []).forEach(k => c.changedBytes.add(k));
    if (c.samples.length < 6) c.samples.push({ req: t.reqHex, rsp: t.rspHex, rc: t.rc });
  }
  const commands = Object.values(byCmd).map(c => ({
    command: c.command,
    name: null,
    rw: c.writes ? 'w?' : 'r',
    requestVariants: [...c.requests],
    responseLengths: [...c.responseLengths],
    causedConfigChange: c.causedConfigChange,
    changedResponseBytes: [...c.changedBytes].sort((a, b) => a - b),
    samples: c.samples,
  }));
  return {
    schema: 'hart-profile-draft/0.1',
    verified: false,
    label,
    match: {
      manufacturerId: hex2(id.manufacturerId),
      deviceType: hex2(id.deviceType),
      expandedDeviceType: id.expandedDeviceType != null ? '0x' + id.expandedDeviceType.toString(16).toUpperCase().padStart(4, '0') : null,
      deviceRevision: id.deviceRevision ?? null,
      hartRevision: id.hartRevision ?? null,
    },
    deviceSpecificCommands: commands,
    abChanges: compare || [],
    notes: ['Generated from a serial capture. Field meanings are unconfirmed until verified on a bench device.'],
  };
}

// Plain-text report for pasting into a chat for decoding help.
function textReport(session, compare = null, label = '') {
  const L = [];
  const id = session.identity;
  L.push(`HART capture report${label ? ' — ' + label : ''}`);
  if (id) L.push(`Device: mfr ${hex2(id.manufacturerId)} type ${id.expandedDeviceType != null ? id.expandedDeviceType.toString(16) : hex2(id.deviceType)} devrev ${id.deviceRevision} HART ${id.hartRevision} id ${id.deviceId}`);
  const s = session.stats;
  L.push(`Frames ${s.frames}, transactions ${s.transactions}, writes ${s.writes}, changes ${s.changes}, errors ${s.errors}, bad checksums ${s.badChecksums}`);
  L.push(`Device-specific commands: ${s.deviceSpecific.join(', ') || 'none'}`);
  L.push('');
  for (const t of session.tx) {
    if (!(t.layer === 'device' || t.layer === 'expanded' || t.isWrite || t.changedIdx)) continue;
    const flags = [t.isWrite && 'WRITE', t.causedConfigChange && 'CFG-CHANGED', t.changedIdx && 'CHANGED[' + t.changedIdx.join(',') + ']'].filter(Boolean).join(' ');
    L.push(`#${t.index} cmd ${t.command} ${t.name} ${flags}`);
    if (t.reqHex) L.push(`  req: ${t.reqHex}`);
    if (t.rsp) L.push(`  rsp: rc=${t.rc} st=${hex2(t.rsp.deviceStatus)} ${t.rspHex}`);
    if (t.prevHex) L.push(`  was: ${t.prevHex}`);
    if (t.decodedRsp && (t.layer === 'device' || t.layer === 'expanded'))
      for (const [k, v] of Object.entries(t.decodedRsp)) if (v != null) L.push(`  = ${k}: ${typeof v === 'number' && !Number.isInteger(v) ? +v.toPrecision(7) : v}`);
  }
  // Identity, serial numbers and range: the last reply of each, so one pasted report is enough to decode from.
  const idCmds = [0, 13, 14, 15, 16, 20];
  const lastOf = n => [...session.tx].reverse().find(t => t.command === n && t.ok);
  const idTx = idCmds.map(lastOf).filter(Boolean);
  if (idTx.length) {
    L.push('', 'Identity and range (last reply of each):');
    for (const t of idTx) {
      L.push(`#${t.index} cmd ${t.command} ${t.name}`);
      L.push(`  rsp: rc=${t.rc} st=${hex2(t.rsp.deviceStatus)} ${t.rspHex}`);
      if (t.decodedRsp) for (const [k, v] of Object.entries(t.decodedRsp))
        if (v != null && typeof v !== 'object') L.push(`  = ${k}: ${typeof v === 'number' && !Number.isInteger(v) ? +v.toPrecision(7) : v}`);
    }
  }
  if (compare?.length) {
    L.push('', 'Before/after differences:');
    for (const c of compare) L.push(`  cmd ${c.command} [${c.req}] bytes ${c.changedIdx.join(',')}\n    before ${c.before}\n    after  ${c.after}`);
  }
  return L.join('\n');
}

// ---- src/capture/live.js ----
// Passive listen mode: a second HART modem on the loop records every frame
// between AMS (or any master) and the transmitter. This code never transmits.
//
// Two routes, same as the main app:
//   Web Serial  — Edge/Chrome on Windows, and Android where the Serial API is available
//   WebUSB      — Chrome on Android, through usb-serial.js (CP210x, FTDI, PL2303, CH34x, CDC, Viator)
//
// Line settings: 1200 baud, 8 data bits, odd parity, 1 stop bit.
// RTS is held low so the modem stays in receive mode.

const CP210X_VID = 0x10c4;
const HART_BAUD = 1200;


function liveSupport() {
  return {
    serial: typeof navigator !== 'undefined' && 'serial' in navigator,
    usb: typeof navigator !== 'undefined' && 'usb' in navigator,
  };
}

class SerialListener {
  constructor(port) { this.port = port; this.kind = 'Web Serial'; this.reader = null; }
  async open() {
    await this.port.open({ baudRate: HART_BAUD, dataBits: 8, parity: 'odd', stopBits: 1, bufferSize: 4096 });
    try { await this.port.setSignals({ requestToSend: false, dataTerminalReady: true }); } catch { /* not all drivers allow it */ }
  }
  async run(onBytes, isRunning) {
    while (isRunning() && this.port.readable) {
      this.reader = this.port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value?.length) onBytes(value);
        }
      } catch (e) {
        if (!isRunning()) break;
        // Framing or parity errors throw once; the stream reopens on the next loop.
        onBytes(null, e);
      } finally { this.reader.releaseLock(); this.reader = null; }
    }
  }
  async close() {
    try { await this.reader?.cancel(); } catch {}
    try { await this.port.close(); } catch {}
  }
}

// WebUSB listener on any modem chip usb-serial.js supports (CP210x, FTDI, PL2303, CH34x, CDC,
// P+F Viator). RTS is driven low once at open so the modem stays in receive mode; nothing is written.
class UsbListener {
  constructor(device) { this.dev = device; this.kind = 'WebUSB'; this.stopped = false; this.port = null; }
  async open() {
    if (!window.USBSerial) throw new Error('The USB driver did not load. Reload the page.');
    this.port = await window.USBSerial.openDevice(this.dev, { chip: 'auto', dtr: true });
    this.kind = `WebUSB (${this.port.name})`;
  }
  async run(onBytes, isRunning) {
    while (isRunning() && !this.stopped) {
      try {
        const b = await this.port.read();
        if (b.length) onBytes(b);
      } catch (e) {
        if (!isRunning() || this.stopped) break;
        onBytes(null, e);
        break; // device unplugged or released
      }
    }
  }
  async close() {
    this.stopped = true;
    try { await this.port?.close(); } catch {}
  }
}
// Kept for anything that still refers to the v4.0 name.
const Cp210xListener = UsbListener;

async function requestListener(route) {
  const U = window.USBSerial;
  if (route === 'serial') {
    const filters = U ? U.serialFilters() : [{ usbVendorId: CP210X_VID }];
    const port = await navigator.serial.requestPort({ filters })
      .catch(e => { if (e.name === 'NotFoundError') return navigator.serial.requestPort(); throw e; });
    return new SerialListener(port);
  }
  const device = U ? await U.requestDevice() : await navigator.usb.requestDevice({ filters: [{ vendorId: CP210X_VID }] });
  return new UsbListener(device);
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
const stamp = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;

// Recording session. Chunks use the same shape as the file importers,
// so live and imported captures go through one analysis path.
class Recorder {
  constructor() { this.chunks = []; this.bytes = 0; this.errors = 0; this.started = new Date(); }
  add(bytes) {
    this.chunks.push({ bytes: Array.from(bytes), dir: null, time: stamp() });
    this.bytes += bytes.length;
  }
  // Text log the importers read back, for saving and later comparison.
  toText(label = '') {
    const L = [`HART listen capture${label ? ' — ' + label : ''}`, `Started ${this.started.toISOString()}`, ''];
    for (const c of this.chunks) {
      L.push(`[${c.time}] Monitor data`);
      for (let i = 0; i < c.bytes.length; i += 16)
        L.push('    ' + c.bytes.slice(i, i + 16).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' '));
    }
    return L.join('\n');
  }
}

async function listen(listener, { onChunk, onError, isRunning }) {
  await listener.open();
  listener.run((bytes, err) => {
    if (err) onError?.(err);
    else onChunk(bytes);
  }, isRunning).catch(e => onError?.(e));
}

// Synthetic demo capture (AMS-style serial monitor export) for trying the decoder.
const DEMO_CAPTURE = "Serial Port Monitor export\nPort opened by process \"AMS Device Configurator.exe\" (PID: 12 34)\nIOCTL_SERIAL_SET_RTS\n[05/10/2026 10:15:00.137] Written data (COM4)\n    ff ff ff ff ff 02 80 00 00 82                     ..........\n[05/10/2026 10:15:00.274] Read data (COM4)\n    ff ff ff 06 80 00 18                              .......\n[05/10/2026 10:15:00.411] Read data (COM4)\n    00 00 fe e0 f0 05 07 03 02 08 00 12 34 56 05 08   ............4V..\n    00 01 00 00 26 00 26 00 07                        ....&.&..\n[05/10/2026 10:15:00.548] Written data (COM4)\n    ff ff ff ff ff 82 a6 e0 12 34 56 0d 00 b9         .........4V...\n[05/10/2026 10:15:00.685] Read data (COM4)\n    ff ff ff 86 a6 e0 12                              .......\n[05/10/2026 10:15:00.822] Read data (COM4)\n    34 56 0d 17 00 00 51 4b 71 c3 18 20 08 53 83 22   4V....QKq.. .S.\"\n    05 05 4d 48 20 82 08 20 03 0a 7e 38               ..MH .. ..~8\n[05/10/2026 10:15:00.959] Written data (COM4)\n    ff ff ff ff ff 82 a6 e0 12 34 56 0f 00 bb         .........4V...\n[05/10/2026 10:15:01.096] Read data (COM4)\n    ff ff ff 86 a6 e0 12                              .......\n[05/10/2026 10:15:01.233] Read data (COM4)\n    34 56 0f 14 00 00 00 00 20 43 16 00 00 00 00 00   4V...... C......\n    00 40 00 00 00 fb fa 00 9f                        .@.......\n[05/10/2026 10:15:01.370] Written data (COM4)\n    ff ff ff ff ff 82 a6 e0 12 34 56 32 00 86         .........4V2..\n[05/10/2026 10:15:01.507] Read data (COM4)\n    ff ff ff 86 a6 e0 12                              .......\n[05/10/2026 10:15:01.644] Read data (COM4)\n    34 56 32 06 00 00 00 01 02 03 84                  4V2........\n[05/10/2026 10:15:01.781] Written data (COM4)\n    ff ff ff ff ff 82 a6 e0 12 34 56 8c 01 00 39      .........4V...9\n[05/10/2026 10:15:01.918] Read data (COM4)\n    ff ff ff 86 a6 e0 12                              .......\n[05/10/2026 10:15:02.055] Read data (COM4)\n    34 56 8c 09 00 00 00 02 04 3b 7c 50 48 6c         4V.......;|PHl\n[05/10/2026 10:15:02.192] Written data (COM4)\n    ff ff ff ff ff 82 a6 e0 12 34 56 03 00 b7         .........4V...\n[05/10/2026 10:15:02.329] Read data (COM4)\n    ff ff ff 86 a6 e0 12                              .......\n[05/10/2026 10:15:02.466] Read data (COM4)\n    34 56 03 0b 00 00 41 13 33 33 20 42 51 99 9a da   4V....A.33 BQ...\n[05/10/2026 10:15:02.603] Written data (COM4)\n    ff ff ff ff ff 82 a6 e0 12 34 56 8d 03 00 07 00   .........4V.....\n    3d                                                =\n[05/10/2026 10:15:02.740] Read data (COM4)\n    ff ff ff 86 a6 e0 12                              .......\n[05/10/2026 10:15:02.877] Read data (COM4)\n    34 56 8d 05 00 00 00 07 00 3f                     4V.......?\n[05/10/2026 10:15:03.014] Written data (COM4)\n    ff ff ff ff ff 82 a6 e0 12 34 56 8c 01 00 39      .........4V...9\n[05/10/2026 10:15:03.151] Read data (COM4)\n    ff ff ff 86 a6 e0 12                              .......\n[05/10/2026 10:15:03.288] Read data (COM4)\n    34 56 8c 09 00 40 00 07 00 00 00 00 00 72         4V...@.......r\n[05/10/2026 10:15:03.425] Written data (COM4)\n    ff ff ff ff ff 82 a6 e0 12 34 56 03 00 b7         .........4V...\n[05/10/2026 10:15:03.562] Read data (COM4)\n    ff ff ff 86 a6 e0 12                              .......\n[05/10/2026 10:15:03.699] Read data (COM4)\n    34 56 03 0b 00 40 41 16 66 66 20 42 54 66 66 99   4V...@A.ff BTff.\n[05/10/2026 10:15:03.836] Written data (COM4)\n    ff ff ff ff ff 82 a6 e0 12 34 56 26 00 92         .........4V&..\n[05/10/2026 10:15:03.973] Read data (COM4)\n    ff ff ff 86 a6 e0 12                              .......\n[05/10/2026 10:15:04.110] Read data (COM4)\n    34 56 26 02 00 40 d4                              4V&..@.\n[05/10/2026 10:15:04.247] Written data (COM4)\n    ff ff ff ff ff 82 a6 e0 12 34 56 30 00 84         .........4V0..\n[05/10/2026 10:15:04.384] Read data (COM4)\n    ff ff ff 86 a6 e0 12                              .......\n[05/10/2026 10:15:04.521] Read data (COM4)\n    34 56 30 08 00 00 00 00 00 00 00 00 88            4V0..........";

window.HART = {
  f32, f32Bytes, u, packedAscii, packAscii, latin1, hartDate, floatLens, UNITS, unitName,
  FRAME_TYPES, xorChecksum, toHex, isDelimiter, encodeFrame, decodeAt, FrameScanner,
  commandClass, RESPONSE_CODES, responseText, STATUS_BITS, statusText, decodeIdentity, COMMANDS, DYNAMIC_COMMANDS,
  describeCommand, safeDecode,
  importText, importBinary, importAny,
  framesFromChunks, buildTransactions, analyze, compareSessions, profileDraft, textReport,
  CP210X_VID, liveSupport, SerialListener, UsbListener, Cp210xListener, requestListener, Recorder, listen, stamp,
  DEMO_CAPTURE,
};
})();
