"""Read-only fresh-run evidence audit. Not producer authority or independent review."""
import argparse, base64, hashlib, json, subprocess
from pathlib import Path
from email import policy
from email.parser import BytesParser
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
def sha(b): return hashlib.sha256(b).hexdigest()
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--run',type=Path,required=True)
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args()
subprocess.run(['node',str(HERE/'custody.cjs')],cwd=ROOT,check=True)
D=args.run.resolve();output=args.output.resolve()
if output.exists(): raise FileExistsError(output)
if D == output or D in output.parents: raise ValueError('audit output must be outside the producer run')
inputs=['fresh-native.json','extended-controls.json','native-child.json','result.json','provider-1.eml','provider-2.eml','invoice-1.pdf','invoice-2.pdf']
before={name:sha((D/name).read_bytes()) for name in inputs}
d=json.loads((D/'fresh-native.json').read_text());db=d['db'];receipts=db['GuestBookingCompletions'];assert len(receipts)==2
assert len({r['acceptanceId'] for r in receipts})==2
assert len([r for r in d['rows'] if r['kind']=='ACK'])==2
assert len([r for r in d['calendarRows'] if r['kind']=='ACK'])==2
subjects=[]
for r in receipts:
 a=next(a for a in db['GuestBookingAcceptances'] if a['_id']==r['acceptanceId']);capsule=json.loads(a['capsule']);s=json.loads(r['projectionCanonical'])['summary']
 assert s['acceptedCalculation']==capsule['calculation'];assert sum(g['guests'] for g in capsule['calculation']['groups'])==s['totalGuests']
 inp=json.loads(capsule['inputCanonical']);assert inp[2:4]==[s['checkIn'],s['checkOut']]
 for row in json.loads(r['bookingRowsCanonical']):
  stored=next(x for x in db['Bookings'] if x['_id']==row['_id'])
  assert all(stored[k]==(v+'T12:00:00.000Z' if k in ['checkIn','checkOut'] else v) for k,v in row.items())
 summary=json.loads(r['summaryCanonical']);stored=next(x for x in db['BookingSummary'] if x['_id']==r['summaryId'])
 assert all(stored[k]==(v+'T12:00:00.000Z' if k in ['checkIn','checkOut'] else v) for k,v in summary.items())
 issue=next(x for x in d['rows'] if x['kind']=='INITIAL_ISSUANCE' and x['acceptanceId']==r['acceptanceId'])
 assert issue['projectionCanonical']==r['projectionCanonical'] and issue['receiptId']==r['_id'] and issue['financialDigest']==r['financialDigest']
 desired=next(json.loads(x['canonical']) for x in d['calendarRows'] if x['kind']=='DESIRED' and json.loads(x['canonical'])['acceptanceId']==r['acceptanceId'])['resource']
 assert desired['start']['date']==s['checkIn'] and desired['end']['date']==s['checkOut'] and desired['summary']=='Wanderlust Caribbean Booking: '+s['guestName']
 assert sum(json.loads(x['options']['payload'])==desired for x in d['provider'] if x['options']['method']=='post')==1
 subjects.append({'acceptanceId':r['acceptanceId'],'receiptId':r['_id'],'bookingDate':summary['bookingDate']})
artifacts=[]
for i,row in enumerate([x for x in d['rows'] if x['kind']=='PREPARED'],1):
 mime=(D/f'provider-{i}.eml').read_bytes();pdf=(D/f'invoice-{i}.pdf').read_bytes();assert base64.b64decode(row['encoded'])==mime
 att,=BytesParser(policy=policy.default).parsebytes(mime).iter_attachments();assert att.get_payload(decode=True)==pdf and pdf.startswith(b'%PDF')
 artifacts.append({'pdfSHA256':sha(pdf),'mimeSHA256':sha(mime),'pdfBytes':len(pdf)})
controls=json.loads((D/'extended-controls.json').read_text());assert controls['searches']==[3,1,0] and controls['pollWrites']==0 and controls['nativeDates'] and controls['retainedRowsUnchanged']
assert len(controls['controls'])==4 and all(x['status']=='INTEGRITY' and x['hits']==1 for x in controls['controls'])
child=json.loads((D/'native-child.json').read_text());native=json.loads((D/'result.json').read_text());assert child['exit']==0 and len(native['native'])==2 and all(x['exit']==0 for x in native['native'])
report={'subjects':subjects,'artifacts':artifacts,'controls':controls,'childExit':0,'wordExits':[x['exit'] for x in native['native']]}

assert len(artifacts)==2
assert native['providerCalls']==2 and native['done']['calendarACK']==2
assert {x['mode'] for x in controls['controls']}=={'nonnoon','invalid-native','timestamp-string','mismatched-receipt'}
assert before=={name:sha((D/name).read_bytes()) for name in inputs},'input changed during audit'
report.update(status='PASS',authorAuditNotIndependentReview=True,inputSHA256=before,sourceManifestSHA256=sha((HERE/'pins.json').read_bytes()),scope='fresh actual producer; Word; inert invoice and Calendar only')
with output.open('x',encoding='utf8') as handle: json.dump(report,handle,indent=2)
print(json.dumps({'status':'PASS','subjects':len(subjects),'artifacts':len(artifacts),'searches':controls['searches'],'pollWrites':controls['pollWrites']}))
