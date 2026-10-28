import sys,re,json,subprocess,os,struct
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__))); from ddlib import *
KEY=re.compile(r'^[A-Z][A-Z0-9_]+$')
_members={}
def members(dd,coll):
    # coll = array of collections -> member key -> variable (from first element)
    if coll in _members: return _members[coll]
    res=None
    try:
        t,b=dd.body(coll); it=dd.items()
        seq=[dd.ustr(struct.unpack('<I',m.group(1))[0]) for m in re.finditer(rb'(?:[\x68\xb8-\xbf]|\xc7\x45.|\xc7\x85....)(...\x11)',b,re.S)]; seq=[x for x in seq if x]
        firsts=[s for s in seq if s in it and s!=coll]
        if firsts:
            t2,b2=dd.body(firsts[0])
            s2=[dd.ustr(struct.unpack('<I',m.group(1))[0]) for m in re.finditer(rb'(?:[\x68\xb8-\xbf]|\xc7\x45.|\xc7\x85....)(...\x11)',b2,re.S)]; s2=[x for x in s2 if x]
            mp={}
            for a,c in zip(s2,s2[1:]):
                if a and KEY.match(a) and c in it: mp[a]=c
            if mp: res=mp
        if res is None:
            mp={}
            for a,c in zip(seq,seq[1:]):
                if a and KEY.match(a) and c in it: mp[a]=c
            if mp: res=mp
    except Exception: pass
    _members[coll]=res; return res
def transactions(dd,path,name):
    t,b=dd.body(name); it=dd.items()
    out=subprocess.run(['objdump','-D','-b','binary','-mi386','--adjust-vma=0x11000000','--start-address=%d'%(IB+t),'--stop-address=%d'%(IB+t+len(b)),path],capture_output=True,text=True).stdout
    trans=[]; cur=None; pend=None
    for l in out.splitlines()[7:]:
        ins=l.split('\t')[-1].strip()
        m=re.match(r'call +\*0x(2c|38)\(%eax\)$',ins)
        if m:
            if m.group(1)=='2c': trans.append({'req':[],'rsp':[]}); cur='req'
            elif trans: cur='rsp'
            pend=None; continue
        m=re.search(r'\$0x(11[0-9a-f]{6})',ins)
        if not (m and cur): continue
        s=dd.ustr(int(m.group(1),16))
        if not s: continue
        if s in it:
            mp=members(dd,s) if s not in ('response_code','device_status') else None
            if mp: pend={'coll':s,'map':mp,'index':None}; continue
            if pend and pend['index'] is None: pend['index']=s; continue
            trans[-1][cur].append({'var':s})
        elif pend and KEY.match(s) and s in pend['map']:
            trans[-1][cur].append({'var':pend['map'][s],'indexed':pend['coll'],'index':pend['index'],'member':s}); pend=None
    for tr in trans:
        tr['req']=list(reversed(tr['req'])); tr['rsp']=[x for x in reversed(tr['rsp']) if x['var'] not in ('response_code','device_status')]
    return trans
def dumpvb(path):
    dd=DD(path); it=dd.items(); res={'commands':{},'vars':{}}
    for n in it:
        try: c=cmd_info(dd,n)
        except Exception: continue
        if not c: continue
        if n.upper().startswith('METHOD') or 'response_code' not in c['seq']: continue
        tr=transactions(dd,path,n)
        if not tr: continue
        res['commands'].setdefault(str(c['num']),[]).append({'name':n,'trans':tr})
    need=set()
    for cl in res['commands'].values():
        for c in cl:
            for tr in c['trans']: need.update(x['var'] for x in tr['req']+tr['rsp'])
    for v in need:
        try: res['vars'][v]=var_info(dd,v)
        except Exception as e: res['vars'][v]={'err':str(e)}
    return res
if __name__=='__main__':
    r=dumpvb(sys.argv[1]); json.dump(r,open(sys.argv[2],'w'),indent=1)
    print(len(r['commands']),'command numbers',len(r['vars']),'vars')
