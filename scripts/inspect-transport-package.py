"""Authenticated, byte-only transport package inspection. Never evaluates backend code."""
import ast,hashlib,json,re,subprocess,sys
from pathlib import Path,PurePosixPath
MANIFEST='scripts/transport-package-manifest.json'
def sha(b):return hashlib.sha256(b).hexdigest()
def canonical(b):return b.replace(b'\r\n',b'\n')
def inventory(s):
 return re.findall(r'^import\s+.+?\s+from\s+[\'\"]([^\'\"]+)[\'\"];?\s*$',s,re.M)
def parse_only(sources):
 # SourceTextModule constructor only: no link/evaluate/import/require of supplied sources.
 js="const fs=require('node:fs'),vm=require('node:vm');const x=JSON.parse(fs.readFileSync(0,'utf8')),o={};for(const [n,s] of Object.entries(x))o[n]=[...new vm.SourceTextModule(s,{identifier:n}).dependencySpecifiers];process.stdout.write(JSON.stringify(o));"
 p=subprocess.run(['node','--experimental-vm-modules','--no-warnings','-e',js],input=json.dumps(sources),text=True,capture_output=True,timeout=60)
 assert p.returncode==0, p.stderr
 return json.loads(p.stdout)
def verify(files,trusted):
 assert sha(canonical(files[MANIFEST]))==trusted,'outer manifest digest'
 m=json.loads(files[MANIFEST]);assert set(files)==set(m['members'])|{MANIFEST},'complete member equality'
 assert m['version']==2 and m['bytePolicy']=='canonical-LF-v2','byte policy'
 portable=set(m['canonicalPaths'])
 assert portable==set(m['parentSelected'])|{n for n in m['overlay'] if not n.startswith('provenance/')}|{MANIFEST},'finite canonical scope'
 for n,p in m['members'].items():
  assert not PurePosixPath(n).is_absolute() and '..' not in PurePosixPath(n).parts and ':' not in n and '\\' not in n,'unsafe path'
  assert re.fullmatch('[a-f0-9]{64}',p['raw']),'raw custody pin '+n
  if n not in portable:assert sha(files[n])==p['raw'],'raw member '+n
  assert sha(canonical(files[n]))==p['canonicalLF'],'canonical member '+n
 ar=json.loads(files['scripts/actual-reader-transport-pins.json'])
 assert ar['version']==2 and ar['bytePolicy']==m['bytePolicy'],'loader byte policy'
 assert ar['runtime']==m['runtime'],'effective runtime pin equality'
 assert list(ar['artifacts'])==m['artifactPaths'],'artifact membership'
 for n,p in ar['artifacts'].items():assert p==m['members'][n],'artifact pin'
 assert m['members'][ar['reviewedFenceVerifier']['path']]['raw']==ar['reviewedFenceVerifier']['raw']
 assert m['members'][ar['reviewedFenceVerifier']['path']]['canonicalLF']==ar['reviewedFenceVerifier']['canonicalLF']
 sources={n:canonical(files[n]).decode('utf8') for n in m['runtime']}
 edges=parse_only(sources)
 for n,p in m['runtime'].items():
  assert {k:p[k] for k in ('raw','canonicalLF')}==m['members'][n]
  assert not re.search(r'\b(?:require|import)\s*\(',sources[n]),'dynamic edge '+n
  assert edges[n]==p['edges'],'per-consumer edge '+n
  assert re.findall(r'^export (?:async )?function (\w+)',sources[n],re.M)==p['exports'],'export equality '+n
 visited=set()
 def visit(n):
  if n in visited:return
  assert n in m['runtime'],'undeclared runtime'
  visited.add(n)
  for e in edges[n]:
   if e.startswith('backend/'):visit('velo/'+e+'.js')
   else:assert e in m['sdk'],'SDK binding'
 visit('velo/backend/guestBookingInvoiceDelivery.js')
 assert visited==set(m['runtime']),'closed runtime equality'
 assert 'velo/backend/guestBookingInvoiceIssuance.js' not in visited
 # Verify every recorded historical source-table leaf and pointer, including nested manifests.
 seen=set();lookup={}
 for leaf in m['sourceTableLeaves']:
  table=files[leaf['table']];assert m['members'][leaf['table']]['raw']==leaf['tableRaw'],'nested manifest custody'
  obj=json.loads(table)
  # Table keys may themselves contain slashes: find exact source key recursively.
  matches=[]
  def walk(d,p=''):
   if not isinstance(d,dict):return
   for k,v in d.items():
    q=p+'/'+k
    if q==leaf['pointer']:matches.append(v)
    if isinstance(v,dict):walk(v,q)
  walk(obj);assert len(matches)==1
  value=matches[0]
  declared=value.get('canonical_sha256',value.get('canonicalLF')) if isinstance(value,dict) else value
  assert declared==leaf['declared']
  assert leaf['effectiveCanonical']==m['legacyCanonicalAliases'].get(declared,declared)
  assert sha(canonical(files[leaf['member']]))==leaf['effectiveCanonical'],'historical leaf'
  assert m['members'][leaf['member']]['raw']==leaf['raw'],'historical raw custody'
  key=(leaf['table'],leaf['pointer']);assert key not in seen;seen.add(key)
  lookup[key]=files[leaf['member']]
 # Independently enumerate hash-bearing source keys; no omitted table member is accepted.
 tables=set(m['historicalSourceTables'])|{x['member'] for x in m['sourceTableLeaves'] if x['sourcePath'].endswith('.json')}
 expected=set()
 for t in tables:
  def collect(d,p=''):
   if not isinstance(d,dict):return
   for k,v in d.items():
    q=p+'/'+k
    if '/' in k or k.endswith(('.py','.json','.docx','.js','.cjs')):
     if isinstance(v,str) and re.fullmatch('[a-f0-9]{64}',v):expected.add((t,q))
     if isinstance(v,dict) and ('canonical_sha256' in v or 'canonicalLF' in v):expected.add((t,q))
    if isinstance(v,dict):collect(v,q)
  collect(json.loads(files[t]))
 assert expected==seen,'all source table dependency equality'
 d=json.loads(files['scripts/distinct-source-pins.json'])
 for kind in ('producer','consumer'):
  historical={n:canonical(lookup[('scripts/distinct-source-pins.json','/'+kind+'/'+n)]).decode() for n in d[kind]}
  assert parse_only(historical)==d[kind+'Edges'],'historical edge table'
 for n,expected_imports in d['pythonImports'].items():
  text=lookup[('scripts/distinct-source-pins.json','/python/'+n)].decode()
  parsed=ast.parse(text)
  actual=[ast.unparse(x) for x in sorted(ast.walk(parsed),key=lambda x:getattr(x,'lineno',0)) if isinstance(x,(ast.Import,ast.ImportFrom))]
  assert actual==expected_imports,'historical Python import table '+n
 # Whole declared parent-JavaScript incoming scope, plus the exact trio overlay.
 incoming={t:[] for t in m['incoming']}
 incoming_parsed=parse_only({n:canonical(files[p['member']]).decode() for n,p in m['incomingScope'].items()})
 for n,p in m['incomingScope'].items():
  b=files[p['member']];assert m['members'][p['member']]['raw']==p['raw'],'incoming raw custody'
  if n in m['runtime']:assert canonical(b)==canonical(files[n]),'effective incoming source'
  es=incoming_parsed[n];assert es==p['edges']
  for t in incoming:
   if t in es:incoming[t].append(n)
 assert {t:sorted(v) for t,v in incoming.items()}==m['incoming'],'forbidden incoming consumer'
 assert m['incoming']['backend/guestBookingInvoiceTransportAuth']==['velo/backend/guestBookingCompletionAuthority.js','velo/backend/guestBookingInvoiceDelivery.js']
 assert m['incoming']['backend/guestBookingInvoiceDelivery']==[]
 custody=json.loads(files['scripts/guest-delivery-custody.json'])
 final_package=json.loads(files['scripts/guest-delivery-final-package.json'])
 assert sha(canonical(files['scripts/guest-delivery-custody.json']))==final_package['base_manifest']['canonical_sha256'],'historical nested trust root'
 js_historical={}
 for n,expected_imports in custody['application_imports'].items():
  text=canonical(lookup[('scripts/guest-delivery-custody.json','/files/'+n)]).decode()
  if n.endswith('.py'):
   actual=sorted(ast.unparse(x) for x in ast.walk(ast.parse(text)) if isinstance(x,(ast.Import,ast.ImportFrom)))
   assert actual==expected_imports,'custody Python imports '+n
  elif n.endswith(('.js','.jsw')):js_historical[n]=text
  else:assert expected_imports==[],'custody non-module imports '+n
 assert {n:sorted(es) for n,es in parse_only(js_historical).items()}=={n:custody['application_imports'][n] for n in js_historical},'custody JS imports'
 assert custody['imports']==custody['application_imports']['booking_engine/guest_invoice_delivery.py']
 overlay=json.loads(files['scripts/transport-consumer-overlay.json'])
 assert overlay['version']==2 and overlay['bytePolicy']==m['bytePolicy'],'overlay byte policy'
 assert overlay['effectiveRuntimeTable']==m['runtime'],'overlay effective table'
 for n,p in overlay['historicalConsumerDelta'].items():
  assert p['historicalCanonical']==d['consumer'].get(n) and p['historicalEdges']==d['consumerEdges'].get(n)
  assert p['transport']==m['runtime'][n]
 a=json.loads(files['scripts/fixtures/completion-authority-distinct-groups.json']);b=json.loads(files['scripts/fixtures/completion-authority-foreign.json'])
 assert a['sourceHashes']==d['producer']
 assert b['sourceHashes']==json.loads(files['scripts/fixtures/completion-authority-dependencies.json'])['files']
 ev=json.loads(files['scripts/fixtures/retained-native-evidence.json']);assert ev['exit']==0
 final=[json.loads(s) for s in ev['stderr'] if s.startswith('{')][-1]
 for n,rows in a['db']['rows'].items():assert final['rows'][n]==rows
 journal=final['rows']['GuestBookingInvoiceIssuances'];assert [r['kind'] for r in journal]==['INITIAL_ISSUANCE','PREPARED','START','ACK']
 for row in journal:
  for op in ('insert','insertAck'):assert sum(e.get('op')==op and e.get('collection')=='GuestBookingInvoiceIssuances' and e.get('id')==row['_id'] for e in ev['trace'])==1
 return {'status':'PASS','members':len(m['members']),'sourceTableLeaves':len(seen),'runtimeFiles':len(visited),'backendEvaluations':0,'producerInvocations':0}
if __name__=='__main__':
 assert len(sys.argv)==4 and sys.argv[1]=='--inspect','exact --inspect ROOT TRUSTED_MANIFEST_SHA256 required'
 root=Path(sys.argv[2]).resolve();files={}
 for p in root.rglob('*'):
  assert not p.is_symlink(),'linked member'
  if p.is_file():files[p.relative_to(root).as_posix()]=p.read_bytes()
 print(json.dumps(verify(files,sys.argv[3])))
