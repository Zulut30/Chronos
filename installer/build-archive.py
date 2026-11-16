import copy,hashlib,json,struct
from pathlib import Path
R=Path(__file__).parent
LIVE=Path(r'C:\Users\zulut\AppData\Local\Programs\t3code\resources\server.asar')
def sha(data):return hashlib.sha256(data).hexdigest()
def filehash(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def header(f):
 a,b,c,d=struct.unpack('<4I',f.read(16));assert a==4 and c+4==b
 return json.loads(f.read(d)),8+b
def walk(tree,p=''):
 for name,node in tree.get('files',{}).items():
  q=p+'/'+name
  if 'files'in node:yield from walk(node,q)
  else:yield q,node
def integrity(data,blocksize=4194304):return dict(algorithm='SHA256',hash=sha(data),blockSize=blocksize,blocks=[sha(data[i:i+blocksize])for i in range(0,len(data),blocksize)]or[sha(b'')])
before=R/'before/server.asar'
if not before.exists():before.write_bytes(LIVE.read_bytes())
assert filehash(before)==filehash(LIVE),'Installed build changed'
with before.open('rb') as f:
 old,base=header(f);tree=copy.deepcopy(old);entries=dict(walk(tree));changes={}
 def get(name):
  paths=[p for p in entries if p.endswith('/'+name)];assert len(paths)==1,(name,paths);p=paths[0];n=entries[p];f.seek(base+int(n['offset']));return p,f.read(n['size'])
 p,b=get('main-lxHaZZx7.js');s=b.decode('utf8').replace('\r\n','\n')
 assert b==(R/'installed/main-lxHaZZx7.js').read_bytes()
 for name in ['30-tasks.js','50-machines.js','60-studio.js','70-openrouter.js']:
  oldfeature=(R/'before'/name).read_text('utf8');assert s.count(oldfeature)==1,(name,s.count(oldfeature));new=(R/'src'/name).read_text('utf8')
  if name=='50-machines.js':new=(R/'src/55-composer.js').read_text('utf8')+'\n'+new
  s=s.replace(oldfeature,new)
 hint='Спросите что угодно. @ файлы, $ скиллы, / команды';assert hint in s
 s=s.replace(hint,'Спросите что угодно. @ контекст, # задачи, ! поиск, $ скиллы, / команды')
 changes[p]=s.encode('utf8')
 for source in (R/'native').iterdir():
  p,b=get(source.name);assert b.decode('utf8').replace('\r\n','\n')==(R/'installed'/source.name).read_text('utf8'),source.name;changes[p]=source.read_bytes()
 physical=sorted(((p,n)for p,n in entries.items()if'offset'in n and not n.get('unpacked')),key=lambda x:int(x[1]['offset']))
 total=0
 for p,n in physical:
  if p in changes:n['size']=len(changes[p]);n['integrity']=integrity(changes[p],n.get('integrity',{}).get('blockSize',4194304))
  n['offset']=str(total);total+=n['size']
 j=json.dumps(tree,ensure_ascii=False,separators=(',',':')).encode();padded=(4+len(j)+3)//4*4;hp=struct.pack('<II',padded,len(j))+j+b'\0'*(padded-4-len(j))
 out=R/'server.asar'
 with out.open('wb') as dst:
  dst.write(struct.pack('<II',4,len(hp))+hp)
  oldentries=dict(walk(old))
  for p,n in physical:
   if p in changes:dst.write(changes[p])
   else:
    original=oldentries[p];f.seek(base+int(original['offset']));dst.write(f.read(original['size']))
with out.open('rb') as f,before.open('rb') as previous:
 new,offset=header(f);original,originaloffset=header(previous);originals=dict(walk(original));checked=0;unchanged=0
 for p,n in walk(new):
  if'offset'not in n or n.get('unpacked'):continue
  f.seek(offset+int(n['offset']));b=f.read(n['size']);assert len(b)==n['size']
  if 'integrity'in n:assert n['integrity']==integrity(b,n['integrity']['blockSize']),p
  if p not in changes:
   o=originals[p];previous.seek(originaloffset+int(o['offset']));assert b==previous.read(o['size']),p;unchanged+=1
  checked+=1
manifest={'version':'0.1.10-nightly.20261116.4774','originalArchive':str(LIVE),'stagedArchive':str(out),'backupArchive':str(before),'installedBeforeSha256':filehash(before),'patchedSha256':filehash(out),'changed':list(changes),'verifiedFiles':checked,'unchangedFiles':unchanged}
(R/'patch-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf8')
print(json.dumps(manifest,indent=2))
