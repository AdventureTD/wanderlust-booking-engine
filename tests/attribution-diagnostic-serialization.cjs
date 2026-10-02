'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),path=require('path');
const root=path.resolve(__dirname,'..');
const worker=fs.readFileSync(root+'/velo/public/clickAttribution.js','utf8');
const head=fs.readFileSync(root+'/velo/custom-code/google-tag-and-consent.source.html','utf8');
const summary=fs.readFileSync(root+'/velo/page-booking-summary.js','utf8');
const cases=[['worker',worker.slice(worker.indexOf('const diagnosticSeen'),worker.indexOf('function cancelReadiness'))+"diagnostic('policy','TIMEOUT');"],['head',head.slice(head.indexOf('var ds = []'),head.indexOf('var states = new WeakMap'))+'ad(0);'],['summary',summary.slice(summary.indexOf('const attributionDiagnostic ='),summary.indexOf('let googleConversionPromise ='))+"attributionDiagnostic('RPC_INVOKED');"]];
for(const [name,source] of cases){let attempts=0,logs=0;vm.runInNewContext(source,{JSON:{stringify(){attempts++;throw Error('PRIVATE_SERIALIZATION');}},console:{log(){logs++;}}});assert.equal(attempts,1);assert.equal(logs,0);console.log('PASS serialization failure contained: '+name);}
