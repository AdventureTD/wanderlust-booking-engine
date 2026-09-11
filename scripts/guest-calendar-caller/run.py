"""Fresh producer, production scope mint, both actual HTTP handlers. All sockets denied."""
import base64, io, json, os, queue, shutil, socket, subprocess, sys, threading
from pathlib import Path
from unittest.mock import patch
from email import policy
from email.parser import BytesParser
ROOT=Path(__file__).resolve().parents[2]
def custody_controls():
 """Finite packaging controls; no application modules or producer execution."""
 import tempfile
 manifest=json.loads(Path(__file__).with_name('pins.json').read_text())
 paths=set(manifest['support'])|set(manifest['graph'])
 paths.update('scripts/guest-calendar-caller/'+n for n in ('pins.json','custody.cjs','run.py'))
 results=[]
 with tempfile.TemporaryDirectory(prefix='caller-custody-') as tmp:
  root=Path(tmp)
  for name in paths:
   data=(ROOT/name).read_bytes()
   if not name.endswith('.docx'):data=data.replace(b'\r\n',b'\n')
   target=root/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
  target=root/'scripts/guest-book-confirm-search/sdk.cjs';original=target.read_bytes()
  pin=root/'scripts/guest-calendar-caller/pins.json';original_pin=pin.read_bytes()
  runner=root/'scripts/guest-calendar-caller/run.py';custody=runner.with_name('custody.cjs')
  launcher="""import sys,runpy,importlib.abc
class Sentinel(importlib.abc.MetaPathFinder):
 def find_spec(self,name,path=None,target=None):
  if name.split('.')[0] in ('fastapi','requests','urllib3','invoice_service','booking_engine'):
   print('APPLICATION_IMPORT_SENTINEL',flush=True)
   raise SystemExit(73)
sys.meta_path.insert(0,Sentinel())
sys.argv=[sys.argv[1]]
runpy.run_path(sys.argv[0],run_name='__main__')
"""
  for case in ('lf','crlf','appended','lone-cr','missing','stale-pin','missing-pin','binary-tamper'):
   target.write_bytes(original);pin.write_bytes(original_pin)
   binary=root/'invoice_template.docx';binary_original=binary.read_bytes()
   if case=='crlf':target.write_bytes(original.replace(b'\n',b'\r\n'))
   if case=='appended':target.write_bytes(original+b' ')
   if case=='lone-cr':target.write_bytes(original+b'\r')
   if case=='missing':target.unlink()
   if case=='stale-pin':
    stale=json.loads(original_pin);stale['support']['scripts/guest-book-confirm-search/sdk.cjs']='0'*64;pin.write_text(json.dumps(stale))
   if case=='missing-pin':pin.unlink()
   if case=='binary-tamper':binary.write_bytes(binary_original+b'\r\n')
   positive=case in ('lf','crlf')
   for kind,command in (('module',['node','-e',"require("+json.dumps(str(custody))+ ").verify()"]),('cli',['node',str(custody)]),('bootstrap',[sys.executable,'-B','-c',launcher,str(runner)])):
    output=root/('output-'+case+'-'+kind);output.mkdir()
    env=dict(os.environ,GI_OUTPUT=str(output))
    child=subprocess.run(command,cwd=root,env=env,capture_output=True,text=True,timeout=30)
    sentinel='APPLICATION_IMPORT_SENTINEL' in child.stdout
    passed=(child.returncode==73 and sentinel) if positive and kind=='bootstrap' else (child.returncode==0 if positive else child.returncode!=0 and not sentinel)
    results.append(dict(case=case,kind=kind,passed=passed,exit=child.returncode,stdout=child.stdout,stderr=child.stderr))
   binary.write_bytes(binary_original)
 print(json.dumps({'controls':results,'passed':all(r['passed'] for r in results)},indent=2))
 return 0 if all(r['passed'] for r in results) else 1

if __name__=='__main__' and sys.argv[1:]==['--custody-controls']:
 raise SystemExit(custody_controls())
subprocess.run(['node',str(Path(__file__).with_name('custody.cjs'))],check=True)
CASE=sys.argv[1] if len(sys.argv)>1 else 'happy'
OUT=Path(os.environ['GI_OUTPUT'])/(sys.argv[2] if len(sys.argv)>2 else CASE)
OUT.mkdir(exist_ok=False)
sys.path.insert(0,str(ROOT))
from fastapi.testclient import TestClient
import requests
from urllib3.response import HTTPResponse
from urllib3._collections import HTTPHeaderDict
import invoice_service
from booking_engine import guest_invoice_delivery as delivery, guest_invoice_wire_auth as auth, invoice_word as word
p=subprocess.Popen(['node','--experimental-vm-modules',str(Path(__file__).with_name('bridge.cjs')),str(OUT),CASE],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
q=queue.Queue();lines=[];errors=[];journal=[];sent=[];rendered=[];native=[]
def receive():
 for line in p.stdout:
  lines.append(line);q.put(json.loads(line))
 q.put(None)
threading.Thread(target=receive,daemon=True).start()
threading.Thread(target=lambda:errors.extend(p.stderr),daemon=True).start()
def read():
 v=q.get(timeout=120)
 assert v is not None and v.get('kind')!='error',(v,errors)
 return v
def write(v):
 p.stdin.write(json.dumps(v)+'\n');p.stdin.flush()
def denied(*a,**kw):raise AssertionError('real network forbidden')
real_connect=socket.socket.connect
def guarded_connect(sock,address):
 # Windows asyncio's internal wakeup socketpair only, not application transport.
 import inspect
 frame=inspect.currentframe().f_back
 if frame.f_code.co_name=='_fallback_socketpair' and frame.f_code.co_filename==socket.__file__:
  return real_connect(sock,address)
 return denied()
def adapter_send(self,request,**kwargs):
 assert request.url=='https://www.wanderlustcaribbean.com/_functions/guestInvoiceJournal'
 raw=request.body.encode() if isinstance(request.body,str) else request.body
 write(dict(kind='journal',url=request.url,headers=dict(request.headers),bytes=base64.b64encode(raw).decode()))
 result=read();assert result['kind']=='journal',result
 journal.append(dict(operation=json.loads(raw)['operation'],status=result['status'],body=json.loads(base64.b64decode(result['bytes']))))
 if CASE=='journal-start-loss' and journal[-1]['operation']=='tryStart' and journal[-1]['body'].get('result',{}).get('won') is True:
  raise requests.Timeout('inert signed START grant response lost after native winner')
 response=requests.Response();response.status_code=result['status'];response.request=request;response.url=request.url
 pairs=list(result['headers'].items());response.headers.update(dict(pairs))
 response.raw=HTTPResponse(body=io.BytesIO(base64.b64decode(result['bytes'])),headers=HTTPHeaderDict(pairs),preload_content=False)
 return response
real_render=delivery.render_invoice_pdf_for_service
real_run=subprocess.run
def observed_run(*args,**kwargs):
 completed=real_run(*args,**kwargs);native.append(dict(command=args[0],exit=completed.returncode,stdout=str(completed.stdout),stderr=str(completed.stderr)));return completed
def render(invoice,output):
 used=real_render(invoice,output);assert used=='word';shutil.copyfile(output,OUT/'invoice.pdf')
 rendered.append(dict(renderer=used,total=str(invoice.total),bookingNumber=invoice.booking_number,checkIn=str(invoice.check_in),checkOut=str(invoice.check_out)))
 return used
def send(mime,token):
 assert token=='inert-token';sent.append(mime);(OUT/'inert-provider.eml').write_bytes(mime)
 if CASE=='provider-loss':raise ValueError('inert provider applied then response lost')
 return 'inert-message'
try:
 config={'WBE_GUEST_INVOICE_ENABLED':'true','WBE_GUEST_INVOICE_SITE_ORIGIN':'https://www.wanderlustcaribbean.com','WBE_GUEST_INVOICE_AUDIENCE':'wbe:fixture',
 'WBE_GUEST_INVOICE_CHANNEL_KEYS':json.dumps({'activeKid':'local','keys':[{'kid':'local','keyHex':'11'*32}]},separators=(',',':')),
 'WBE_INVOICE_RENDERER':'word','WBE_INVOICE_REPORTLAB_FALLBACK':'0','LIBREOFFICE_PATH':os.environ.get('LIBREOFFICE_PATH') or shutil.which('soffice') or ''}
 import types
 now=[1800000000000]
 with patch.dict(os.environ,config),patch.object(auth,'_now',lambda:now[0]),patch.object(socket.socket,'connect',guarded_connect),patch.object(socket.socket,'connect_ex',denied),patch.object(socket,'create_connection',denied),patch.object(requests.adapters.HTTPAdapter,'send',adapter_send),patch.object(delivery.gmail_sender,'prepare_journal_token',lambda:'inert-token'),patch.object(delivery.gmail_sender,'send_journal_mime',send),patch.object(delivery,'render_invoice_pdf_for_service',render),patch.object(word,'subprocess',types.SimpleNamespace(run=observed_run)):
  client=TestClient(invoice_service.app)
  while True:
   message=read()
   if message['kind']=='done':break
   assert message['kind']=='dispatch',message
   now[0]=message['now']
   raw=base64.b64decode(message['bytes'])
   result=client.post('/private/guest-invoice/v1/dispatch',content=raw,headers=message['headers'])
   assert result.status_code==200,(result.status_code,result.text)
   assert result.json()['status']=='PROVIDER_ACCEPTED',result.text
   attachment,=BytesParser(policy=policy.default).parsebytes(sent[-1]).iter_attachments()
   assert attachment.get_payload(decode=True)==(OUT/'invoice.pdf').read_bytes()
   shutil.copyfile(OUT/'invoice.pdf',OUT/('invoice-'+str(len(sent))+'.pdf'))
   (OUT/('provider-'+str(len(sent))+'.eml')).write_bytes(sent[-1])
   write(dict(kind='dispatch-result',status=result.status_code,body=result.text))
  write({'kind':'snapshot'});snapshot=read()
  assert len(sent)==len(rendered)==2
  prepared=[x for x in snapshot['rows'] if x['kind']=='PREPARED']
  assert len(prepared)==2
  for row,mime in zip(prepared,sent):
   assert base64.b64decode(row['encoded'])==mime
   attachment,=BytesParser(policy=policy.default).parsebytes(mime).iter_attachments()
   assert attachment.get_payload(decode=True).startswith(b'%PDF')
  (OUT/'result.json').write_text(json.dumps(dict(case=CASE,done=message,providerCalls=len(sent),rendered=rendered,native=native,journal=journal),indent=2))
  print(json.dumps(dict(case=CASE,status='PASS',providerCalls=len(sent),calendarACK=message['calendarACK'])))
finally:
 try:write({'kind':'close'});p.stdin.close();p.wait(timeout=10)
 except Exception:p.kill();p.wait(timeout=5)
 (OUT/'native-child.json').write_text(json.dumps({'exit':p.returncode,'stdout':lines,'stderr':errors},indent=2))
 assert p.returncode==0,errors
