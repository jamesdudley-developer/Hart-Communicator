import sys,struct,zlib,os
cabs=sys.argv[2:]; out=sys.argv[1]
stream=bytearray(); files=[]; pending=b''; window=b''
for c in cabs:
    d=open(c,'rb').read()
    sig,_,size,_,off,_,vmin,vmaj,nfold,nfiles,flags=struct.unpack('<4sIIIIIBBHHH',d[:32])
    p=36; cbd=0; cbf=0
    if flags&4:
        cbres,cbf,cbd=struct.unpack('<HBB',d[36:40]); p=40+cbres
    if flags&1: p=d.index(b'\0',p)+1; p=d.index(b'\0',p)+1
    if flags&2: p=d.index(b'\0',p)+1; p=d.index(b'\0',p)+1
    stream=bytearray(); window=b''; pending=b''; base=len(files)
    folders=[]
    for i in range(nfold):
        co,nd,t=struct.unpack('<IHH',d[p:p+8]); folders.append((co,nd)); p+=8+cbf
    q=off
    for i in range(nfiles):
        usz,uoff,fi,dt,tm,at=struct.unpack('<IIHHHH',d[q:q+16]); e=d.index(b'\0',q+16); files.append([d[q+16:e].decode('latin1'),uoff,usz,None]); q=e+1
    co,nd=folders[0]; q=co
    for i in range(nd):
        ck,cb,ub=struct.unpack('<IHH',d[q:q+8]); q+=8+cbd; blk=d[q:q+cb]; q+=cb
        pending+=blk
        if ub==0: continue
        assert pending[:2]==b'CK',pending[:4]
        z=zlib.decompressobj(-15,zdict=window) if window else zlib.decompressobj(-15)
        u=z.decompress(pending[2:]); assert len(u)==ub,(len(u),ub)
        stream+=u; window=bytes(stream[-32768:]); pending=b''

    os.makedirs(out,exist_ok=True)
    for n,o,sz,_ in files[base:]:
        open(os.path.join(out,n),'wb').write(stream[o:o+sz])
print('files',len(files))
