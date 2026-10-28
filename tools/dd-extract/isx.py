import sys,struct,os,zlib
MAGIC=bytes([0x13,0x35,0x86,0x07])
def dec(buf,key,off=0):
    out=bytearray(len(buf)); kl=len(key)
    for i,b in enumerate(buf):
        r=((b<<4)|(b>>4))&0xff
        out[i]=(~(key[(i+off)%kl]^r))&0xff
    return bytes(out)
def extract(path,outdir,want=None):
    d=open(path,'rb').read()
    p=d.rfind(b'ISSetupStream\0')
    n,typ=struct.unpack('<HI',d[p+14:p+20]); q=p+0x2e
    os.makedirs(outdir,exist_ok=True); res=[]
    for i in range(n):
        fnl,flags,_,flen,_,uni=struct.unpack('<IIHI8sH',d[q:q+24]); q+=24+(24 if typ>=4 else 0)
        name=d[q:q+fnl].decode('utf-16-le'); q+=fnl
        data=d[q:q+flen]; q+=flen
        key=bytes(ord(c)^MAGIC[j%4] for j,c in enumerate(name))
        if flags&2:
            if flags&4:
                data=b''.join(dec(data[k:k+1024],key) for k in range(0,len(data),1024))
            else: data=dec(data,key)
        if data[:2]==b'x\x9c':
            data=zlib.decompressobj().decompress(data)
        res.append((name,flags,flen,len(data),data[:8]))
        if want is None or any(w in name for w in want):
            open(os.path.join(outdir,os.path.basename(name)),'wb').write(data)
    return res
if __name__=='__main__':
    for r in extract(sys.argv[1],sys.argv[2]): print(r)
