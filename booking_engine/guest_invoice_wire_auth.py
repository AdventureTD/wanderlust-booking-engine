"""NEW prospective guest wire crypto only, not Render/legacy API compatibility.

No environment, SDK, handler, network, dispatcher or retained authority imports.
Internal service code is trusted; these primitives confer no booking authority.
"""
import hashlib
import hmac
import json
import base64
import os
import re
import time
import weakref

# Private injection seams, inert until separately integrated and reviewed.
_enabled = lambda: False
_now = lambda: time.time_ns() // 1000000


def _read_configuration():
    raise ValueError('guest_invoice_transport_unavailable')


_RENDER = 'https://wanderlust-invoice-service.onrender.com'
_DISPATCH = '/private/guest-invoice/v1/dispatch'
_JOURNAL = '/_functions/guestInvoiceJournal'
_HEX = re.compile(r'[a-f0-9]{64}')
_KID = re.compile(r'[A-Za-z0-9_-]{1,32}')
_bindings = weakref.WeakKeyDictionary()
_outstanding = weakref.WeakKeyDictionary()


class _Handle:
    __slots__ = ('__weakref__',)


def _need(ok):
    if not ok:
        raise ValueError('guest_invoice_transport_unavailable')


def _matches(pattern, value):
    return type(value) is str and re.fullmatch(pattern, value) is not None


def _integer(value):
    return type(value) is int and 0 <= value <= 9007199254740991


def _shape(value, names):
    _need(type(value) is dict and list(value) == names)
    return value


def _bytes(value, cap):
    _need(type(value) in (bytes, bytearray) and 0 < len(value) <= cap)
    return bytes(value)


def _json(raw, ascii_only=False):
    if ascii_only:
        _need(raw.isascii())
    try:
        value = json.loads(raw.decode('utf-8'))
        _need(wire_json(value) == raw)
        return value
    except (UnicodeError, ValueError, RecursionError) as exc:
        raise ValueError('guest_invoice_transport_unavailable') from exc


def _headers(rows, length, request=True):
    # Require the observable pair representation BEFORE any dict flattening.
    _need(type(rows) in (list, tuple))
    protected = {'content-type', 'content-length', 'content-encoding',
                 'x-wbe-gi-kid', 'x-wbe-gi-time', 'x-wbe-gi-request', 'x-wbe-gi-mac'}
    values = {}
    for row in rows:
        _need(type(row) in (list, tuple) and len(row) == 2)
        name, value = row
        if type(name) is bytes:
            try:
                name = name.decode('ascii')
            except UnicodeError as exc:
                raise ValueError('guest_invoice_transport_unavailable') from exc
        _need(type(name) is str)
        name = name.lower()
        if name not in protected:
            continue
        _need(name not in values)
        if type(value) is bytes:
            try:
                value = value.decode('ascii')
            except UnicodeError as exc:
                raise ValueError('guest_invoice_transport_unavailable') from exc
        _need(type(value) is str)
        values[name] = value
    _need(values.get('content-type') == 'application/json' and 'content-encoding' not in values)
    _need('content-length' not in values or values['content-length'] == str(length))
    _need(_matches(_KID, values.get('x-wbe-gi-kid')))
    for name in ('x-wbe-gi-request', 'x-wbe-gi-mac'):
        _need(_matches(_HEX, values.get(name)))
    if request:
        stamp = values.get('x-wbe-gi-time')
        _need(_matches(r'0|[1-9][0-9]{0,15}', stamp) and _integer(int(stamp)))
    return values


def _configuration():
    _need(_enabled() is True)
    c = _shape(_read_configuration(), ['siteOrigin', 'audience', 'channel'])
    site, audience = c['siteOrigin'], c['audience']
    _need(_matches(r'https://[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?', site))
    _need(_matches(r'[A-Za-z0-9][A-Za-z0-9._:-]{0,127}', audience))
    ring = _shape(c['channel'], ['activeKid', 'keys'])
    _need(_matches(_KID, ring['activeKid']) and type(ring['keys']) is list and 1 <= len(ring['keys']) <= 2)
    keys = {}
    for row in ring['keys']:
        _shape(row, ['kid', 'keyHex'])
        kid, key = row['kid'], row['keyHex']
        _need(_matches(_KID, kid) and _matches(_HEX, key) and kid not in keys)
        keys[kid] = key
    _need(ring['activeKid'] in keys)
    return dict(siteOrigin=site, audience=audience, activeKid=ring['activeKid'], keys=keys)


def _clock(claims):
    now = _now()
    _need(_integer(now) and claims[10] <= now + 30000 and now < claims[11])
    return now


def _scope(wire, config):
    _need(type(wire) is str and len(wire) <= 4096)
    match = re.fullmatch(r'wgis1\.([A-Za-z0-9_-]{1,32})\.([A-Za-z0-9_-]+)\.([a-f0-9]{64})', wire)
    _need(match is not None)
    encoded = match[2]
    try:
        raw = base64.b64decode(encoded + '=' * (-len(encoded) % 4), altchars=b'-_', validate=True)
    except ValueError as exc:
        raise ValueError('guest_invoice_transport_unavailable') from exc
    _need(base64.urlsafe_b64encode(raw).decode().rstrip('=') == encoded)
    c = _json(raw, True)
    _need(type(c) is list and len(c) == 12)
    _need(type(c[0]) is int and c[:3] == [1, 'guest-invoice-service', 'initial'])
    _need(c[3] == config['siteOrigin'] and c[4] == config['audience'])
    _need(all(_matches(_HEX, x) for x in c[5:10]))
    _need(c[5] == digest(('wbe.acceptance-id.v2\0' + c[6]).encode()))
    _need(_integer(c[10]) and _integer(c[11]) and c[11] - c[10] == 900000)
    _clock(c)
    # Channel-authenticated claims only: Python NEVER has Wix scope seal keys.
    return tuple(c)


def _fence(entry):
    fresh = _configuration()
    _need(fresh['siteOrigin'] == entry['siteOrigin'] and fresh['audience'] == entry['audience'])
    _need(fresh['keys'].get(entry['kid']) == entry['key'])
    _need(_enabled() is True)
    return _clock(entry['claims'])


def authenticate_dispatch(original_bytes, headers, method, path):
    """Capture only channel-authenticated claims; NOT retained Wix authority."""
    _need(_enabled() is True and method == 'POST' and path == _DISPATCH)
    raw = _bytes(original_bytes, 8192)
    h = _headers(headers, len(raw))
    config = _configuration()
    kid = h['x-wbe-gi-kid']
    _need(kid in config['keys'])
    now = _now()
    _need(_integer(now) and abs(now - int(h['x-wbe-gi-time'])) <= 60000)
    meta = dict(direction='wix-to-render', destinationOrigin=_RENDER, path=_DISPATCH,
                kid=kid, time=h['x-wbe-gi-time'], requestId=h['x-wbe-gi-request'])
    _need(hmac.compare_digest(h['x-wbe-gi-mac'], request_mac(meta, raw, config['keys'][kid])))
    body = _shape(_json(raw, True), ['protocol', 'scope'])
    _need(body['protocol'] == 'guest-invoice-dispatch/v1')
    claims = _scope(body['scope'], config)
    entry = dict(siteOrigin=config['siteOrigin'], audience=config['audience'],
                 kid=kid, key=config['keys'][kid], claims=claims, scope=body['scope'],
                 started=False, pending=None)
    _fence(entry)
    handle = _Handle()
    _bindings[handle] = entry
    return handle


def begin_journal(binding, operation, payload):
    """Prepare disconnected journal bytes; no transport or authority IO.

    Artifact/ACK payloads and observations confer no retained authority or grant.
    Not a dispatcher adapter; the actual journal/consumer remain mandatory.
    """
    _need(type(binding) is _Handle and binding in _bindings)
    entry = _bindings[binding]
    _need(operation in ('readIssuance', 'commitArtifact', 'tryStart', 'recordAck') and entry['pending'] is None)
    if operation == 'readIssuance':
        p = dict(_shape(payload, []))
    elif operation == 'commitArtifact':
        p = dict(_shape(payload, ['encoded', 'mimeDigest', 'pdfDigest', 'rendererVersion']))
        _need(all(type(v) is str for v in p.values()))
        _need(all(_matches(_HEX, p[k]) for k in ('mimeDigest', 'pdfDigest')))
        _need(0 < len(p['encoded']) <= 397808)
        try:
            decoded = base64.b64decode(p['encoded'], validate=True)
        except ValueError as exc:
            raise ValueError('guest_invoice_transport_unavailable') from exc
        _need(bool(decoded) and base64.b64encode(decoded).decode() == p['encoded'])
        _need(digest(decoded) == p['mimeDigest'])
        _need(p['rendererVersion'] in ('word', 'reportlab', 'reportlab-fallback'))
    elif operation == 'recordAck':
        p = dict(_shape(payload, ['artifactDigest', 'invocationNonce', 'providerMessageId']))
        _need(all(_matches(_HEX, p[k]) for k in ('artifactDigest', 'invocationNonce')))
        _need(_matches(r'[A-Za-z0-9_-]{1,256}', p['providerMessageId']))
    else:
        _need(not entry['started'])
        p = dict(_shape(payload, ['artifactDigest', 'invocationNonce']))
        _need(all(_matches(_HEX, x) for x in p.values()))
    raw = wire_json(dict(protocol='guest-invoice-journal/v1', scope=entry['scope'], operation=operation, payload=p))
    _bytes(raw, 450000)
    request_id = os.urandom(32).hex()
    _need(request_id != p.get('invocationNonce'))
    stamp = str(_fence(entry))
    meta = dict(direction='render-to-wix', destinationOrigin=entry['siteOrigin'], path=_JOURNAL,
                kid=entry['kid'], time=stamp, requestId=request_id)
    headers = {'Content-Type': 'application/json', 'X-WBE-GI-Kid': entry['kid'],
               'X-WBE-GI-Time': stamp, 'X-WBE-GI-Request': request_id,
               'X-WBE-GI-Mac': request_mac(meta, raw, entry['key'])}
    handle = _Handle()
    _outstanding[handle] = dict(binding=binding, meta=meta, requestDigest=digest(raw), payload=p, operation=operation)
    # Preparing a START spends this invocation even if downstream submission fails.
    if operation == 'tryStart':
        entry['started'] = True
    entry['pending'] = handle
    return handle, raw, headers


def _rich_state(result, claims):
    """Wire observation only; never retained authority or a provider grant.

    The separate actual delivery consumer must still verify projection, financial,
    recipient, issuance/stage/artifact keys and parsed MIME/PDF semantics. Do not
    connect this parser directly to provider preparation or bypass that consumer.
    """
    _shape(result, ['status', 'root', 'payments', 'artifact', 'start', 'ack'])
    root = _shape(result['root'], ['_id', 'schemaVersion', 'kind', 'revision', 'audience',
        'acceptanceId', 'operationId', 'rootDigest', 'receiptId', 'projectionDigest',
        'financialDigest', 'recipientBindingDigest', 'projectionCanonical', 'to', 'cc', 'from'])
    _need(type(root['schemaVersion']) is int and root['schemaVersion'] == 1)
    _need(root['kind'] == 'INITIAL_ISSUANCE' and root['revision'] == 'initial')
    _need(all(type(v) is str for k, v in root.items() if k != 'schemaVersion'))
    _need(all(_matches(_HEX, root[k]) for k in ('_id', 'acceptanceId', 'operationId',
        'rootDigest', 'projectionDigest', 'financialDigest', 'recipientBindingDigest')))
    for name, index in (('audience', 4), ('acceptanceId', 5), ('operationId', 6),
                        ('rootDigest', 7), ('_id', 8)):
        _need(root[name] == claims[index])
    _need(root['receiptId'] == 'gbc1-' + claims[5])
    _need(type(result['payments']) is list and result['payments'] == [])
    stage_fields = {
        'artifact': ['_id', 'kind', 'issuanceId', 'documentDigest', 'encoded', 'mimeDigest',
                     'pdfDigest', 'rendererVersion', 'artifactDigest'],
        'start': ['_id', 'kind', 'issuanceId', 'documentDigest', 'artifactDigest', 'invocationNonce'],
        'ack': ['_id', 'kind', 'issuanceId', 'documentDigest', 'artifactDigest', 'invocationNonce', 'providerMessageId']}
    for name, fields in stage_fields.items():
        stage = result[name]
        if stage is None:
            continue
        _shape(stage, fields)
        _need(all(type(v) is str for v in stage.values()))
        _need(stage['kind'] == {'artifact': 'PREPARED', 'start': 'START', 'ack': 'ACK'}[name])
        _need(stage['issuanceId'] == root['_id'] and stage['documentDigest'] == root['projectionDigest'])
        _need(all(_matches(_HEX, stage[k]) for k in ('_id', 'issuanceId', 'documentDigest',
            'artifactDigest', 'mimeDigest', 'pdfDigest', 'invocationNonce') if k in stage))
        if name == 'artifact':
            _need(0 < len(stage['encoded']) <= 397808)
            try:
                raw = base64.b64decode(stage['encoded'], validate=True)
            except ValueError as exc:
                raise ValueError('guest_invoice_transport_unavailable') from exc
            _need(bool(raw) and base64.b64encode(raw).decode() == stage['encoded'])
            _need(digest(raw) == stage['mimeDigest'])
            _need(stage['rendererVersion'] in ('word', 'reportlab', 'reportlab-fallback'))
        if name == 'ack':
            _need(_matches(r'[A-Za-z0-9_-]{1,256}', stage['providerMessageId']))
    artifact, start, ack = result['artifact'], result['start'], result['ack']
    if start is not None:
        _need(artifact is not None and start['artifactDigest'] == artifact['artifactDigest'])
    if ack is not None:
        _need(start is not None and ack['artifactDigest'] == start['artifactDigest']
              and ack['invocationNonce'] == start['invocationNonce'])
    _need(result['status'] == ('PROVIDER_ACCEPTED' if ack is not None else
                              'OWNER_REVIEW_REQUIRED' if start is not None else 'READY'))
    return result


def consume_response(outstanding, status, original_bytes, headers):
    """Consume exactly one outstanding attempt, including malformed responses."""
    _need(type(outstanding) is _Handle and outstanding in _outstanding)
    request = _outstanding.pop(outstanding)
    entry = _bindings[request['binding']]
    _need(entry['pending'] is outstanding)
    entry['pending'] = None
    raw = _bytes(original_bytes, 900000)
    _need(type(status) is int and status == 200)
    h = _headers(headers, len(raw), False)
    _need(h['x-wbe-gi-kid'] == entry['kid'] and h['x-wbe-gi-request'] == request['meta']['requestId'])
    _need(hmac.compare_digest(h['x-wbe-gi-mac'], response_mac(request['meta'], request['requestDigest'], status, raw, entry['key'])))
    body = _shape(_json(raw), ['protocol', 'result'])
    _need(body['protocol'] == 'guest-invoice-journal/v1')
    result = body['result']
    _need(type(result) is dict)
    if 'won' in result:
        _need(request['operation'] == 'tryStart')
        _shape(result, ['won', 'invocationNonce', 'artifactDigest'])
        _need(result['won'] is True and result['invocationNonce'] == request['payload']['invocationNonce']
              and result['artifactDigest'] == request['payload']['artifactDigest'])
    elif 'root' in result:
        _need(request['operation'] in ('readIssuance', 'commitArtifact', 'recordAck'))
        _rich_state(result, entry['claims'])
        if request['operation'] == 'commitArtifact':
            _need(result['artifact'] is not None)
            # Advanced current state is returned before commit comparison by the
            # journal. It is only an observation, never a START/send grant.
            if result['start'] is None:
                _need(all(result['artifact'][k] == v for k, v in request['payload'].items()))
        elif request['operation'] == 'recordAck':
            _need(result['ack'] is not None)
            _need(all(result['ack'][k] == v for k, v in request['payload'].items()))
    else:
        _shape(result, ['status'])
        _need(result['status'] in ('DENIED', 'UNAVAILABLE', 'OWNER_REVIEW_REQUIRED'))
    _fence(entry)
    return result


def wire_json(value):
    """Corrected D2 codec: Unicode scalars literal, lone surrogates escaped."""
    def encode(v):
        if v is None:
            return 'null'
        if type(v) is bool:
            return 'true' if v else 'false'
        if type(v) is int and 0 <= v <= 9007199254740991:
            return str(v)
        if type(v) is str:
            scalar = v.encode('utf-16-le', 'surrogatepass').decode('utf-16-le', 'surrogatepass')
            text = json.dumps(scalar, ensure_ascii=False)
            return ''.join('\\u%04x' % ord(c) if 0xD800 <= ord(c) <= 0xDFFF else c for c in text)
        if type(v) is list:
            return '[' + ','.join(encode(x) for x in v) + ']'
        if type(v) is dict and all(type(k) is str for k in v):
            return '{' + ','.join(encode(k) + ':' + encode(x) for k, x in v.items()) + '}'
        raise ValueError('guest_invoice_transport_unavailable')
    return encode(value).encode('utf-8')


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def _mac(key, raw):
    return hmac.new(bytes.fromhex(key), raw, hashlib.sha256).hexdigest()


def request_mac(meta, raw, key):
    return _mac(key, wire_json(['wbe.guest-invoice.http.v1', meta['direction'], meta['kid'], 'POST', meta['destinationOrigin'], meta['path'], meta['time'], meta['requestId'], digest(raw)]))


def response_mac(meta, request_digest, status, raw, key):
    return _mac(key, wire_json(['wbe.guest-invoice.response.v1', meta['direction'] + '-response', meta['kid'], meta['destinationOrigin'], meta['path'], meta['requestId'], request_digest, status, digest(raw)]))
