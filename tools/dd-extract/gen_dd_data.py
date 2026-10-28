"""Build public/dd-data.js from the JSON dumps made by vbdd.py (DD-converted VB6 DTMs) and xmldtm.py
(Emerson XML-based WirelessHART DTMs). Only device-specific commands 128-253 are kept: universal and
common-practice commands are already decoded by hart-core.js.

Usage: python3 -I gen_dd_data.py OUT.js key=kind:path:label ...
  kind is "vb" or "xml"; key is e.g. 2051r10."""
import sys, json, re

def human(name):
    s = re.sub(r'[_\s]+', ' ', name).strip()
    s = s[:1].upper() + s[1:].lower()
    return s

def clean(s):
    if s is None: return None
    s = re.sub(r'^\|[a-z]{2}\|', '', s).strip()
    return s

NAME_OVERRIDE = {
    ('2051r10', 128): 'Read materials of construction and static data',
    ('2051r10', 142): 'Read alarm and saturation levels',
    ('3144Pr5', 189): 'Read alarm and saturation levels',
    ('648r2', 148): 'Read model number 1 (model string)',
    ('775r1', 148): 'Read model number 1 (model string)',
}
WRITE_WORDS = re.compile(r'^(write|set|clear|reset|perform|enter|rebaseline|refresh|high_power|trim|lock|local_keys|wirte)', re.I)

def rw_of(name, ctype=None):
    if ctype and 'Write' in ctype: return 'w'
    if ctype and 'Read' in ctype: return 'r'
    if re.match(r'^(read|get|cmd_read)', name, re.I): return 'r'
    return 'w'

def vb_field(v, info, enums, key):
    t, s = info.get('type'), info.get('size')
    lab = clean(info.get('label')) or v
    enum_labels = {clean(l) for _, l in (info.get('enum') or [])}
    if len(lab) > 40 or lab.endswith('.') or lab.lower().startswith('this variable') or lab in enum_labels: lab = human(v)
    if v.startswith('sensor_number'): lab = 'Sensor number (0 = sensor 1)'
    f = {'k': v, 'l': lab}
    if t == 0: f.update(t='f', n=4)
    elif t == 1: f.update(t='F', n=8)
    elif t == 2: f.update(t='i', n=s)
    elif t in (3, 6): f.update(t='u', n=s)
    elif t == 4: f.update(t='e', n=s)
    elif t == 5: f.update(t='b', n=s)
    elif t in (7, 9): f.update(t='a', n=s)
    elif t == 8: f.update(t='p', n=(s * 3 // 4) if s else None)
    elif t == 11: f.update(t='d', n=3)
    else: f.update(t='x', n=s)
    en = info.get('enum') or []
    if en and f['t'] in ('e', 'b', 'u'):
        tab = {}
        for code, label in en:
            code = int(code)
            if code > 0xFFFF: continue
            if str(code) not in tab: tab[str(code)] = clean(label)
        ek = f'{key}:{v}'
        enums[ek] = tab
        f['e'] = ek
        if f['t'] == 'u': f['t'] = 'e'
    if f['t'] == 'f' and re.search(r'(alarm|saturation)_level', v): f['l'] = f['l'] + ' (mA)'
    return f

def layout(fields):
    o = 0
    for f in fields:
        f['o'] = o
        if o is None or not f.get('n'): o = None
        else: o += f['n']
    return fields

def from_vb(key, path, enums):
    r = json.load(open(path))
    out = {}
    for num, lst in r['commands'].items():
        n = int(num)
        if not 128 <= n <= 253: continue
        c = lst[0]
        trans = []
        for tr in c['trans']:
            req = layout([vb_field(x['var'], r['vars'].get(x['var'], {}), enums, key) | ({'ix': 1} if x.get('indexed') else {}) for x in tr['req']])
            rsp = layout([vb_field(x['var'], r['vars'].get(x['var'], {}), enums, key) | ({'ix': 1} if x.get('indexed') else {}) for x in tr['rsp']])
            for fs in (req, rsp):
                seen = {}
                for f in fs: seen[f['l']] = seen.get(f['l'], 0) + 1
                for f in fs:
                    if seen[f['l']] > 1 and not f['k'].startswith('sensor_number'): f['l'] = human(f['k'])
                    if f.get('ix'): f['l'] = re.sub(r'^Sensor 1 ', 'Sensor ', f['l'])
            trans.append({'req': req, 'rsp': rsp})
        out[n] = {'name': NAME_OVERRIDE.get((key, n)) or human(c['name']), 'dd': c['name'], 'rw': rw_of(c['name']), 'tr': trans}
    return out

XT = {'Byte': ('u', 1), 'UInt8': ('u', 1), 'UInt16': ('u', 2), 'UInt24': ('u', 3), 'UInt32': ('u', 4), 'Float': ('f', 4),
      'PackedAscii': ('p', None), 'String': ('a', None), 'DATE': ('d', 3), 'Bit': ('b', 1), 'HexInt32': ('x', 4), 'HexString': ('x', None)}

def from_xml(key, path, enums):
    r = json.load(open(path))
    S0 = r['strings']
    class _S(dict):
        def get(self, k, d=None):
            if k in S0 and S0[k]: return S0[k]
            if k and re.match(r'^[A-Z0-9_()%/.-]+$', k): return human(re.sub(r'_(ENUM_)?LABEL$', '', k)).replace('( ', '(')
            return d
    S = _S()
    def label(item, name):
        lk = item.get('label') if item else None
        l = S.get(lk) if lk else None
        l = (l or '').replace('\\n', ' ').strip()
        return l if l and len(l) <= 48 else human(re.sub(r'_(\d{3})$', '', name))
    out = {}
    for num, lst in r['commands'].items():
        n = int(num)
        if not 128 <= n <= 253: continue
        c = lst[0]
        trans = []
        for tr in c['trans']:
            def conv(ps):
                fs = []
                for p in ps:
                    it = r['items'].get(p['name'])
                    t, ln = XT.get(p.get('type') or (it or {}).get('type'), ('x', None))
                    ln = int(p['length']) if p.get('length') else ln
                    f = {'k': p['name'], 'l': label(it, p['name']), 't': t, 'n': ln, 'o': int(p['position']) if p.get('position') else None}
                    if p.get('value') is not None: f['v'] = int(p['value'])
                    if t == 'b' and p.get('bitPosition') is not None:
                        f['t'] = 'B'; f['bit'] = int(p['bitPosition']); fs.append(f); continue
                    en = r['enums'].get((it or {}).get('enumeration') or '') if it else None
                    if en:
                        tab = {}
                        for code, lab, nm in en:
                            try: cv = int(code, 0)
                            except Exception: continue
                            tab.setdefault(str(cv), clean(S.get(lab, lab)) if lab else nm)
                        ek = f'{key}:{(it or {}).get("enumeration")}'
                        enums[ek] = tab; f['e'] = ek
                        if t == 'u':
                            vals = [int(k) for k in tab]
                            f['t'] = 'b' if ln and ln > 1 and vals and all(v and (v & (v - 1)) == 0 for v in vals) else 'e'
                    if t == 'f' and re.search(r'ALARM|SATURATION', p['name'], re.I) and 'mA' not in f['l']: f['l'] += ' (mA)'
                    fs.append(f)
                return fs
            trans.append({'req': conv(tr['req']), 'rsp': conv(tr['rsp'])})
        out[n] = {'name': NAME_OVERRIDE.get((key, n)) or human(c['name']), 'dd': c['name'], 'rw': rw_of(c['name'], c.get('type')), 'tr': trans}
    return out

def main():
    outp = sys.argv[1]; data = {}; enums = {}
    for spec in sys.argv[2:]:
        key, rest = spec.split('=', 1)
        kind, path, src = rest.split(':', 2)
        cmds = from_vb(key, path, enums) if kind == 'vb' else from_xml(key, path, enums)
        data[key] = {'source': src, 'commands': {str(k): v for k, v in sorted(cmds.items())}}
    # strip helper keys to keep the file small
    for d in data.values():
        for c in d['commands'].values():
            for tr in c['tr']:
                for f in tr['req'] + tr['rsp']:
                    f.pop('ix', None)
    js = ('/* Device-specific HART commands extracted from manufacturer DTM installers (the device description\n'
          '   compiled into each DTM). Generated by tools/dd-extract/gen_dd_data.py. Do not edit by hand.\n'
          '   Field: k = DD variable, l = label, t = type (f float, F double, u unsigned, i signed, e enum, b bit-enum,\n'
          '   B single bit (bit = bit number), p packed ASCII, a ASCII, d date, x raw), n = bytes, o = byte offset (null = after a field of unknown size),\n'
          '   e = enum table key, v = constant request value. tr = transactions (request and reply layouts). */\n'
          'window.HARTDD = ' + json.dumps({'devices': data, 'enums': enums}, separators=(',', ':')) + ';\n')
    open(outp, 'w').write(js)
    print('wrote', outp, len(js), 'bytes;', {k: len(v['commands']) for k, v in data.items()})

if __name__ == '__main__':
    main()
