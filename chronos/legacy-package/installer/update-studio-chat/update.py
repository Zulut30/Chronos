"""Olympus v3 -> v3 + "board to chat" (studio feature) + Chronos branding (85-chronos.js, cosmetic only).
--build    : staged server.asar = installed v3 archive with the 60-studio feature block replaced; every other file verified byte-identical.
--apply    : T3 must be closed. Installs the staged archive (sha-checked, atomic); any failure restores v3.
--rollback : T3 must be closed. Restores the v3 archive (olympus-v3/server.asar)."""
import copy,hashlib,json,os,shutil,struct,sys
from pathlib import Path
U=Path(__file__).parent;V3=U.parent
LIVE=Path(r'C:\Users\zulut\AppData\Local\Programs\t3code\resources\server.asar')
V3ARCH=V3/'server.asar';V3SHA='96ed9b4c8c439cdeab40fa2c2b97814a66a79137de1d6b6eb1279ca81c38bd57'
OLD=V3/'before/studio-service-20261117/60-studio.js';NEW=V3/'src/60-studio.js';BRAND=V3/'src/85-chronos.js'
OUT=U/'server.asar';M=U/'manifest.json';MAIN='main-lxHaZZx7.js'
def sha_bytes(b):return hashlib.sha256(b).hexdigest()
def sha(p):
 p=Path(p)
 if not p.exists():return None
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def header(f):
 a,b,c,d=struct.unpack('<4I',f.read(16));assert a==4 and c+4==b
 return json.loads(f.read(d)),8+b
def walk(t,p=''):
 for n,node in t.get('files',{}).items():
  q=p+'/'+n
  if 'files' in node:yield from walk(node,q)
  else:yield q,node
def integrity(data,bs=4194304):return dict(algorithm='SHA256',hash=sha_bytes(data),blockSize=bs,blocks=[sha_bytes(data[i:i+bs]) for i in range(0,len(data),bs)] or [sha_bytes(b'')])
def atomic(src,dst):
 tmp=Path(str(dst)+'.oly-tmp');shutil.copyfile(src,tmp);os.replace(tmp,dst)

def build():
 assert sha(V3ARCH)==V3SHA,'v3 archive changed'
 with V3ARCH.open('rb') as f:
  old,base=header(f);tree=copy.deepcopy(old);entries=dict(walk(tree))
  paths=[p for p in entries if p.endswith('/'+MAIN)];assert len(paths)==1;mp=paths[0];n=entries[mp]
  f.seek(base+int(n['offset']));s=f.read(n['size']).decode('utf8')
  o=OLD.read_text('utf8');w=NEW.read_text('utf8')+'\n'+BRAND.read_text('utf8')
  assert s.count(o)==1,('old studio block count',s.count(o));assert 'attachBoard' not in s and '__olyBrand' not in s
  ns=s.replace(o,w);assert ns.count(w)==1;newmain=ns.encode('utf8')
  physical=sorted(((p,x) for p,x in entries.items() if 'offset' in x and not x.get('unpacked')),key=lambda x:int(x[1]['offset']))
  total=0
  for p,x in physical:
   if p==mp:x['size']=len(newmain);x['integrity']=integrity(newmain,x.get('integrity',{}).get('blockSize',4194304))
   x['offset']=str(total);total+=x['size']
  j=json.dumps(tree,ensure_ascii=False,separators=(',',':')).encode();padded=(4+len(j)+3)//4*4;hp=struct.pack('<II',padded,len(j))+j+b'\0'*(padded-4-len(j))
  oldentries=dict(walk(old))
  with OUT.open('wb') as dst:
   dst.write(struct.pack('<II',4,len(hp))+hp)
   for p,x in physical:
    if p==mp:dst.write(newmain)
    else:o2=oldentries[p];f.seek(base+int(o2['offset']));dst.write(f.read(o2['size']))
 checked=unchanged=0
 with OUT.open('rb') as f,V3ARCH.open('rb') as prev:
  new,off=header(f);orig,ooff=header(prev);origs=dict(walk(orig))
  for p,x in walk(new):
   if 'offset' not in x or x.get('unpacked'):continue
   f.seek(off+int(x['offset']));b=f.read(x['size']);assert len(b)==x['size']
   if 'integrity' in x:assert x['integrity']==integrity(b,x['integrity']['blockSize']),p
   if p!=mp:o2=origs[p];prev.seek(ooff+int(o2['offset']));assert b==prev.read(o2['size']),p;unchanged+=1
   else:assert b==newmain
   checked+=1
 m={'live':str(LIVE),'v3Archive':str(V3ARCH),'v3Sha256':V3SHA,'staged':str(OUT),'stagedSha256':sha(OUT),'changed':[mp],'mainSha256':sha_bytes(newmain),'verifiedFiles':checked,'unchangedFiles':unchanged}
 M.write_text(json.dumps(m,indent=2),encoding='utf8');print(json.dumps(m,indent=2))

def apply():
 m=json.loads(M.read_text('utf8'))
 cur=sha(LIVE)
 if cur==m['stagedSha256']:print('Already installed');return
 assert cur==V3SHA,'Installed archive is not Olympus v3; nothing changed'
 assert sha(OUT)==m['stagedSha256'],'Staged archive changed'
 try:
  atomic(OUT,LIVE);assert sha(LIVE)==m['stagedSha256'],'Installed archive hash mismatch'
 except BaseException:
  atomic(V3ARCH,LIVE);raise
 print('Installed board-to-chat update',m['stagedSha256'])

def rollback():
 assert sha(V3ARCH)==V3SHA,'v3 archive missing or changed'
 atomic(V3ARCH,LIVE);assert sha(LIVE)==V3SHA;print('Restored Olympus v3 archive; restart T3')

if '--build' in sys.argv:build()
elif '--apply' in sys.argv:apply()
elif '--rollback' in sys.argv:rollback()
else:raise SystemExit(__doc__)
