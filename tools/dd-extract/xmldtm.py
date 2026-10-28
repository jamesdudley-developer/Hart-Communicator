import sys,os,re,json
import xml.etree.ElementTree as ET
def load(d):
    cmds={}; items={}; enums={}; strings={}
    for f in os.listdir(d):
        p=os.path.join(d,f)
        try: raw=open(p,'rb').read()
        except: continue
        if b'<' not in raw[:200]: continue
        txt=raw.decode('utf-8','replace')
        if not any(k in txt for k in ('<command ','<dataItem','<enumeration','<string name=')): continue
        txt=re.sub(r'^\s*<\?xml[^>]*\?>','',txt.lstrip('﻿'))
        try: root=ET.fromstring(txt)
        except ET.ParseError as e:
            try: root=ET.fromstring('<r>'+txt+'</r>')
            except ET.ParseError as e2: print('parse fail',f,e2,file=sys.stderr); continue
        for c in root.iter('command'):
            n=c.get('commandNumber')
            if n is None: continue
            trs=[]
            for t in c.iter('transaction'):
                def ps(tag):
                    el=t.find(tag); out=[]
                    if el is None: return out
                    for p_ in el.iter('param'):
                        out.append({k:p_.get(k) for k in ('name','length','type','position','value','isConstantParam','bitPosition') if p_.get(k) is not None})
                    return out
                trs.append({'req':ps('request'),'rsp':ps('reply')})
            rc=[(r.get('code'),r.get('name')) for r in c.iter('responseCode')]
            cmds.setdefault(n,[]).append({'name':c.get('name'),'op':c.get('operation'),'type':c.get('type'),'trans':trs,'rc':rc,'file':f})
        for di in root.iter('dataItem'):
            items[di.get('name')]={k:di.get(k) for k in ('type','label','enumeration','formatString','help','units')}
        for e in root.iter('enumeration'):
            enums[e.get('name')]=[(x.get('code'),x.get('label') or x.get('name'),x.get('name')) for x in e if x.tag in ('enum','bit')]
        for s in root.iter('string'):
            if s.get('name'): strings[s.get('name')]=(s.text or '').strip()
    return {'commands':cmds,'items':items,'enums':enums,'strings':strings}
if __name__=='__main__':
    r=load(sys.argv[1]); json.dump(r,open(sys.argv[2],'w'),indent=1)
    print(len(r['commands']),'cmd numbers',len(r['items']),'items',len(r['enums']),'enums',len(r['strings']),'strings')
