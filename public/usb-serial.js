/* USB serial drivers for WebUSB (window.USBSerial).
   Chrome on Android has no serial driver for USB HART modems, so the app drives the modem's
   USB-to-serial chip directly. This file covers the chips HART modems are built on:

     CP210x   Silicon Labs AN571 (USBXpress/VCP interface specification)
     FTDI     FT232/FT2232 vendor requests, as used by the Linux ftdi_sio driver
     PL2303   Prolific vendor init + CDC line coding, as used by the Linux pl2303 driver
     CH34x    WCH vendor requests, as used by the Linux ch341 driver
     CDC-ACM  USB Communications Device Class 1.2 (SET_LINE_CODING, SET_CONTROL_LINE_STATE)

   Modems with their own vendor ID (for example the Pepperl+Fuchs Viator USB, VID 0x10E5)
   are opened with chip "auto": the descriptors and a few harmless read requests decide which
   driver fits. Every open writes a descriptor summary to the log so an unknown modem can be
   identified from a shared log.

   Line settings are fixed by HART FSK: 1200 baud, 8 data bits, odd parity, 1 stop bit. */
(() => {
'use strict';

const BAUD = 1200;
const h4 = n => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(4, '0');

// Known modems. `chip: 'auto'` means the chip is identified when the modem is opened.
const MODEMS = [
  { vendorId: 0x10E5, productId: 0x0031, name: 'Pepperl+Fuchs / MACTek Viator USB HART', chip: 'auto' },
  { vendorId: 0x10E5, name: 'MACTek / Pepperl+Fuchs Viator', chip: 'auto' },
  { vendorId: 0x10C4, name: 'Silicon Labs CP210x', chip: 'cp210x' },
  { vendorId: 0x0403, name: 'FTDI', chip: 'ftdi' },
  { vendorId: 0x067B, name: 'Prolific PL2303', chip: 'pl2303' },
  { vendorId: 0x1A86, name: 'WCH CH340/CH341', chip: 'ch34x' },
];

// Shown by the browser's device picker. Class 0x02 adds generic CDC-ACM modems.
const usbFilters = () => [
  ...MODEMS.filter(m => m.productId == null).map(m => ({ vendorId: m.vendorId })),
  { classCode: 0x02 },
];
const serialFilters = () => MODEMS.filter(m => m.productId == null).map(m => ({ usbVendorId: m.vendorId }));

function knownModem(d) {
  return MODEMS.find(m => m.vendorId === d.vendorId && m.productId === d.productId)
      || MODEMS.find(m => m.vendorId === d.vendorId && m.productId == null) || null;
}

// One-line-per-interface summary for the log.
function describe(d) {
  const L = [`USB device VID=${h4(d.vendorId)} PID=${h4(d.productId)} bcdDevice=${d.deviceVersionMajor}.${d.deviceVersionMinor}${d.deviceVersionSubminor}`
    + ` class=${d.deviceClass} "${d.manufacturerName || ''}" "${d.productName || ''}"`];
  for (const itf of d.configuration?.interfaces || []) {
    const a = itf.alternate;
    const eps = a.endpoints.map(e => `${e.direction}/${e.type}#${e.endpointNumber}(${e.packetSize})`).join(' ');
    L.push(`  interface ${itf.interfaceNumber}: class=${a.interfaceClass} sub=${a.interfaceSubclass} proto=${a.interfaceProtocol} ${eps || 'no endpoints'}`);
  }
  return L;
}

const bulk = (itf, dir) => itf?.alternate.endpoints.find(e => e.direction === dir && e.type === 'bulk');
const hasIntr = itf => !!itf?.alternate.endpoints.find(e => e.type === 'interrupt');

async function inReq(d, setup, len) {
  try {
    const r = await d.controlTransferIn(setup, len);
    return r.status === 'ok' && r.data ? new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength) : null;
  } catch { return null; }
}

// Identify the chip from descriptors, then read-only vendor requests (no writes, no line changes).
async function detectChip(d, log) {
  const itfs = d.configuration.interfaces;
  if (itfs.some(i => i.alternate.interfaceClass === 0x0A)) return 'cdc';
  const i0 = itfs[0];
  const vend = (request, value = 0, index = 0, recipient = 'device') => ({ requestType: 'vendor', recipient, request, value, index });

  const probes = {
    // FTDI GET_MODEM_STATUS: 2 bytes, low nibble of byte 0 is always 0001.
    ftdi: async () => { const b = await inReq(d, vend(0x05, 0, 0), 2); return b?.length === 2 && (b[0] & 0x0F) === 0x01; },
    // CP210x GET_LINE_CTL: 2 bytes, word length 5–8 in the high byte.
    cp210x: async () => { const b = await inReq(d, vend(0x04, 0, i0.interfaceNumber, 'interface'), 2); return b?.length === 2 && b[1] >= 5 && b[1] <= 8; },
    // PL2303 vendor read of register 0x8484: 1 byte.
    pl2303: async () => { const b = await inReq(d, vend(0x01, 0x8484, 0), 1); return b?.length === 1; },
    // CH34x GET_VERSION: 2 bytes.
    ch34x: async () => { const b = await inReq(d, vend(0x5F, 0, 0), 2); return b?.length === 2 && b[0] !== 0; },
  };
  // PL2303 and CH34x have an interrupt endpoint beside the bulk pair; FTDI and CP210x don't.
  const order = hasIntr(i0) ? ['pl2303', 'ch34x', 'ftdi', 'cp210x'] : ['ftdi', 'cp210x', 'pl2303', 'ch34x'];
  for (const chip of order) {
    if (await probes[chip]()) { log?.(`USB chip probe: ${chip} answered`); return chip; }
  }
  return null;
}

/* ---------------- Chip drivers ----------------
   Each driver: init(), setRTS(on), setDTR(on), strip(bytes) for incoming data, shutdown(). */

const drivers = {
  // Silicon Labs AN571.
  cp210x: p => {
    const ctrl = (request, value, data) => p.out({ requestType: 'vendor', recipient: 'interface', request, value, index: p.ifNum }, data);
    let mhs = 0;
    return {
      async init() {
        await ctrl(0x00, 0x0001);                                    // IFC_ENABLE
        const baud = new DataView(new ArrayBuffer(4)); baud.setUint32(0, BAUD, true);
        await ctrl(0x1E, 0, baud.buffer);                            // SET_BAUDRATE
        await ctrl(0x03, 0x0810);                                    // SET_LINE_CTL 8 data, odd, 1 stop
        try { await ctrl(0x12, 0x000F); } catch {}                   // PURGE
      },
      async setRTS(on) { await ctrl(0x07, on ? 0x0202 : 0x0200); },  // SET_MHS, RTS mask + value
      async setDTR(on) { await ctrl(0x07, on ? 0x0101 : 0x0100); },
      strip: b => b,
      async shutdown() { await ctrl(0x00, 0x0000); },
    };
  },

  // FTDI: reset, 1200 baud (3 MHz / 2500), 8O1, no flow control. Every IN packet starts with 2 status bytes.
  ftdi: p => {
    const port = p.multi ? p.ifNum + 1 : 0;
    const ctrl = (request, value, index = port) => p.out({ requestType: 'vendor', recipient: 'device', request, value, index });
    let dtr = 0, rts = 0;
    return {
      async init() {
        await ctrl(0x00, 0x0000);                                    // RESET SIO
        await ctrl(0x03, 3000000 / BAUD, port);                      // SET_BAUD_RATE divisor 2500
        await ctrl(0x04, 0x0008 | (1 << 8) | (0 << 11));             // SET_DATA 8 bits, odd, 1 stop
        await ctrl(0x02, 0x0000);                                    // SET_FLOW_CTRL none
        try { await ctrl(0x09, 16); } catch {}                       // latency timer 16 ms
        try { await ctrl(0x00, 0x0001); await ctrl(0x00, 0x0002); } catch {}   // purge RX/TX
      },
      async setRTS(on) { rts = on; await ctrl(0x01, on ? 0x0202 : 0x0200); },
      async setDTR(on) { dtr = on; await ctrl(0x01, on ? 0x0101 : 0x0100); },
      strip(b) {
        const size = p.packetIn, out = [];
        for (let i = 0; i < b.length; i += size) for (let j = i + 2; j < Math.min(i + size, b.length); j++) out.push(b[j]);
        return new Uint8Array(out);
      },
      async shutdown() { try { await ctrl(0x01, 0x0300); } catch {} },
    };
  },

  // Prolific: vendor init sequence (not needed on HXN parts), then CDC line coding.
  pl2303: p => {
    const hxn = p.dev.vendorId === 0x067B && [0x23A3, 0x23B3, 0x23C3, 0x23D3, 0x23E3, 0x23F3].includes(p.dev.productId);
    const vr = value => p.inn({ requestType: 'vendor', recipient: 'device', request: 0x01, value, index: 0 }, 1);
    const vw = (value, index) => p.out({ requestType: 'vendor', recipient: 'device', request: 0x01, value, index });
    const cdc = cdcLines(p, p.ifNum);
    return {
      async init() {
        if (!hxn) {
          await vr(0x8484); await vw(0x0404, 0); await vr(0x8484); await vr(0x8383);
          await vr(0x8484); await vw(0x0404, 1); await vr(0x8484); await vr(0x8383);
          await vw(0, 1); await vw(1, 0); await vw(2, 0x44);
        }
        await cdc.lineCoding();
      },
      setRTS: on => cdc.set({ rts: on }),
      setDTR: on => cdc.set({ dtr: on }),
      strip: b => b,
      async shutdown() { try { await cdc.set({ rts: false, dtr: false }); } catch {} },
    };
  },

  // WCH CH340/CH341. Modem lines are active low in the handshake request.
  ch34x: p => {
    const ctrl = (request, value, index) => p.out({ requestType: 'vendor', recipient: 'device', request, value, index });
    let dtr = false, rts = false;
    const lines = () => ctrl(0xA4, ~((dtr ? 0x20 : 0) | (rts ? 0x40 : 0)) & 0xFF, 0);
    return {
      async init() {
        await p.inn({ requestType: 'vendor', recipient: 'device', request: 0x5F, value: 0, index: 0 }, 2);
        await ctrl(0xA1, 0, 0);                                      // serial init
        // 1200 baud: factor = 1532620800 / 1200 = 1277184, shifted twice -> 19956, divisor 1
        let factor = Math.floor(1532620800 / BAUD), div = 3;
        while (factor > 0xFFF0 && div) { factor >>= 3; div--; }
        factor = 0x10000 - factor;
        await ctrl(0x9A, 0x1312, (factor & 0xFF00) | div);
        await ctrl(0x9A, 0x0F2C, factor & 0xFF);
        await ctrl(0x9A, 0x2518, 0xC0 | 0x08 | 0x03);                // RX+TX enable, parity on (odd), 8 bits
        await lines();
      },
      async setRTS(on) { rts = on; await lines(); },
      async setDTR(on) { dtr = on; await lines(); },
      strip: b => b,
      async shutdown() { dtr = rts = false; try { await lines(); } catch {} },
    };
  },

  // USB CDC-ACM (class 0x02 control interface + class 0x0A data interface).
  cdc: p => {
    const cdc = cdcLines(p, p.commIf ?? p.ifNum);
    return {
      init: () => cdc.lineCoding(),
      setRTS: on => cdc.set({ rts: on }),
      setDTR: on => cdc.set({ dtr: on }),
      strip: b => b,
      async shutdown() { try { await cdc.set({ rts: false, dtr: false }); } catch {} },
    };
  },
};

// CDC class requests, shared by PL2303 and CDC-ACM.
function cdcLines(p, index) {
  const state = { dtr: false, rts: false };
  const cls = (request, value, data) => p.out({ requestType: 'class', recipient: 'interface', request, value, index }, data);
  return {
    async lineCoding() {
      const lc = new DataView(new ArrayBuffer(7));
      lc.setUint32(0, BAUD, true); lc.setUint8(4, 0); lc.setUint8(5, 1); lc.setUint8(6, 8);   // 1 stop, odd, 8 bits
      await cls(0x20, 0, lc.buffer);                                 // SET_LINE_CODING
      await this.set({});
    },
    async set(ch) {
      Object.assign(state, ch);
      await cls(0x22, (state.dtr ? 1 : 0) | (state.rts ? 2 : 0));    // SET_CONTROL_LINE_STATE
    },
  };
}

/* ---------------- Port ---------------- */

class Port {
  constructor(dev, log) { this.dev = dev; this.log = log || (() => {}); this.closed = false; }

  async out(setup, data) {
    const r = data ? await this.dev.controlTransferOut(setup, data) : await this.dev.controlTransferOut(setup);
    if (r.status !== 'ok') throw new Error(`USB request 0x${setup.request.toString(16)} ${r.status}`);
  }
  async inn(setup, len) {
    const r = await this.dev.controlTransferIn(setup, len);
    if (r.status !== 'ok') throw new Error(`USB request 0x${setup.request.toString(16)} ${r.status}`);
    return r.data;
  }

  async open({ chip = 'auto', dtr = 'auto' } = {}) {
    const d = this.dev;
    await d.open();
    if (d.configuration === null) await d.selectConfiguration(1);
    describe(d).forEach(l => this.log(l));

    const known = knownModem(d);
    this.name = known?.name || d.productName || 'USB serial';
    if (chip === 'auto') chip = known && known.chip !== 'auto' ? known.chip : await detectChip(d, this.log);
    if (!chip || !drivers[chip]) {
      throw new Error(`Couldn't identify the USB chip in this modem (VID ${h4(d.vendorId)}, PID ${h4(d.productId)}). `
        + 'Choose the chip under USB chip, or share the log so support can be added.');
    }
    this.chip = chip;

    // Data interface: the CDC data class if there is one, otherwise the first interface with a bulk pair.
    const itfs = d.configuration.interfaces;
    const data = itfs.find(i => i.alternate.interfaceClass === 0x0A && bulk(i, 'in'))
              || itfs.find(i => bulk(i, 'in') && bulk(i, 'out'));
    if (!data) throw new Error('This USB device has no bulk data endpoints, so it is not a serial modem.');
    this.ifNum = data.interfaceNumber;
    this.multi = itfs.length > 1 && chip === 'ftdi';
    const comm = chip === 'cdc' ? itfs.find(i => i.alternate.interfaceClass === 0x02) : null;
    this.commIf = comm?.interfaceNumber;

    if (comm) { try { await d.claimInterface(comm.interfaceNumber); this.commClaimed = true; } catch { /* some phones keep it */ } }
    await d.claimInterface(this.ifNum);
    this.claimed = true;
    const epIn = bulk(data, 'in'), epOut = bulk(data, 'out');
    this.epIn = epIn.endpointNumber; this.packetIn = epIn.packetSize || 64;
    this.epOut = epOut.endpointNumber;

    this.drv = drivers[chip](this);
    await this.drv.init();
    // DTR high powers RS-232-style modem circuits. The CP210x path keeps its v4.0 behaviour
    // (DTR untouched) unless the caller asks, so the SMC-100C works exactly as before.
    if (dtr === true || (dtr === 'auto' && chip !== 'cp210x')) { try { await this.drv.setDTR(true); } catch {} }
    try { await this.drv.setRTS(false); } catch {}
    this.log(`USB opened ${this.name} as ${chip.toUpperCase()} on interface ${this.ifNum}, ${BAUD} 8O1`);
    return this;
  }

  // One USB read. Resolves with the data bytes (possibly empty); rejects when the modem is unplugged.
  async read() {
    const r = await this.dev.transferIn(this.epIn, this.packetIn);
    if (r.status === 'stall') { await this.dev.clearHalt('in', this.epIn); return new Uint8Array(0); }
    if (!r.data || !r.data.byteLength) return new Uint8Array(0);
    return this.drv.strip(new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength));
  }
  async write(bytes) { await this.dev.transferOut(this.epOut, bytes); }
  setRTS(on) { return this.drv.setRTS(on); }
  setDTR(on) { return this.drv.setDTR(on); }

  async close() {
    if (this.closed) return;
    this.closed = true;
    try { await this.drv?.shutdown(); } catch {}
    try { if (this.claimed) await this.dev.releaseInterface(this.ifNum); } catch {}
    try { if (this.commClaimed) await this.dev.releaseInterface(this.commIf); } catch {}
    try { await this.dev.close(); } catch {}
  }
}

async function requestDevice() { return navigator.usb.requestDevice({ filters: usbFilters() }); }

async function openOne(device, opts) {
  // A handle this page still holds (for example after a dropped connection) blocks a fresh open.
  if (device.opened) { try { await device.close(); } catch {} }
  const p = new Port(device, opts.log);
  try { return await p.open(opts); }
  catch (e) { await p.close(); throw e; }
}

// Android can list the same modem twice in the picker (an old entry left over from an earlier
// connection, plus the live one), and the old entry won't open. If the chosen entry fails, try
// the other entries this site already has permission for with the same vendor and product ID.
async function openDevice(device, opts = {}) {
  const log = opts.log || (() => {});
  try { return await openOne(device, opts); }
  catch (first) {
    let others = [];
    try {
      others = (await navigator.usb.getDevices()).filter(o => o !== device
        && o.vendorId === device.vendorId && o.productId === device.productId);
    } catch {}
    if (!others.length) throw first;
    log(`USB open failed on the chosen entry (${first.message}); trying the other ${others.length === 1 ? 'entry' : others.length + ' entries'} for this modem`);
    for (const o of others) {
      try {
        const port = await openOne(o, opts);
        log('USB opened using the other picker entry for this modem');
        return port;
      } catch (e) { log(`USB other entry failed: ${e.message}`); }
    }
    throw first;
  }
}

window.USBSerial = {
  BAUD, MODEMS, CHIPS: Object.keys(drivers),
  usbFilters, serialFilters, knownModem, describe, detectChip, requestDevice, openDevice,
};
})();
