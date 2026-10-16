/* Built-in device simulator for practising and testing without a modem or loop.
   Two devices share the simulated loop:
     poll 0  temperature transmitter, HART 5 (identifies as Rosemount 644, device revision 8)
     poll 1  pressure transmitter, HART 7 (identifies as Rosemount 3051C, device revision 10)
   Universal and common-practice replies follow the HART layouts used by the app.
   The temperature device's Commands 140/141 use a SIMULATOR-ONLY layout
   ([sensor type, wiring]). It is not the Rosemount layout. Templates learned from the
   simulator are stored separately and are never applied to a real device. */
(() => {
'use strict';
const H = window.HART;
const SIM_IDS = [0x5a1001, 0x5a1002];

const fb = v => H.f32Bytes(v);
const id3 = n => [(n >> 16) & 255, (n >> 8) & 255, n & 255];

function makeDevices() {
  const base = {
    tag: 'TT-101', desc: 'SIM TEMPERATURE', date: [16, 10, 126], msg: 'SIMULATED DEVICE', longTag: 'Simulated temperature transmitter',
    fan: 644001, cfgChanged: false, coldStart: true, fixed: null, lrv: 0, urv: 100, units: 32, damping: 1, alarm: 0, transfer: 0, wp: 0,
    trimLo: 0, trimHi: 0, cfgCounter: 3,
  };
  const t644 = {
    ...base, name: 'temperature', poll: 0, hart: 5, mfr: 0x26, type: 0x18, devRev: 8, swRev: 7, hwRev: 4, id: SIM_IDS[0], preambles: 5,
    sensorType: 1, connection: 4,
    pv() { return 21.5 + Math.sin(Date.now() / 6000) * 0.4 + (Math.random() - 0.5) * 0.04; },
    pvLimits: { lo: -200, hi: 850, minSpan: 10 },
  };
  const p3051 = {
    ...base, name: 'pressure', poll: 1, hart: 7, mfr: 0x26, type: 0x2606, devRev: 10, swRev: 3, hwRev: 2, id: SIM_IDS[1], preambles: 5,
    tag: 'PT-205', desc: 'SIM PRESSURE', msg: 'SIMULATED DEVICE', longTag: 'Simulated pressure transmitter', fan: 3051001,
    lrv: 0, urv: 250, units: 12, damping: 0.4, zeroOffset: 0, trimLo: 0, trimHi: 0,
    pv() { return 102.4 + Math.sin(Date.now() / 4000) * 1.2 + (Math.random() - 0.5) * 0.1 - this.zeroOffset; },
    pvLimits: { lo: -250, hi: 250 * 4, minSpan: 2.5 },
  };
  return [t644, p3051];
}

function current(d) {
  if (d.fixed != null) return d.fixed;
  const pct = (d.pv() - d.lrv) / (d.urv - d.lrv);
  return Math.min(20.8, Math.max(3.8, 4 + 16 * pct));
}

function identity(d) {
  const typeHi = d.hart >= 7 ? (d.type >> 8) & 255 : d.mfr;
  const out = [254, typeHi, d.type & 255, d.preambles, d.hart, d.devRev, d.swRev, (d.hwRev << 3) | 0, 0, ...id3(d.id)];
  if (d.hart >= 6) out.push(d.preambles, 4, (d.cfgCounter >> 8) & 255, d.cfgCounter & 255, 0);
  if (d.hart >= 7) out.push(0, d.mfr, 0, d.mfr, 1);
  return out;
}

function status(d) { return (d.cfgChanged ? 0x40 : 0) | (d.coldStart ? 0x20 : 0) | (d.fixed != null ? 0x08 : 0); }

// Returns [responseCode, dataBytes]
function handle(d, cmd, q) {
  const pv = d.pv();
  const changed = () => { d.cfgChanged = true; d.cfgCounter = (d.cfgCounter + 1) & 0xffff; };
  switch (cmd) {
    case 0: case 11: case 21: return [0, identity(d)];
    case 1: return [0, [d.units, ...fb(pv)]];
    case 2: { const mA = current(d); return [0, [...fb(mA), ...fb((mA - 4) / 16 * 100)]]; }
    case 3: { const vars = [[d.units, pv]]; if (d.name === 'temperature') vars.push([32, 24.1 + Math.random() * 0.05]); return [0, [...fb(current(d)), ...vars.flatMap(([u, v]) => [u, ...fb(v)])]]; }
    case 6: d.poll = q[0] & 63; changed(); return [0, d.hart >= 6 ? [q[0], q[1] ?? 1] : [q[0]]];
    case 7: return [0, [d.poll, 1]];
    case 8: return [0, [64, 64, 250, 250]];
    case 9: {
      if (d.hart < 6) return [64, []];
      const out = [0];
      for (const c of q.slice(0, 8)) {
        if (c > 1) return [2, []];
        out.push(c, d.name === 'temperature' ? 64 : 65, c === 0 ? d.units : 32, ...fb(c === 0 ? pv : 24.1), 0xc0);
      }
      return [0, out];
    }
    case 12: return [0, H.packAscii(d.msg, 24)];
    case 13: return [0, [...H.packAscii(d.tag, 6), ...H.packAscii(d.desc, 12), ...d.date]];
    case 14: return [0, [...id3(d.id), d.units, ...fb(d.pvLimits.hi), ...fb(d.pvLimits.lo), ...fb(d.pvLimits.minSpan)]];
    case 15: return [0, [d.alarm, d.transfer, d.units, ...fb(d.urv), ...fb(d.lrv), ...fb(d.damping), d.wp, 250, 0]];
    case 16: return [0, id3(d.fan)];
    case 17: d.msg = H.packedAscii(q, 0, 24); changed(); return [0, q.slice(0, 24)];
    case 18: d.tag = H.packedAscii(q, 0, 6); d.desc = H.packedAscii(q, 6, 12); d.date = q.slice(18, 21); changed(); return [0, q.slice(0, 21)];
    case 20: return d.hart >= 6 ? [0, Array.from(d.longTag.padEnd(32, ' ').slice(0, 32), c => c.charCodeAt(0))] : [64, []];
    case 22: if (d.hart < 6) return [64, []]; d.longTag = String.fromCharCode(...q.slice(0, 32)).trim(); changed(); return [0, q.slice(0, 32)];
    case 34: d.damping = H.f32(q, 0); changed(); return [0, q.slice(0, 4)];
    case 35: {
      const urv = H.f32(q, 1), lrv = H.f32(q, 5);
      if (Math.abs(urv - lrv) < d.pvLimits.minSpan) return [14, q.slice(0, 9)];
      d.units = q[0]; d.urv = urv; d.lrv = lrv; changed(); return [0, q.slice(0, 9)];
    }
    case 36: d.urv = pv; changed(); return [0, []];
    case 37: { const span = d.urv - d.lrv; d.lrv = pv; d.urv = pv + span; changed(); return [0, []]; }
    case 38: d.cfgChanged = false; return [0, q.slice(0, 2)];
    case 40: { const v = H.f32(q, 0); d.fixed = v === 0 ? null : v; return [0, q.slice(0, 4)]; }
    case 42: d.coldStart = true; d.fixed = null; return [0, []];
    case 43: if (d.name !== 'pressure') return [64, []]; d.zeroOffset += pv; changed(); return [0, []];
    case 44: d.units = q[0]; changed(); return [0, [q[0]]];
    case 45: if (Math.abs((d.fixed ?? 0) - 4) > 0.01) return [9, []]; changed(); return [0, q.slice(0, 4)];
    case 46: if (Math.abs((d.fixed ?? 0) - 20) > 0.01) return [9, []]; changed(); return [0, q.slice(0, 4)];
    case 48: return [0, [0, 0, 0, 0, 0, 0, 0, 0, 0]];
    case 50: return [0, [0, d.name === 'temperature' ? 1 : 250, 250, 250]];
    case 51: return d.hart >= 6 ? (changed(), [0, q.slice(0, 4)]) : [64, []];
    case 54: {
      if (d.hart < 6) return [64, []];
      const c = q[0]; if (c > 0) return [2, []];
      return [0, [c, ...id3(d.id), d.units, ...fb(d.pvLimits.hi), ...fb(d.pvLimits.lo), ...fb(d.damping), ...fb(d.pvLimits.minSpan), 65, 0]];
    }
    case 80: if (d.name !== 'pressure') return [64, []]; return [0, [0, d.units, ...fb(d.trimLo), ...fb(d.trimHi)]];
    case 81: if (d.name !== 'pressure') return [64, []]; return [0, [0, 3, d.units, ...fb(-25), ...fb(25), ...fb(50), ...fb(1000), ...fb(10)]];
    case 82: if (d.name !== 'pressure') return [64, []]; if (q[1] === 1) d.trimLo = H.f32(q, 3); else d.trimHi = H.f32(q, 3); changed(); return [0, q.slice(0, 7)];
    case 83: if (d.name !== 'pressure') return [64, []]; d.trimLo = d.trimHi = 0; changed(); return [0, [q[0]]];
    // Simulator-only layout, see header comment.
    case 140: if (d.name !== 'temperature') return [64, []]; return [0, [d.sensorType, d.connection]];
    case 141: {
      if (d.name !== 'temperature') return [64, []];
      if (q.length < 2) return [5, []];
      const typeChanged = q[0] !== d.sensorType;
      d.sensorType = q[0]; d.connection = q[1]; changed();
      return [typeChanged ? 8 : 0, q.slice(0, 2)];
    }
    default: return [64, []];
  }
}

class SimBus {
  constructor() { this.devices = makeDevices(); this.scanner = new H.FrameScanner(); }
  // Takes raw bytes written by the host. Returns reply frames as byte arrays.
  write(bytes) {
    const out = [];
    for (const f of this.scanner.push(Array.from(bytes))) {
      if (f.type !== 'STX' || !f.checksumOk) continue;
      let d;
      if (f.address.longBytes) {
        const [a0, a1, ...rest] = f.address.longBytes;
        d = this.devices.find(x => {
          const hi = x.hart >= 7 ? (x.type >> 8) & 0x3f : x.mfr & 0x3f;
          return hi === a0 && (x.type & 255) === a1 && rest.every((b, i) => b === id3(x.id)[i]);
        });
      } else {
        d = this.devices.find(x => x.poll === f.address.poll);
        if (d && f.command !== 0) d = null; // short frames only for Command 0
      }
      if (!d) continue;
      const [rc, data] = handle(d, f.command, Array.from(f.data));
      const st = status(d);
      if (d.coldStart && f.command !== 0) d.coldStart = false;
      const addr = f.address.longBytes ? [(f.raw[1] & 0xc0) | f.address.longBytes[0], ...f.address.longBytes.slice(1)] : [f.raw[1]];
      const body = [f.address.longBytes ? 0x86 : 0x06, ...addr, f.command, data.length + 2, rc, st, ...data];
      body.push(H.xorChecksum(body));
      out.push(Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0xff, ...body]));
    }
    return out;
  }
}

const isSimId = n => SIM_IDS.includes(n);

window.HARTSim = { SimBus, SIM_IDS, isSimId };
})();
