import sys,struct,zlib,os
c,out=sys.argv[1],sys.argv[2]; d=open(c,'rb').read()
sig,_,size,_,off,_,vmin,vmaj,nfold,nfiles,flags=struct.unpack('<4sIIIIIBBHHH',d[:32])
p=36; cbf=cbd=0
if flags&4: cbres,cbf,cbd=struct.unpack('<HBB',d[36:40]); p=40+cbres
folders=[]
for i in range(nfold): co,nd,t=struct.unpack('<IHH',d[p:p+8]); folders.append((co,nd)); p+=8+cbf
streams={}
def folder(i):
    if i in streams: return streams[i]
    co,nd=folders[i]; q=co; s=bytearray(); w=b''
    for _ in range(nd):
        ck,cb,ub=struct.unpack('<IHH',d[q:q+8]); q+=8+cbd; blk=d[q:q+cb]; q+=cb
        z=zlib.decompressobj(-15,zdict=w) if w else zlib.decompressobj(-15)
        u=z.decompress(blk[2:]); s+=u; w=bytes(s[-32768:])
    streams[i]=s; return s
os.makedirs(out,exist_ok=True); q=off
for i in range(nfiles):
    usz,uoff,fi,dt,tm,at=struct.unpack('<IIHHHH',d[q:q+16]); e=d.index(b'\0',q+16); n=d[q+16:e].decode('latin1'); q=e+1
    open(os.path.join(out,n),'wb').write(folder(fi)[uoff:uoff+usz])
print('files',nfiles)
