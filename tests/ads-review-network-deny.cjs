'use strict';
const assert=require('node:assert/strict');let calls=0;
const deny=()=>{calls++;throw Error('OFFLINE_NETWORK_DENIED');};
global.fetch=deny;global.WebSocket=deny;for(const name of ['http','https']){require(name).request=deny;require(name).get=deny;}require('net').connect=deny;require('net').createConnection=deny;require('net').Socket.prototype.connect=deny;require('tls').connect=deny;
process.on('exit',()=>{assert.equal(calls,0,'unexpected network attempts');console.error('OFFLINE_NETWORK_ATTEMPTS='+calls);});
