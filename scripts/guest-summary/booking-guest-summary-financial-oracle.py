"""Finite independent Decimal oracle; original quote untouched, inert revision only."""
from pathlib import Path
from decimal import Decimal as D, ROUND_HALF_UP
import json, hashlib, subprocess
CP = Path(__file__).parent
V = json.loads((CP/'booking-guest-offer-public-vector.json').read_text())
revision = json.loads(V['revisionRow']['revisionBytes'])
# Away from half-cent binary ties: 200*.05003=10.006, 400*.05003=20.012.
revision['propertyFeeRate'] = 0.05003
revision_bytes = json.dumps(revision, separators=(',', ':'))
revision_digest = hashlib.sha256(('wbe.financial-revision.v1\x00'+revision_bytes).encode()).hexdigest()
def oracle(groups):
    def money(x): return x.quantize(D('.01'), rounding=ROUND_HALF_UP)
    keys = ['grossCents','discountCents','roomTotalCents','propertyFeeCents','accommodationVatCents','packageVatCents','grandTotalCents']
    rows=[]
    for index, g in enumerate(groups):
        fee = D('10.005') if g['roomCode']=='penthouse_apartment' else D(0)
        gross=money((D(100)*g['guests']+fee*4)*g['quantity'])
        net=gross; discount=D(0)
        pf=money(net*D('.05003')); av=money(net*D('.5')*D('.1')); pv=money(net*D('.5')*D('.15'))
        vals=[gross,discount,net,pf,av,pv,money(net+pf+av+pv)]
        rows.append(dict(index=index,**g,**{k:int(v*100) for k,v in zip(keys,vals)}))
    totals={k:sum(g[k] for g in rows) for k in keys}
    totals.update(totalVatCents=totals['accommodationVatCents']+totals['packageVatCents'],totalRooms=sum(g['quantity'] for g in groups),totalGuests=sum(g['quantity']*g['guests'] for g in groups))
    return dict(v=1,currency='USD',rounding='original-group-backend-v1',groups=rows,totals=totals)
suite=dict(roomCode='adventure_suite',quantity=1,guests=2)
penthouse=dict(roomCode='penthouse_apartment',quantity=1,guests=2)
cases=[dict(id='F01',groups=[suite,penthouse,suite]),dict(id='F02',groups=[dict(suite,quantity=2),penthouse]),dict(id='F03',groups=[penthouse,suite,suite])]
for c in cases: c['expected']=oracle(c['groups'])
assert cases[0]['expected']['totals']['grandTotalCents']-cases[1]['expected']['totals']['grandTotalCents']==1
assert cases[0]['expected']['totals']==cases[2]['expected']['totals']
payload=dict(revisionBytes=revision_bytes,revisionDigest=revision_digest,cases=cases)
# Immutable expected vectors: reproduce independently without rewriting reviewed bytes.
assert json.loads((CP/'booking-guest-summary-financial-oracle-vectors.json').read_text()) == payload
# No-selector invocation must not dispatch a backend case.
import sys
assert len(sys.argv) == 2 and sys.argv[1] in ['vectors', 'F01', 'F02', 'F03'], 'Explicit vectors/F01/F02/F03 selector required'
if sys.argv[1] == 'vectors':
    print('PASS Decimal vectors only; backend dispatch=0; COMPLETE 3')
    raise SystemExit(0)
cases = [c for c in cases if c['id'] == sys.argv[1]]
results=[]
for c in cases:
    command=['node',str(CP/'booking-guest-summary-financial-oracle.cjs'),c['id']]
    p=subprocess.run(command,capture_output=True,text=True,timeout=15)
    results.append(dict(case=c['id'],command=command,exit=p.returncode,stdout=p.stdout,stderr=p.stderr))
    print(json.dumps(results[-1]))
assert len(results)==1 and all(r['exit']==0 and r['stderr']=='' for r in results)
print('PASS independent Decimal selected '+sys.argv[1]+'; COMPLETE 1')
