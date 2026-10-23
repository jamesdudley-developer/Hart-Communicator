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
   Product Data Sheet 00813-0100-4016 Rev HA (2008), Table 6 (capillary transmitter/seal assembly)
   and the seal selection guide. Later revisions added a position after the capillary length and
   new fill fluid codes; those, and the seal's own ordering table, are not in the sheet on hand. */
const R1199 = {
  source: 'Emerson Rosemount 1199 Product Data Sheet 00813-0100-4016 Rev HA, Table 6 and seal selection guide',
  location: {
    R: 'High side, all-welded vacuum', S: 'Low side, all-welded vacuum', T: 'High side, all-welded vacuum (with 1199S on the low side)',
    D: 'Same seal on both sides, repairable-welded', W: 'High side, repairable-welded', M: 'Low side, repairable-welded',
  },
  fill: {
    A: 'Syltherm XLT', C: 'D.C. 704', D: 'D.C. 200', H: 'Inert (Halocarbon)',
    G: 'Glycerin and water (sanitary)', N: 'Neobee M-20 (sanitary)', P: 'Propylene glycol and water (sanitary)',
  },
  capillary: {
    B: '0.03 in ID, SST armoured', C: '0.04 in ID, SST armoured', D: '0.075 in ID, SST armoured',
    E: '0.03 in ID, PVC-coated SST armoured', F: '0.04 in ID, PVC-coated SST armoured', G: '0.075 in ID, PVC-coated SST armoured',
    H: '0.03 in ID, SST armoured, support tube without compression fitting',
    J: '0.04 in ID, SST armoured, support tube without compression fitting',
    K: '0.075 in ID, SST armoured, support tube without compression fitting',
    M: '0.03 in ID, PVC-coated, support tube with compression fitting', N: '0.04 in ID, PVC-coated, support tube with compression fitting',
    P: '0.075 in ID, PVC-coated, support tube with compression fitting',
  },
  metres: { 51: '0.5 m', 52: '1.0 m', 56: '3.0 m', 59: '5.0 m', 60: '6.0 m', 69: '15.0 m' },
  seal: {
    PFW: 'Pancake', PCW: 'Pancake, RTJ gasket surface', FFW: 'Flush flanged', FCW: 'Flush flanged, RTJ gasket surface',
    RFW: 'Remote flanged', RCW: 'Remote flanged, RTJ gasket surface', EFW: 'Extended flanged', RTW: 'Remote threaded',
    CTW: 'Chemical tee', UCW: 'Union connection', UCP: 'Threaded pipe mount', PMW: 'Paper mill sleeve', WSP: 'Saddle',
    TFS: 'Wafer style in-line', WFW: 'Flow-through flanged', WWW: 'Flow-through socket weld', WBW: 'Flow-through butt weld',
    WTW: 'In-line flow-through threaded', HTS: 'Threaded flush', JES: 'Extruder flanged',
    SCW: 'Tri-Clamp (sanitary)', SSW: 'Tank spud (sanitary)', STW: 'Thin-wall tank spud (sanitary)',
  },
};

function decode1199(m) {
  const x = /^1199([RSTDWM])([A-Z])([A-Z])(\d\d)([A-Z0-9]?)([A-Z]{3})([A-Z0-9]*)$/.exec(m);
  if (!x || !R1199.seal[x[6]]) return null;
  const T = R1199, len = +x[4];
  const length = len >= 1 && len <= 50 ? `${len} ft` : (T.metres[x[4]] || null);
  const rows = [
    ['1199', 'Model', 'Rosemount 1199 diaphragm seal system'],
    [x[1], 'Seal location', T.location[x[1]]],
    [x[2], 'Fill fluid', T.fill[x[2]] || null],
    [x[3], 'Capillary', T.capillary[x[3]] || null],
    [x[4], 'Capillary length', length],
    ...(x[5] ? [[x[5], 'Seal connection', null]] : []),
    [x[6], 'Seal type', T.seal[x[6]]],
    ...(x[7] ? [[x[7], 'Seal size, materials and options', null]] : []),
  ];
  return { product: `Rosemount 1199 seal system, ${T.seal[x[6]].toLowerCase()} seal`, source: T.source, rows };
}

const DECODERS = [decode2088, decode1199];

// Returns { product, source, rows: [{ code, label, meaning, decoded }] } or null if no decoder knows the model.
function decode(model) {
  const m = String(model || '').toUpperCase().replace(/[\s-]/g, '');
  for (const d of DECODERS) {
    const r = d(m);
    if (r) return { ...r, model: m, rows: r.rows.map(([code, label, meaning]) => ({ code, label, meaning, decoded: !!meaning })) };
  }
  return null;
}

window.HARTModelCode = { decode };
})();
