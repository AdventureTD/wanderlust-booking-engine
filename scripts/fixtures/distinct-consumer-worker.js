function worker(db, hook = async () => {}) {
  const trace = [], context = vm.createContext({Buffer}), cache = new Map();
  const realm = value => vm.runInContext('(' + JSON.stringify(value) + ')', context);
  const wix = {
    query(collection) {
      const predicates = []; let limit = 100, sort = false;
      const q = {
        eq(key, value) { predicates.push([key, value, false]); return q; },
        gt(key, value) { predicates.push([key, value, true]); return q; },
        limit(value) { limit = value; return q; },
        ascending(key) { assert.equal(key, '_id'); sort = true; return q; },
        async find(options) {
          assert.deepEqual(JSON.parse(JSON.stringify(options)), {suppressAuth:true, suppressHooks:true, consistentRead:true});
          trace.push({op:'find', collection, predicates:structuredClone(predicates), limit});
          const override = await hook({phase:'find', collection, predicates, db, trace});
          let rows = override?.rows || (db.rows[collection] || []).filter(row => predicates.every(([key, value, gt]) => gt ? row[key] > value : row[key] === value));
          if (sort) rows = rows.slice().sort((a,b) => a._id < b._id ? -1 : a._id > b._id ? 1 : 0);
          if (override?.page) return override.page;
          return {items:override?.nativeRows || realm(rows.slice(0,limit)), hasNext(){return rows.length > limit;}};
        }
      }; return q;
    },
    async insert(collection, value, options) {
      trace.push({op:'insert', collection, id:value._id});
      assert.equal(collection, JOURNAL, 'all booking and Admin writes forbidden');
      assert.deepEqual(JSON.parse(JSON.stringify(options)), {suppressAuth:true, suppressHooks:true});
      await hook({phase:'input', collection, input:value, db, trace});
      const row = JSON.parse(JSON.stringify(value));
      await hook({phase:'beforeInsert', collection, row, db, trace});
      db.rows[collection] ||= [];
      if (db.rows[collection].some(r => r._id === row._id)) throw Error('duplicate');
      db.rows[collection].push(structuredClone(row));
      await hook({phase:'afterInsert', collection, row, db, trace});
      trace.push({op:'insertAck', collection, id:row._id});
      return realm(row);
    }
  };
  const sdk = {
    'wix-data': {default:wix}, 'wix-auth': {elevate:f=>f}, buffer:{Buffer},
    crypto:{...crypto, randomBytes(){trace.push({op:'rng'}); throw Error('RNG forbidden');}},
    'wix-secrets-backend.v2': {secrets:{async getSecretValue(name) {
      trace.push({op:'secret', name}); assert.equal(name, 'WBE_GUEST_BOOKING_KEYS');
      if (db.secretFailure) throw Error('unavailable'); return realm({value:JSON.stringify(db.keys)});
    }}}
  };
  sdk.crypto.default = sdk.crypto;
  async function load(name) {
    if (cache.has(name)) return cache.get(name);
    let mod;
    if (Object.hasOwn(sdk, name)) {
      const values = sdk[name];
      mod = new vm.SyntheticModule(Object.keys(values), function(){for (const [k,v] of Object.entries(values)) this.setExport(k,v);}, {context, identifier:name});
    } else {
      assert.match(name, /^backend\/[A-Za-z0-9]+$/);
      const file = 'velo/' + name + '.js';
      assert.ok(Object.hasOwn(pins,file) || Object.hasOwn(readerPins,file) || ['backend/guestBookingInvoiceIssuance','backend/guestBookingInvoiceDelivery'].includes(name), 'closed module ' + name);
      mod = new vm.SourceTextModule(fs.readFileSync(path.join(ROOT,file),'utf8'), {context, identifier:name});
    }
    cache.set(name,mod); return mod;
  }
  async function api(name) {const mod = await load(name); if (mod.status === 'unlinked') await mod.link(spec=>load(spec)); if (mod.status === 'linked') await mod.evaluate(); return mod.namespace;}
  return {api, trace};
}
