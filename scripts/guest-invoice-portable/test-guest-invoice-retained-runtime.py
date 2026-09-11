"""Fresh producer, production scope mint, both actual HTTP handlers. All sockets denied."""
import base64, io, json, os, queue, shutil, socket, subprocess, sys, threading
from pathlib import Path
from unittest.mock import patch
from email import policy
from email.parser import BytesParser
ROOT=Path(__file__).resolve().parents[2]
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
p=subprocess.Popen(['node','--experimental-vm-modules',str(Path(__file__).with_name('guest-invoice-retained-bridge.cjs')),str(OUT),CASE],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
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
 dispatch=read();assert dispatch['kind']=='dispatch';(OUT/'production-dispatch.json').write_text(json.dumps(dispatch,indent=2))
 claims=json.loads(base64.urlsafe_b64decode(json.loads(base64.b64decode(dispatch['bytes']))['scope'].split('.')[2]+'=='))
 config={'WBE_GUEST_INVOICE_ENABLED':'true','WBE_GUEST_INVOICE_SITE_ORIGIN':claims[3],'WBE_GUEST_INVOICE_AUDIENCE':claims[4],
 'WBE_GUEST_INVOICE_CHANNEL_KEYS':json.dumps({'activeKid':'local','keys':[{'kid':'local','keyHex':'11'*32}]},separators=(',',':')),
 'WBE_INVOICE_RENDERER':'word','WBE_INVOICE_REPORTLAB_FALLBACK':'0','LIBREOFFICE_PATH':os.environ.get('LIBREOFFICE_PATH') or shutil.which('soffice') or shutil.which('libreoffice') or ''}
 import types
 with patch.dict(os.environ,config),patch.object(auth,'_now',lambda:dispatch['now']),patch.object(socket.socket,'connect',guarded_connect),patch.object(socket.socket,'connect_ex',denied),patch.object(socket,'create_connection',denied),patch.object(requests.adapters.HTTPAdapter,'send',adapter_send),patch.object(delivery.gmail_sender,'prepare_journal_token',lambda:'inert-token'),patch.object(delivery.gmail_sender,'send_journal_mime',send),patch.object(delivery,'render_invoice_pdf_for_service',render),patch.object(word,'subprocess',types.SimpleNamespace(run=observed_run)):
  client=TestClient(invoice_service.app) # no lifespan: unrelated jobs must not start
  raw=base64.b64decode(dispatch['bytes'])
  result=client.post('/private/guest-invoice/v1/dispatch',content=raw,headers=dispatch['headers'])
  (OUT/'first-result.json').write_text(json.dumps({'http':result.status_code,'body':result.json(),'journal':journal,'native':native},indent=2))
  assert result.status_code==200
  write(dict(kind='dispatch-result',status=result.status_code,body=result.text))
  done=read();assert done['kind']=='done',done
  # Reconstructed authenticated binding from exact original request; retained START only observation.
  replay=client.post('/private/guest-invoice/v1/dispatch',content=raw,headers=dispatch['headers'])
  write({'kind':'snapshot'});snapshot=read()
  expected='OWNER_REVIEW_REQUIRED' if CASE in ('start-loss','provider-loss','journal-start-loss') else 'PROVIDER_ACCEPTED'
  summary=dict(case=CASE,result=result.json(),replay=replay.json(),done=done,journal=journal,providerCalls=len(sent),rendered=rendered,native=native)
  (OUT/'result.json').write_text(json.dumps(summary,indent=2))
  (OUT/'snapshot.json').write_text(json.dumps(snapshot,indent=2))
  assert result.json()['status']==replay.json()['status']==expected,summary
  assert len(sent)==(0 if CASE in ('start-loss','journal-start-loss') else 1)
  assert len(rendered)==1
  prepared=next(x for x in snapshot['rows'] if x['kind']=='PREPARED')
  mime=base64.b64decode(prepared['encoded']);message=BytesParser(policy=policy.default).parsebytes(mime)
  attachment,=message.iter_attachments();assert attachment.get_payload(decode=True)==(OUT/'invoice.pdf').read_bytes()
  if sent:assert mime==sent[0]
  print(json.dumps({'case':CASE,'status':'PASS','result':expected,'providerCalls':len(sent),'stages':done['stages']}))
finally:
 try:write({'kind':'close'});p.stdin.close();p.wait(timeout=10)
 except Exception:p.kill();p.wait(timeout=5)
 (OUT/'native-child.json').write_text(json.dumps({'exit':p.returncode,'stdout':lines,'stderr':errors},indent=2))
 assert p.returncode==0,errors
