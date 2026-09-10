"""Independent byte/cryptographic review only; never invokes backend or generator."""
import base64
import hashlib
import hmac
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
ARCHIVE = HERE / 'provenance'

def digest(data):
    return hashlib.sha256(data).hexdigest()

def b64(data):
    return base64.urlsafe_b64encode(data).decode('ascii').rstrip('=')

def decode(text):
    data = base64.urlsafe_b64decode(text + '=' * (-len(text) % 4))
    assert b64(data) == text, 'noncanonical base64url'
    return data

def read(path):
    return json.loads(path.read_bytes())

def main():
    custody = read(ARCHIVE / 'custody-before.json')
    artifacts = read(ARCHIVE / 'artifact-manifest.json')['artifacts']
    for name in ['new-vector-generator.cjs', 'new-vector-generator-initial.cjs',
                 'independent-python-oracle.json', 'new-vector-generation-corrected-native.json',
                 'new-vector-generation-native.json', 'source-admission.md',
                 'source-admission-amendment.json', 'S13-preexecution-freeze.json',
                 'S13-new-vector-native.json']:
        assert digest((ARCHIVE / name).read_bytes()) == artifacts[name], name
    generator = (ARCHIVE / 'new-vector-generator.cjs').read_bytes()
    amendment = read(ARCHIVE / 'source-admission-amendment.json')
    assert digest(generator) == amendment['generatorSha256']
    for name in custody['issuerGraph']:
        data = (ROOT / name).read_bytes().replace(b'\r\n', b'\n')
        assert digest(data) == custody['graph'][name]['canonical'], name
    fixture_bytes = (ROOT / 'scripts/fixtures/completion-authority-history.json').read_bytes()
    f = json.loads(fixture_bytes)
    r = next(x for x in f['db']['rows']['GuestBookingAcceptances'] if x['_id'] == f['expected']['acceptanceId'])
    offer = json.loads(r['capsule'])
    original_quote = json.loads(offer['inputCanonical'])[5]
    encoded, signature = original_quote.split('.')
    decode(encoded)
    assert hmac.compare_digest(decode(signature), hmac.digest(b'PUBLIC-READER-QUOTE-FIXTURE-ONLY-KEY', encoded.encode(), 'sha256'))
    assert json.loads(decode(encoded)) == offer['quote']
    assert digest(b'wbe.complete-offer.v2\0' + r['capsule'].encode()) == r['intentDigest']
    assert digest(b'wbe.quote.v1\0' + original_quote.encode()) == r['quoteDigest']
    assert digest(b'wbe.financial-revision.v1\0' + offer['revisionBytes'].encode()) == offer['revisionDigest'] == f['db']['config']['revisionDigest']
    native = read(ARCHIVE / 'new-vector-generation-corrected-native.json')
    assert native['exit'] == 0 and native['stderr'] == ''
    generated = json.loads(native['stdout'])
    assert generated['kind'] == 'NEW_DETERMINISTIC_ACTUAL_ISSUER_TEST_VECTOR_NOT_RECOVERED'
    assert generated['productionAuthority'] is False
    assert len(generated['loaded']) == len(set(generated['loaded'])) == 9
    assert set(generated['loaded']) == set(custody['issuerGraph'])
    assert generated['fixtureSha256'] == custody['fixtures']['completion-authority-history.json']
    assert generated['capsuleSha256'] == digest(r['capsule'].encode())
    entropy = [r['bookingNumber'][len(f['db']['config']['numberPrefix']):], r['operationId']]
    assert generated['entropy'] == entropy
    assert generated['trace'] == [
        {'op': 'public-fixture-secret', 'name': name} for name in
        ['WBE_PRICING_QUOTE_SECRET', 'WBE_GUEST_BOOKING_ISSUER_CONFIG', 'WBE_GUEST_BOOKING_KEYS']
    ] + [{'op': 'revision-read', 'c': 'GuestBookingFinancialRevisions', 'predicates': [['_id', offer['revisionId']]], 'limit': 2}] + [
        {'op': 'fixed-test-entropy', 'n': n, 'hex': value} for n, value in zip([24, 32], entropy)
    ]
    vector = read(HERE / 'credential-vector.json')
    oracle = read(ARCHIVE / 'independent-python-oracle.json')['vectors']
    keyring = f['db']['keys']
    key = bytes.fromhex(next(x['keyHex'] for x in keyring['keys'] if x['kid'] == keyring['activeKid']))
    results = {}
    for name, purpose in [('bootstrap', 'guest-bootstrap'), ('access', 'guest-access')]:
        claims = [1, purpose, r['audience'], r['operationId'], r['intentDigest'], r['quoteDigest'], r['issuedAtMs'], r['offerExpiresAtMs']]
        payload = json.dumps(claims, ensure_ascii=True, separators=(',', ':')).encode('ascii')
        wire = 'wgb1.' + keyring['activeKid'] + '.' + b64(payload)
        message = b'WBE-GUEST-BOOKING-CREDENTIAL\0' + wire.encode('ascii')
        mac = hmac.digest(key, message, 'sha256')
        token = wire + '.' + b64(mac)
        expected = {'claims': claims, 'payloadAscii': payload.decode('ascii'), 'payloadHex': payload.hex(), 'encodedPayload': b64(payload), 'macMessageHex': message.hex(), 'macHex': mac.hex(), 'token': token}
        assert oracle[name] == expected
        assert token == vector[name] == generated[name]
        parts = vector[name].split('.')
        assert decode(parts[2]) == payload and decode(parts[3]) == mac
        results[name] = {'payloadSha256': digest(payload), 'macHex': mac.hex(), 'fullTokenSha256': digest(token.encode())}
    freeze = read(ARCHIVE / 'S13-preexecution-freeze.json')
    assert digest((HERE / 'credential-vector.json').read_bytes()) == freeze['vectorSha256']
    for name, pin in freeze['sourceHashes'].items():
        assert digest((ARCHIVE / 'reviewed-originals' / name).read_bytes()) == pin
    s13 = read(ARCHIVE / 'S13-new-vector-native.json')
    assert s13['exit'] == 0 and s13['stderr'] == ''
    assert json.loads(s13['stdout']) == {'completed': 1, 'cases': ['S13']}
    print(json.dumps({'verdict': 'PASS', 'scope': 'independent Python bytes and saved actual-issuer provenance; no backend rerun', 'vectors': results, 'quoteReplaced': False, 'historicalEntropyRecovered': False}))

if __name__ == '__main__':
    main()
