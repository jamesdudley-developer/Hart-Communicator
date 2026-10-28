import struct,sys,os
def streams(path):
    d=open(path,'rb').read()
    assert d[:8]==bytes.fromhex('d0cf11e0a1b11ae1')
    ss=1<<struct.unpack('<H',d[30:32])[0]; mss=1<<struct.unpack('<H',d[32:34])[0]
    nfat,dirstart,_,cutoff,minifat,nmini,difat,ndifat=struct.unpack('<IIIIIIII',d[44:76])
    fatsecs=list(struct.unpack('<109I',d[76:76+436]))
    sec=lambda n: d[(n+1)*ss:(n+2)*ss]
    while difat!=0xFFFFFFFE and ndifat:
        x=struct.unpack('<%dI'%(ss//4),sec(difat)); fatsecs+=x[:-1]; difat=x[-1]; ndifat-=1
    fat=[]
    for f in fatsecs[:nfat]: fat+=struct.unpack('<%dI'%(ss//4),sec(f))
    def chain(s):
        out=[]
        while s<0xFFFFFFFA: out.append(s); s=fat[s]
        return out
    def read(s,size): return b''.join(sec(x) for x in chain(s))[:size]
    dd=read(dirstart,10**9); ents=[]
    for i in range(0,len(dd),128):
        e=dd[i:i+128]; nl=struct.unpack('<H',e[64:66])[0]
        name=e[:max(nl-2,0)].decode('utf-16-le','replace'); typ=e[66]
        st,size=struct.unpack('<II',e[116:124]); ents.append((name,typ,st,size))
    root=ents[0]; ministream=read(root[2],root[3])
    mfat=[]
    for s in chain(minifat): mfat+=struct.unpack('<%dI'%(ss//4),sec(s))
    def mread(s,size):
        out=b''
        while s<0xFFFFFFFA: out+=ministream[s*mss:(s+1)*mss]; s=mfat[s]
        return out[:size]
    for name,typ,st,size in ents[1:]:
        if typ==2: yield name,(read(st,size) if size>=cutoff else mread(st,size))
if __name__=='__main__':
    os.makedirs(sys.argv[2],exist_ok=True)
    for i,(n,b) in enumerate(streams(sys.argv[1])):
        if b[:4]==b'MSCF' or len(b)>100000:
            fn=os.path.join(sys.argv[2],'s%02d_%d.%s'%(i,len(b),'cab' if b[:4]==b'MSCF' else 'bin')); open(fn,'wb').write(b); print(fn,len(b),b[:4])
