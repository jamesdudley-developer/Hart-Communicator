import struct,re
IB=0x11000000
class DD:
    def __init__(s,path):
        s.d=open(path,'rb').read()
        s._items=None
    def ustr(s,va):
        d=s.d; o=va-IB
        if o<0 or o>=len(d)-2: return None
        e=o
        while e<len(d)-1 and d[e:e+2]!=b'\0\0': e+=2
        if e-o>4000: return None
        try: t=d[o:e].decode('utf-16-le')
        except: return None
        return t if t and all(31<ord(c)<127 or c in '\n\r\t' for c in t) else None
    def items(s):
        if s._items is None:
            s._items={}
            for m in re.finditer(rb'\xff\x75.\x68(...\x11)\xe8....\x85\xc0\x75',s.d,re.S):
                name=s.ustr(struct.unpack('<I',m.group(1))[0])
                if not name: continue
                f=re.compile(rb'\x50\xe8(....)\x50\xff\x75\x14',re.S).search(s.d,m.end(),m.end()+80)
                if not f: continue
                s._items.setdefault(name,f.start()+6+struct.unpack('<i',f.group(1))[0])
        return s._items
    def body(s,name):
        t=s.items()[name]; nx=s.d.find(b'\x55\x8b\xec\x83\xec\x0c\x68',t+8)
        return t,s.d[t:nx if nx>0 else t+30000]

MOVL=rb'(?:\xc7\x45.|\xc7\x85....)(....)'
MOVW=rb'(?:\x66\xc7\x45.|\x66\xc7\x85....)(..)'
def _imm(m1,m2):
    if m1 is not None: v=m1[0]; return v-256 if v>127 else v
    return struct.unpack('<i',m2)[0]
def var_info(dd,name):
    t,b=dd.body(name)
    refs=[]
    for p in re.finditer(rb'\x68(...\x11)',b[:3000],re.S):
        x=dd.ustr(struct.unpack('<I',p.group(1))[0])
        if x and not x.startswith('|'): refs.append(x)
    typ=size=None
    m=re.search(rb'(?:'+MOVL+rb'|\x83\x65.\x00|\x83\xa5....\x00).{0,30}?\xff\x50\x40',b,re.S)
    if m: typ=struct.unpack('<i',m.group(1))[0] if m.group(1) else 0
    m=re.search(MOVW+rb'.{0,30}?\xff\x50\x48',b,re.S)
    if m: size=struct.unpack('<H',m.group(1))[0]
    enum=[]
    for m in re.finditer(rb'\x68(...\x11)\xe8....\x50\x8d\x45.\x50\xe8....(?:\x6a(.)|\x68(....))\x8b\x45.\x8b\x00\xff\x75.\xff\x50\x20',b,re.S):
        val=_imm(m.group(2),m.group(3))
        lab=None
        for p in re.finditer(rb'\x68(...\x11)',b[m.end():m.end()+260],re.S):
            lab=dd.ustr(struct.unpack('<I',p.group(1))[0])
            if lab: break
        if lab is not None: enum.append([val&0xffffffff if val<0 else val,lab])
    return {'label':refs[0] if refs else name,'help':refs[1] if len(refs)>1 else '','type':typ,'size':size,'enum':enum}
def cmd_info(dd,name):
    t,b=dd.body(name)
    c=re.search(rb'(?:\x68(..)\x00\x00|\x6a(.))(?:\x8b\x45(.)\x8b\x00\xff\x75\3|\x8b\x85(....)\x8b\x00\xff\xb5\4)\xff\x50\x20',b,re.S)
    if not c: return None
    num=int.from_bytes(c.group(1) or c.group(2),'little')
    names=dd.items(); seq=[]
    for m in re.finditer(rb'[\x68\xb8-\xbf](...\x11)',b,re.S):
        s=dd.ustr(struct.unpack('<I',m.group(1))[0])
        if s in names: seq.append(s)
    errs=[]
    for p in re.finditer(rb'\x68(...\x11)',b,re.S):
        x=dd.ustr(struct.unpack('<I',p.group(1))[0])
        if x and not x.startswith('|'): errs.append(x)
    return {'num':num,'seq':list(reversed(seq)),'strings':errs}

TYPES={0:'float',1:'double',2:'int',3:'unsigned',4:'enum',5:'bitenum',6:'index',7:'ascii',8:'packed',9:'password',10:'bitstring',11:'date',12:'time',13:'datetime'}
def nbytes(v):
    t,s=v['type'],v['size']
    if t==0: return 4
    if t==1: return 8
    if t==8 and s: return s*3//4
    return s
def dump(path):
    dd=DD(path); it=dd.items(); cmds=[]; vars_={}
    for n in it:
        try: c=cmd_info(dd,n)
        except Exception: c=None
        if c and any(('error' in x.lower() or 'restricted' in x.lower() or 'not implemented' in x.lower() or 'success' in x.lower()) for x in c['strings']):
            cmds.append({'name':n,**c})
    for c in cmds:
        for v in c['seq']:
            if v not in vars_ and v in it:
                try: vars_[v]=var_info(dd,v)
                except Exception as e: vars_[v]={'err':str(e)}
    return {'commands':sorted(cmds,key=lambda c:c['num']),'vars':vars_}
