/* Rosemount model code breakdown for the device report.
   Every code and meaning here is taken from the Emerson product data sheet named in `source`.
   Positions that aren't in the data sheet on hand are shown as "not decoded" with the raw code;
   nothing is guessed. To add a product, add a decoder to DECODERS with its own source. */
(() => {
'use strict';

/* ---------- Rosemount 2088 ----------
   Product Data Sheet 00813-0100-4690, Rev QC, June 2024, "Ordering information". */
const R2088 = {
  source: 'Emerson Rosemount 2088 Product Data Sheet 00813-0100-4690 Rev QC (June 2024), ordering information',
  type: { A: 'Absolute', G: 'Gauge' },
  range: {
    1: ['−14.7 to 30 psi (−101.3 to 206.8 kPa)', '0 to 30 psi (0 to 206.8 kPa)'],
    2: ['−14.7 to 150 psi (−101.3 to 1034 kPa)', '0 to 150 psi (0 to 1034 kPa)'],
    3: ['−14.7 to 800 psi (−0.101 to 5.52 MPa)', '0 to 800 psi (0 to 5.52 MPa)'],
    4: ['−14.7 to 4000 psi (−0.101 to 27.6 MPa)', '0 to 4000 psi (0 to 27.6 MPa)'],
    5: ['−14.7 to 10000 psi (−0.101 to 68.9 MPa)', '0 to 10000 psi (0 to 68.9 MPa)'],
  },
  output: { S: '4–20 mA with digital HART', N: '1–5 V dc low power with digital HART' },
  materials: {
    22: 'Process connection 316L SST, isolating diaphragm 316L SST, fill fluid silicone',
    33: 'Process connection Alloy C-276, isolating diaphragm Alloy C-276, fill fluid silicone',
    '2B': 'Process connection 316L SST, isolating diaphragm 316L SST, fill fluid inert',
  },
  connection: { A: '½–14 NPT female', B: 'DIN 16288 G½ male', C: 'RC ½ female (½–14 NPT with G½ adapter)', D: 'M20 × 1.5 male' },
  conduit: { 1: '½–14 NPT', 2: 'M20 × 1.5', 4: 'G½ (½–14 NPT with G½ adapter)' },
  options: {
    HR5: 'Configured for HART revision 5', HR7: 'Configured for HART revision 7',
    WR3: '3-year limited warranty', WR5: '5-year limited warranty',
    S1: 'Assembled to one Rosemount 1199 diaphragm seal', S5: 'Assembled to Rosemount 306 integral manifold',
    M4: 'LCD display with local operator interface', M5: 'LCD display configured for engineering units',
    D4: 'Analog zero and span buttons', DZ: 'Digital zero trim button',
    B4: 'Stainless steel bracket with stainless steel bolts', DO: '316 SST conduit plug',
    T1: 'Transient protection terminal block', P1: 'Hydrostatic testing', P2: 'Special cleaning for special service',
    P8: '0.065% accuracy to 10:1 turndown', DW: 'NSF drinking water approval',
    Q4: 'Calibration certificate', Q8: 'Material traceability certificate (EN 10204 3.1)',
    Q15: 'NACE MR0175/ISO 15156 wetted materials certificate', Q25: 'NACE MR0103 wetted materials certificate',
    Q16: 'Surface finish certificate for sanitary remote seals', Q76: 'PMI verification and certificate',
    QZ: 'Remote seal system performance calculation report',
    C4: 'NAMUR alarm and saturation levels, high alarm', CN: 'NAMUR alarm and saturation levels, low alarm',
    C5: 'Custom alarm and saturation levels, high alarm', C7: 'Custom alarm and saturation levels, low alarm',
    C8: 'Low alarm, standard Rosemount levels', C9: 'Software configuration',
    C6: 'Canada explosion-proof, intrinsic safety, Division 2, dust-ignitionproof', E2: 'INMETRO flameproof',
    E4: 'Japan flameproof', E5: 'USA explosion-proof and dust-ignitionproof', E7: 'IECEx flameproof',
    ED: 'ATEX flameproof', EM: 'EAC flameproof', I1: 'ATEX intrinsic safety', I2: 'INMETRO intrinsic safety',
    I3: 'China intrinsic safety', I5: 'USA intrinsic safety and nonincendive', I7: 'IECEx intrinsic safety',
    IM: 'EAC intrinsic safety', K1: 'ATEX flameproof, intrinsic safety, type n and dust',
    K2: 'INMETRO flameproof and intrinsic safety', K5: 'USA explosion-proof, dust-ignitionproof, intrinsic safety and nonincendive',
    K6: 'Canada and ATEX explosion-proof and intrinsic safety combination', K7: 'IECEx flameproof, intrinsic safety, type n and dust',
    KB: 'USA and Canada explosion-proof and intrinsic safety combination', KM: 'EAC flameproof and intrinsic safety',
    KH: 'ATEX and USA explosion-proof and intrinsic safety combination', N1: 'ATEX type n', N3: 'China type n',
    N7: 'IECEx type n', ND: 'ATEX dust', NK: 'IECEx dust',
    SBS: 'ABS shipboard type approval', SBV: 'Bureau Veritas shipboard type approval',
    SDN: 'DNV shipboard type approval', SLL: "Lloyd's Register shipboard type approval",
  },
};

// Splits a run of option codes using the known list, longest match first.
function splitOptions(rest, known) {
  const out = [];
  let s = rest;
  while (s.length) {
    const hit = [3, 2].map(n => s.slice(0, n)).find(c => c.length > 1 && known[c]);
    if (!hit) { out.push({ code: s, meaning: null }); break; }
    out.push({ code: hit, meaning: known[hit] });
    s = s.slice(hit.length);
  }
  return out;
}

function decode2088(m) {
  const x = /^2088([AG])([1-5])([SN])(22|33|2B)([ABCD])([124])([A-Z0-9]*)$/.exec(m);
  if (!x) return null;
  const T = R2088, abs = x[1] === 'A';
  const rows = [
    ['2088', 'Model', 'Rosemount 2088 pressure transmitter'],
    [x[1], 'Measurement type', T.type[x[1]]],
    [x[2], 'Pressure range', T.range[x[2]][abs ? 1 : 0]],
    [x[3], 'Output', T.output[x[3]]],
    [x[4], 'Materials of construction', T.materials[x[4]]],
    [x[5], 'Process connection', T.connection[x[5]]],
    [x[6], 'Conduit entry', T.conduit[x[6]]],
    ...splitOptions(x[7], T.options).map(o => [o.code, 'Option', o.meaning]),
  ];
  return { product: 'Rosemount 2088 pressure transmitter', source: T.source, rows };
}

/* ---------- Rosemount 1199 seal system ----------
   Product Data Sheet 00813-0100-4016 Rev UD, March 2026: "1199 Seal systems" required model components
   (pp. 93–96) and the seal ordering tables (EFW pp. 108–111, RTW pp. 125–128).
   Code order: 1199, connection type/seal location, fill fluid, capillary ID, capillary length,
   then the seal's own code: industry standard, seal style, seal positions, options. */
const UD = 'Emerson Rosemount DP Level Transmitters and 1199 Diaphragm Seal Systems Product Data Sheet 00813-0100-4016 Rev UD (March 2026)';
const R1199 = {
  location: {
    coplanar: {
      W: 'Welded-repairable, high side of transmitter (one or two seal system)', M: 'Welded-repairable, low side of transmitter',
      D: 'Welded-repairable, balanced two seal system', A: 'All welded, one seal system, high side', B: 'All welded, two seal system, high side',
      C: 'All welded, two seal system, low side',
    },
    inline: { W: 'All welded, one seal system (in-line transmitter)' },
  },
  fill: {
    D: 'Silicone 200', F: 'Silicone 200 for vacuum applications', J: 'Tri-Therm 300', Q: 'Tri-Therm 300 for vacuum applications',
    L: 'Silicone 704', C: 'Silicone 704 for vacuum applications', R: 'Silicone 705', V: 'Silicone 705 for vacuum applications',
    A: 'SYLTHERM XLT', H: 'Inert (Halocarbon)', G: 'Glycerine and water', N: 'Neobee M-20', P: 'Propylene glycol and water',
  },
  capillary: {
    B: '0.03 in (0.711 mm) ID', C: '0.04 in (1.092 mm) ID', D: '0.075 in (1.905 mm) ID',
    E: '0.03 in (0.711 mm) ID, PVC coated with closed end', F: '0.04 in (1.092 mm) ID, PVC coated with closed end',
    G: '0.075 in (1.905 mm) ID, PVC coated with closed end',
    H: '0.03 in (0.711 mm) ID, 4 in support tube', J: '0.04 in (1.092 mm) ID, 4 in support tube', K: '0.075 in (1.905 mm) ID, 4 in support tube',
    M: '0.03 in (0.711 mm) ID, PVC coated, 4 in support tube with closed end', N: '0.04 in (1.092 mm) ID, PVC coated, 4 in support tube with closed end',
    P: '0.075 in (1.905 mm) ID, PVC coated, 4 in support tube with closed end',
  },
  length: {
    '01': '1.0 ft (0.3 m)', '05': '5.0 ft (1.5 m)', 10: '10.0 ft (3.0 m)', 15: '15.0 ft (4.5 m)', 20: '20.0 ft (6.1 m)',
    25: '25.0 ft (7.6 m)', 30: '30.0 ft (9.1 m)', 35: '35.0 ft (10.7 m)', 40: '40.0 ft (12.2 m)', 45: '45.0 ft (13.7 m)', 50: '50.0 ft (15.2 m)',
    51: '0.5 m (1.6 ft)', 52: '1.0 m (3.3 ft)', 53: '1.5 m (4.9 ft)', 54: '2.0 m (6.6 ft)', 55: '2.5 m (8.2 ft)', 56: '3.0 m (9.8 ft)',
    57: '3.5 m (11.5 ft)', 58: '4.0 m (13.1 ft)', 59: '5.0 m (16.4 ft)', 60: '6.0 m (19.7 ft)', 61: '7.0 m (23.0 ft)', 62: '8.0 m (26.2 ft)',
    63: '9.0 m (29.5 ft)', 64: '10.0 m (32.8 ft)', 65: '11.0 m (36.1 ft)', 66: '12.0 m (39.4 ft)', 67: '13.0 m (42.6 ft)',
    68: '14.0 m (45.9 ft)', 69: '15.0 m (49.2 ft)',
  },
  style: {
    PFW: 'Pancake seal', PCW: 'Pancake seal, RTJ gasket surface', FFW: 'Flush flanged seal', FCW: 'Flush flanged seal, RTJ gasket surface',
    RFW: 'Remote flanged seal', RCW: 'Remote flanged seal, RTJ gasket surface', EFW: 'Extended flanged seal', RTW: 'Remote threaded seal',
    HTS: 'Male threaded seal', SCW: 'Tri-Clamp hygienic seal', SSW: 'Tank spud hygienic seal',
  },
};

// Seal ordering tables decoded so far. Each `parts` entry: [position name, code length, table, standard-specific?].
const SEALS = {
  RTW: {
    standards: { A: 'ASME B1.20.1', D: 'EN 10226-1 / ISO 228-1' },
    parts: [
      ['Process connection size', 1, { 1: '¼–18 NPT', 2: '⅜–18 NPT', 3: '½–14 NPT', 4: '¾–14 NPT', 5: '1–11½ NPT', 6: '1¼–11½ NPT', 7: '1½–11½ NPT', C: 'G½ (EN 837-1, ISO 228-1)', N: 'Tapered thread R½ per ISO 7/1 (EN 10226-1)' }],
      ['Pressure rating', 1, { 0: '2500 psi (172 bar)', 2: '5000 psi (344 bar)', 3: '10000 psi (690 bar)', 8: '1500 psi (103 bar), 4.1 in (104 mm) diaphragm' }],
      ['Diaphragm / upper housing', 2, {
        DA: '316L SST / 316L SST', DB: 'Alloy C-276 / 316L SST', DC: 'Tantalum / 316L SST', DJ: 'Alloy B / 316L SST', DF: '304L SST / 316L SST',
        DP: 'Nickel 201 / 316L SST', DV: 'Alloy 400 / 316L SST', RH: 'Titanium Gr. 4 / Titanium Gr. 4', DH: 'Titanium Gr. 4 / 316L SST',
        D4: 'Alloy 22 / 316L SST', D6: 'Duplex 2205 SST / 316L SST', DE: 'Alloy 600 / 316L SST', DZ: 'Zirconium 702 / 316L SST',
        DK: 'Alloy 20 / 316L SST', RZ: 'Zirconium 702 / Zirconium 702', D5: 'Duplex 2507 SST / 316L SST' }],
      ['Flushing ring (lower housing) material', 1, { A: '316L SST', B: 'Alloy C-276', D: 'Plated carbon steel', 2: 'Duplex 2205 SST', H: 'Titanium Gr. 4', V: 'Alloy 400', F: '304L SST' }],
      ['Flushing connections', 1, { 5: 'None', 1: 'One connection (¼–18 NPT)', 3: 'Two connections (¼–18 NPT)', 7: 'One connection (½–14 NPT)', 9: 'Two connections (½–14 NPT)', Y: 'Assembled to Rosemount 319 flushing ring' }],
    ],
    options: {
      WR3: '3-year limited warranty', WR5: '5-year limited warranty', Y: 'Klingersil C-4401 gasket', J: 'PTFE gasket', N: 'GRAFOIL gasket',
      R: 'Ethylene propylene gasket', K: 'Barium sulfate filled PTFE gasket', D: 'Alloy C-276 plug(s) for flushing connection(s)',
      G: '316 SST plug(s) for flushing connection(s)', H: '316 SST vent/drain for flushing connection(s)', FV: 'Low side drain/vent valve',
      C: '0.006 in (150 μm) diaphragm', 3: '304 SST bolts', 4: '316 SST bolts', Q15: 'NACE MR0175/ISO 15156 certificate for wetted materials',
      Q25: 'NACE MR0103 certificate for wetted materials', B: 'Extra fill for cold temperature application', Z: 'Gold plated diaphragm (5 μm)',
      V: 'PTFE coated diaphragm (non-stick only)', FP: 'CorrosionShield PFA coated diaphragm', 9: 'Male threads in lower housing',
      FB: 'Corrosion protection for capillary welds', Q76: 'PMI verification and certificate',
    },
  },
  EFW: {
    standards: { A: 'ASME B16.5', D: 'EN 1092-1', T: 'GOST 33259-15', J: 'JIS B2238', G: 'HG20615', K: 'HG20592' },
    parts: [
      ['Process connection size', 1, {
        7: ['3 in (Schedule 80), 2.58 in (66 mm) extension', 'DN 80 / 80A, 66 mm extension'], 9: ['4 in (Schedule 80), 3.50 in (89 mm) extension', 'DN 100 / 100A, 89 mm extension'],
        4: ['1½ in', 'DN 40 / 40A'], G: ['2 in', 'DN 50 / 50A'], R: ['3 in (Schedule 40)', 'DN 80 / 80A'], H: ['3 in (headbox)', 'DN 80 headbox / 80A'],
        J: ['3 in, 2.99 in (76 mm) extension', 'DN 80 / 80A, 76 mm extension'], T: ['4 in (Schedule 40)', 'DN 100 / 100A'], K: ['4 in (headbox)', 'DN 100 headbox / 100A'] }, true],
      ['Flange / pressure rating', 1, {
        1: ['Class 150', '10K (JIS)'], 2: ['Class 300', '20K (JIS)'], 4: ['Class 600', '40K (JIS)'], G: [null, 'PN 40'], E: [null, 'PN 10/16 (DN 100 only)'],
        5: ['Class 900', null], 6: ['Class 1500', null], 7: ['Class 2500', null], H: [null, 'PN 63'], J: [null, 'PN 100'], K: [null, 'PN 160'] }, true],
      ['Diaphragm / extension / upper housing / flange', 2, {
        DA: '316L SST / 316L SST / 316L SST / 316 SST', CA: '316L SST / 316L SST / 316L SST / carbon steel',
        DB: 'Alloy C-276 / Alloy C-276 / 316L SST / 316 SST', CB: 'Alloy C-276 / Alloy C-276 / 316L SST / carbon steel',
        DM: 'Alloy C-276 / 316L SST / 316L SST / 316 SST', DD: 'Tantalum / 316L SST / 316L SST / 316 SST',
        DC: 'Tantalum / tantalum lined / 316L SST / 316 SST', D6: 'Duplex 2205 SST / Duplex 2205 SST / 316L SST / 316 SST',
        D7: 'Duplex 2205 SST / 316L SST / 316L SST / 316 SST', D5: 'Duplex 2507 SST / Duplex 2507 SST / 316L SST / 316 SST',
        C5: 'Duplex 2507 SST / Duplex 2507 SST / 316L SST / carbon steel' }],
      ['Extension length', 1, { 1: ['1 in', '25 mm'], 2: ['2 in', '50 mm'], 3: ['3 in', '75 mm'], 4: ['4 in', '100 mm'], 5: ['5 in', '125 mm'], 6: ['6 in', '150 mm'], 7: ['7 in', '175 mm'], 8: ['8 in', '200 mm'], 9: ['9 in', '225 mm'] }, true],
      ['Fractional extension length', 1, { 0: ['0 in', '0 mm'], 1: ['⅛ in', '2.5 mm'], 2: ['¼ in', '5 mm'], 3: ['⅜ in', '7.5 mm'], 4: ['½ in', '10 mm'], 5: ['⅝ in', '12.5 mm'], 6: ['¾ in', '15 mm'], 7: ['⅞ in', '17.5 mm'], 8: [null, '20 mm'], 9: [null, '22.5 mm'] }, true],
    ],
    options: {
      WR3: '3-year limited warranty', WR5: '5-year limited warranty', JA: 'Threaded jack bolt holes in flange', FV: 'Low side drain/vent valve',
      C: '0.006 in (150 μm) diaphragm', Q15: 'NACE MR0175/ISO 15156 certificate for wetted materials', Q25: 'NACE MR0103 certificate for wetted materials',
      1: 'Gasket surface Ra 125 max / EN 1092-1 Type B2', B: 'Extra fill for cold temperature application', Z: 'Gold plated diaphragm (5 μm)',
      V: 'PTFE coated diaphragm (non-stick only)', FP: 'CorrosionShield PFA coated diaphragm', FB: 'Corrosion protection for capillary welds',
      Q76: 'PMI verification and certificate',
    },
  },
};

// Longest-match split that also allows single-character option codes.
function splitAll(rest, known) {
  const out = [];
  let s = rest;
  while (s.length) {
    const hit = [3, 2, 1].map(n => s.slice(0, n)).find(c => c.length && known[c] && c.length <= s.length);
    if (!hit) { out.push({ code: s, meaning: null }); break; }
    out.push({ code: hit, meaning: known[hit] });
    s = s.slice(hit.length);
  }
  return out;
}

function decodeSeal(std, style, rest) {
  const S = SEALS[style];
  const rows = [[std, 'Industry standard', S ? S.standards[std] || null : null], [style, 'Seal style', R1199.style[style] || null]];
  if (!S) { if (rest) rows.push([rest, 'Seal size, materials and options', null]); return rows; }
  const asme = std === 'A';
  let s = rest;
  for (const [label, n, table, byStd] of S.parts) {
    if (!s) break;
    const c = s.slice(0, n); s = s.slice(n);
    let v = table[c] ?? null;
    if (byStd && Array.isArray(v)) v = asme ? v[0] : v[1];
    rows.push([c, label, v]);
  }
  for (const o of splitAll(s, S.options)) rows.push([o.code, 'Option', o.meaning]);
  return rows;
}

// opts.inline: the seal is fitted to an in-line transmitter (2088, 3051T, 2051T ...), which changes code W.
function decode1199(m, opts = {}) {
  const x = /^1199([A-Z])([A-Z])([A-Z])(\d\d)([A-Z])([A-Z]{3})([A-Z0-9]*)$/.exec(m);
  if (!x || !R1199.style[x[6]]) return null;
  const T = R1199;
  const loc = opts.inline ? (T.location.inline[x[1]] || null) : (T.location.coplanar[x[1]] || null);
  const rows = [
    ['1199', 'Model', 'Rosemount 1199 seal system'],
    [x[1], 'Connection type and seal location', loc],
    [x[2], 'Seal fill fluid', T.fill[x[2]] || null],
    [x[3], 'Capillary ID', T.capillary[x[3]] || null],
    [x[4], 'Capillary length', T.length[x[4]] || null],
    ...decodeSeal(x[5], x[6], x[7]),
  ];
  return { product: `Rosemount 1199 seal system, ${T.style[x[6]].toLowerCase()}`, source: `${UD}, 1199 seal system and ${x[6]} ordering tables`, rows };
}

const DECODERS = [decode2088, decode1199];

// Transmitter model codes that are in-line devices in the 1199 data sheet.
const isInline = model => /^(2088|WPG|SPG|2051H?T|3051H?T|3051S\d?T)/.test(String(model || '').toUpperCase());

// Returns { product, source, rows: [{ code, label, meaning, decoded }] } or null if no decoder knows the model.
// opts.inline can be set by the caller, or worked out from the other model numbers via decodeAll().
function decode(model, opts = {}) {
  const m = String(model || '').toUpperCase().replace(/[\s-]/g, '');
  for (const d of DECODERS) {
    const r = d(m, opts);
    if (r) return { ...r, model: m, rows: r.rows.map(([code, label, meaning]) => ({ code, label, meaning, decoded: !!meaning })) };
  }
  return null;
}
const decodeAll = models => { const inline = models.some(isInline); return models.map(m => decode(m, { inline })); };

window.HARTModelCode = { decode, decodeAll, isInline };
})();
