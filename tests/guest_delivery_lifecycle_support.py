"""GP07-GP09 only: frozen native bridge and fresh private Python packages."""
import base64
from concurrent.futures import Future
from copy import deepcopy
import hashlib
import importlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
PDF = b'%PDF-inert-fixture-not-a-real-render'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


class LifecycleBridge:
    def __init__(self):
        overlay = Path(os.environ['WBE_GUEST_DELIVERY_LAST_OVERLAY']).resolve()
        pins = json.loads((overlay / 'frozen-hashes.json').read_text())
        assert 'scripts/python-lifecycle-bridge.cjs' in pins
        for name, digest in pins.items():
            assert sha((overlay / name).read_bytes()) == digest, name
        self.process = subprocess.Popen(['node', '--experimental-vm-modules',
            'scripts/python-lifecycle-bridge.cjs', '--lifecycle-bridge'], cwd=overlay,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding='utf-8')
        self.issuance_id = json.loads(self.process.stdout.readline())['issuanceId']
        self.lock = threading.Lock()
        self.pending, self.calls, self.responses = {}, [], []
        self.thread = threading.Thread(target=self._receive, daemon=True)
        self.thread.start()

    def _receive(self):
        try:
            for line in self.process.stdout:
                response = json.loads(line)
                with self.lock:
                    self.responses.append(response)
                    future = self.pending.pop(response['id'])
                if 'error' in response:
                    future.set_exception(AssertionError(response['error']))
                else:
                    future.set_result(response)
        finally:
            with self.lock:
                for future in self.pending.values():
                    future.set_exception(AssertionError('native bridge closed'))
                self.pending.clear()

    def call(self, operation, issuance_id=None, payload=None, client='control'):
        assert issuance_id is None or issuance_id == self.issuance_id
        with self.lock:
            request = dict(id=len(self.calls), operation=operation, payload=payload or {}, client=client)
            self.calls.append(deepcopy(request))
            future = Future()
            self.pending[request['id']] = future
            self.process.stdin.write(json.dumps(request, separators=(',', ':')) + '\n')
            self.process.stdin.flush()
        return deepcopy(future.result(timeout=20)['result'])

    def snapshot(self):
        return self.call('snapshot')['rows']

    def close(self):
        self.process.stdin.close()
        self.process.wait(timeout=25)
        self.thread.join(timeout=5)
        error = self.process.stderr.read()
        directory = Path(os.environ['WBE_GUEST_DELIVERY_TEST_EVIDENCE'])
        with (directory / 'lifecycle-transcripts.jsonl').open('a', encoding='utf-8') as output:
            output.write(json.dumps(dict(native_exit=self.process.returncode, stderr=error,
                issuanceId=self.issuance_id, calls=self.calls, responses=self.responses)) + '\n')
        self.process.stdout.close()
        self.process.stderr.close()
        assert not self.thread.is_alive()
        assert self.process.returncode == 0, error


class Client:
    def __init__(self, bridge, name):
        self.bridge, self.name, self.calls = bridge, name, []

    def call(self, operation, issuance_id, payload=None):
        self.calls.append((operation, deepcopy(payload)))
        return self.bridge.call(operation, issuance_id, payload, client=self.name)


def fresh_module(monkeypatch, name, nonce, events, *, real_transport=False):
    """Load real source and relative adapters in a new package/module graph.

    No old booking_engine objects, globals or grants enter the new graph.
    Third-party libraries/stdlib are shared; this is module, not process restart.
    """
    package_name = '_guest_lifecycle_' + name
    assert not any(k == package_name or k.startswith(package_name + '.') for k in sys.modules)
    spec = importlib.util.spec_from_file_location(package_name, ROOT / 'booking_engine/__init__.py',
        submodule_search_locations=[str(ROOT / 'booking_engine')])
    package = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, package_name, package)
    spec.loader.exec_module(package)
    # Existing adapters use both relative and absolute booking_engine imports.
    # Resolve the latter into this private graph without changing source bytes
    # or mutating the interpreter's shared booking_engine package.
    import builtins
    original_import = builtins.__import__
    def private_import(name, globals=None, locals=None, fromlist=(), level=0):
        if level == 0 and (name == 'booking_engine' or name.startswith('booking_engine.')):
            name = package_name + name[len('booking_engine'):]
        return original_import(name, globals, locals, fromlist, level)
    for child in ('invoice', 'invoice_pdf', 'invoice_word', 'invoice_renderer',
                  'invoice_original_groups', 'gmail_sender', 'guest_invoice_delivery'):
        path = ROOT / 'booking_engine' / (child + '.py')
        child_spec = importlib.util.spec_from_file_location(package_name + '.' + child, path)
        value = importlib.util.module_from_spec(child_spec)
        value.__dict__['__builtins__'] = dict(vars(builtins), __import__=private_import)
        monkeypatch.setitem(sys.modules, value.__name__, value)
        setattr(package, child, value)
        exec(compile(path.read_bytes(), str(path), 'exec'), value.__dict__)
    module = sys.modules[package_name + '.guest_invoice_delivery']
    assert package.invoice_original_groups.Invoice is package.invoice.Invoice
    assert package.invoice_word.Invoice is package.invoice.Invoice
    assert module.Guest is package.invoice.Guest
    monkeypatch.setattr(module, 'secrets', SimpleNamespace(token_hex=lambda size: nonce if size == 32 else None))
    def token():
        events.append(dict(worker=name, kind='token'))
        return 'inert-token'
    def render(*args):
        events.append(dict(worker=name, kind='render'))
        raise AssertionError('render forbidden: must reuse native PREPARED')
    def send(raw, token):
        events.append(dict(worker=name, kind='provider', raw=base64.b64encode(raw).decode(), token=token))
        return 'inert-message'
    monkeypatch.setattr(module.gmail_sender, 'prepare_journal_token', token)
    monkeypatch.setattr(module, 'render_invoice_pdf_for_service', render)
    if not real_transport:
        monkeypatch.setattr(module.gmail_sender, 'send_journal_mime', send)
    return module


def prepare(bridge, module, tmp_path):
    state = bridge.call('readIssuance')
    assert state['status'] == 'READY' and state['artifact'] is None
    pdf = tmp_path / 'inert.pdf'
    pdf.write_bytes(PDF)
    raw = module.gmail_sender.build_invoice_email(state['root']['to'], 'Fixture Guest',
        bridge.issuance_id, str(pdf), '$470.02 USD', owner_only=False).as_bytes()
    prepared = bridge.call('commitArtifact', payload=dict(encoded=base64.b64encode(raw).decode(),
        mimeDigest=sha(raw), pdfDigest=sha(PDF), rendererVersion='word'))
    assert prepared['status'] == 'READY' and prepared['start'] is None
    assert prepared['root'] == state['root']
    assert base64.b64decode(prepared['artifact']['encoded']) == raw
    module._state(prepared, bridge.issuance_id)
    return prepared, raw


def save_case(name, **values):
    directory = Path(os.environ['WBE_GUEST_DELIVERY_TEST_EVIDENCE'])
    (directory / (name + '.json')).write_text(json.dumps(values, indent=2), encoding='utf-8')


def unchanged_booking(before, after):
    assert before['Bookings'] and before['GuestBookingCompletions']
    for key in set(before) | set(after):
        if key != 'GuestBookingInvoiceIssuances':
            assert after.get(key) == before.get(key), key


def lower_transport(monkeypatch, mode, events):
    """Existing test_gmail_sender lower _make_request seam, real stack above."""
    import io
    import socket
    import requests
    import urllib3
    from urllib3.connectionpool import HTTPSConnectionPool
    from urllib3.exceptions import ProtocolError, ReadTimeoutError
    from urllib3.util import connection
    calls, sessions = [], []
    def deny_socket(*args, **kwargs):
        raise AssertionError('NETWORK_DENIED')
    monkeypatch.setattr(socket, 'create_connection', deny_socket)
    monkeypatch.setattr(socket.socket, 'connect', deny_socket)
    monkeypatch.setattr(connection, 'create_connection', deny_socket)
    original_send = requests.Session.send
    def observe_send(self, request, **kwargs):
        sessions.append(dict(trust_env=self.trust_env, redirects=kwargs['allow_redirects'],
            timeout=list(kwargs['timeout']), retries=self.get_adapter(request.url).max_retries.total,
            url=request.url, method=request.method, body=request.body.decode() if isinstance(request.body, bytes) else request.body))
        return original_send(self, request, **kwargs)
    monkeypatch.setattr(requests.Session, 'send', observe_send)
    def lower(self, conn, method, url, **kwargs):
        events.append(dict(kind='lower_POST'))
        calls.append(dict(host=self.host, method=method, url=url,
            retries=kwargs['retries'].total, connect=kwargs['timeout'].connect_timeout,
            read=kwargs['timeout'].read_timeout, authorization=kwargs['headers']['Authorization'],
            body=kwargs['body'].decode() if isinstance(kwargs['body'], bytes) else kwargs['body']))
        if mode == 'reset':
            raise ProtocolError('inert reset')
        if mode == 'timeout':
            raise ReadTimeoutError(self, url, 'inert timeout')
        body = b'{"id":"fixture-exact-lower-ID"}'
        if mode == 'bad_id': body = b'{"id":""}'
        if mode == 'non_json': body = b'not-json'
        return urllib3.response.HTTPResponse(body=io.BytesIO(body), preload_content=False,
            status={'401': 401, 'redirect': 302, 'bad_status': 503}.get(mode, 200),
            headers={'Location': 'https://must-not-follow.invalid/'})
    monkeypatch.setattr(HTTPSConnectionPool, '_make_request', lower)
    return calls, sessions
