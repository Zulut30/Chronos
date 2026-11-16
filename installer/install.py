"""Olympus v3 installer. --prepare records hashes/backups; --apply installs (T3 must be closed); --rollback restores v2.
Every file is copied atomically and verified by SHA-256; any failure rolls everything back."""
import hashlib,json,os,shutil,subprocess,sys
from pathlib import Path
R=Path(__file__).parent;BASE=R.parent;M=R/'patch-manifest.json';STATE=R/'installed-state.json'
def sha(p):
 if not p.exists():return None
 with p.open('rb')as f:return hashlib.file_digest(f,'sha256').hexdigest()
mapping={
 **{n:'ru-l10n/features/'+n for n in ['30-tasks.js','50-machines.js','55-composer.js','60-studio.js','70-openrouter.js']},
 'openrouter-server.mjs':'openrouter-service/server.mjs','audio-tools.mjs':'openrouter-service/audio-tools.mjs','usage-ledger.mjs':'openrouter-service/usage-ledger.mjs',
 'web-mcp.mjs':'integrations-service/mcp.mjs','hackernews.mjs':'integrations-service/hackernews.mjs',
 'tasks-store.mjs':'tasks-service/store.mjs','tasks-mcp.mjs':'tasks-service/mcp.mjs',
 'skills-index.html':'skills-manager/index.html','skills-style.css':'skills-manager/style.css',
 'skills-server.mjs':'skills-manager/server.mjs','skills-mcp.mjs':'skills-manager/mcp.mjs'}
manifest=json.loads(M.read_text('utf8'))
def check_path(p):
 assert str(p.resolve()).lower().startswith(str(BASE.resolve()).lower()+os.sep),'Outside customization directory'
def atomic(src,dst):
 dst.parent.mkdir(parents=True,exist_ok=True);temp=dst.with_name(dst.name+'.olympus-v3-pending');shutil.copy2(src,temp);os.replace(temp,dst)

# ---- MCP registration of the skills manager for Claude Code and Codex (existing entries are left untouched) ----
NODE=r'C:\Program Files\nodejs\node.exe'
SKILLS_MCP=str(BASE/'skills-manager'/'mcp.mjs')
CODEX=Path.home()/'.codex'/'config.toml'
CODEX_BLOCK="\n[mcp_servers.oly-skills]\ncommand = '"+NODE+"'\nargs = ['"+SKILLS_MCP+"']\ntool_timeout_sec = 300\n"  # TOML literal strings: no escaping
def run(args):return subprocess.run(args,capture_output=True,text=True,encoding='utf8',errors='replace',timeout=120)
def claude_cli():
 c=Path.home()/'.local'/'bin'/'claude.exe'
 return str(c) if c.exists() else shutil.which('claude')
def register(state):
 text=CODEX.read_text('utf8')
 if '[mcp_servers.oly-skills]' in text:state['codex']='present'
 else:
  backup=R/'before'/'codex-config.toml'
  if not backup.exists():shutil.copy2(CODEX,backup)
  tmp=CODEX.with_name(CODEX.name+'.olympus-v3-pending');tmp.write_text(text.rstrip('\n')+'\n'+CODEX_BLOCK,encoding='utf8');os.replace(tmp,CODEX)
  state['codex']='added'
 cli=claude_cli()
 if not cli:raise RuntimeError('claude CLI not found')
 if SKILLS_MCP in run([cli,'mcp','get','oly-skills']).stdout:state['claude']='present'
 else:
  r=run([cli,'mcp','add-json','oly-skills',json.dumps({'type':'stdio','command':NODE,'args':[SKILLS_MCP],'env':{}}),'-s','user'])
  if r.returncode!=0:raise RuntimeError('claude mcp add-json failed: '+r.stderr+r.stdout)
  state['claude']='added'
 return state
def unregister(state):
 if state.get('codex')=='added':
  text=CODEX.read_text('utf8')
  if CODEX_BLOCK in text:CODEX.write_text(text.replace(CODEX_BLOCK,''),encoding='utf8')
 if state.get('claude')=='added' and claude_cli():run([claude_cli(),'mcp','remove','oly-skills','-s','user'])

def rollback(mcp=None):
 if mcp is None and STATE.exists():mcp=json.loads(STATE.read_text('utf8')).get('mcp',{})
 unregister(mcp or {})
 for item in reversed(manifest['serviceFiles']):
  dst=Path(item['destination']);check_path(dst)
  if item['beforeSha256']is None:
   if sha(dst)==item['sha256']:dst.unlink()
  else:atomic(Path(item['backup']),dst)
 atomic(Path(manifest['backupArchive']),Path(manifest['originalArchive']))
 if STATE.exists():STATE.unlink()
if '--prepare'in sys.argv:
 entries=[]
 for name,relative in mapping.items():
  source=R/'src'/name;dest=BASE/relative;backup=R/'before/services'/relative;check_path(dest)
  old=sha(dest)
  if dest.exists()and not backup.exists():backup.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(dest,backup)
  if old is not None:assert sha(backup)==old,'Live service changed since preparation'
  entries.append({'source':str(source),'destination':str(dest),'backup':str(backup),'beforeSha256':old,'sha256':sha(source)})
 manifest['serviceFiles']=entries;M.write_text(json.dumps(manifest,indent=2),encoding='utf8');print('Prepared',len(entries),'service files')
elif '--apply'in sys.argv:
 assert sha(Path(manifest['originalArchive']))==manifest['installedBeforeSha256'],'T3 archive changed after preparation'
 assert sha(Path(manifest['stagedArchive']))==manifest['patchedSha256'],'Staged archive changed'
 for item in manifest['serviceFiles']:
  assert sha(Path(item['destination']))==item['beforeSha256'],'Service changed after preparation: '+item['destination']
  assert sha(Path(item['source']))==item['sha256'],'Staged service changed: '+item['source']
 mcp={}
 try:
  atomic(Path(manifest['stagedArchive']),Path(manifest['originalArchive']))
  for item in manifest['serviceFiles']:atomic(Path(item['source']),Path(item['destination']))
  assert sha(Path(manifest['originalArchive']))==manifest['patchedSha256']
  for item in manifest['serviceFiles']:assert sha(Path(item['destination']))==item['sha256']
  register(mcp)
 except BaseException:
  rollback(mcp);raise
 STATE.write_text(json.dumps({'installed':True,'archiveSha256':manifest['patchedSha256'],'verifiedServices':len(manifest['serviceFiles']),'mcp':mcp},indent=2),encoding='utf8')
 print('Installed and verified archive and',len(manifest['serviceFiles']),'service files; MCP oly-skills:',json.dumps(mcp))
elif '--rollback'in sys.argv:
 rollback();print('Restored preceding Olympus v2 files; restart T3 to load them')
else:raise SystemExit('Use --prepare, --apply, or --rollback')
