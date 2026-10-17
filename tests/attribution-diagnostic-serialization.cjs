'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),path=require('path');
const root=path.resolve(__dirname,'..');
const worker=fs.readFileSync(root+'/velo/public/clickAttribution.js','utf8');
const head=fs.readFileSync(root+'/velo/custom-code/google-tag-and-consent.source.html','utf8');
const summary=fs.readFileSync(root+'/velo/page-booking-summary.js','utf8');
// Anchored extraction: a missing anchor must fail loudly (indexOf -1 once yielded an empty slice).
const cut=(s,a,b)=>{const i=s.indexOf(a),j=s.indexOf(b,i);assert.ok(i>=0&&j>i,'anchor '+a);return s.slice(i,j);};
const cases=[['worker',cut(worker,'const diagnosticSeen','function cancelReadiness')+"diagnostic('policy','TIMEOUT');"],['head',cut(head,'var M = [];','var N = new WeakMap')+'D(0);' /* 1f82359 renamed ds/ad/states to M/D/N */],['summary',cut(summary,'const attributionDiagnostic =','let googleConversionPromise =')+"attributionDiagnostic('RPC_INVOKED');"]];
for(const [name,source] of cases){let attempts=0,logs=0;vm.runInNewContext(source,{JSON:{stringify(){attempts++;throw Error('PRIVATE_SERIALIZATION');}},console:{log(){logs++;}}});assert.equal(attempts,1);assert.equal(logs,0);console.log('PASS serialization failure contained: '+name);}
