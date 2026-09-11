"""Default-OFF serial caller. Durable work/cursor/authority live only in Wix.

A timeout is an ambiguous remote invocation, not cancellation. Never retry that
nonce. New calls re-enter the existing one-effect producer with fresh scopes.
"""
from dataclasses import dataclass, field
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from urllib.parse import urlsplit

import requests

PURPOSE = 'guest-booking-continuation/v1'


@dataclass(frozen=True)
class Configuration:
    enabled: bool = False
    url: str = ''
    key: str = field(default='', repr=False)
    max_requests: int = 32
    max_seconds: float = 20

    def __post_init__(self):
        if type(self.enabled) is not bool:
            raise ValueError('guest_continuation_configuration')
        if not self.enabled:
            return
        u = urlsplit(self.url)
        if (u.scheme != 'https' or not u.hostname or u.username or u.password
                or u.query or u.fragment or u.port not in (None, 443)
                or u.path != '/_functions/guestBookingContinuation'
                or not re.fullmatch(r'https://[a-z0-9.-]+/_functions/guestBookingContinuation', self.url)
                or not re.fullmatch(r'[a-f0-9]{64}', self.key)
                or type(self.max_requests) is not int or not 1 <= self.max_requests <= 128
                or type(self.max_seconds) not in (int, float) or not 0 < self.max_seconds <= 120):
            raise ValueError('guest_continuation_configuration')

    @classmethod
    def from_environment(cls):
        if os.environ.get('WBE_GUEST_CONTINUATION_ENABLED') != 'true':
            return cls()
        return cls(True, os.environ.get('WBE_GUEST_CONTINUATION_URL', ''),
                   os.environ.get('WBE_GUEST_CONTINUATION_KEY', ''))


class Driver:
    def __init__(self, config, *, session=None, wall_clock=time.time, clock=time.monotonic):
        self.config = config
        self.session = session or requests.Session()
        self.session.trust_env = False
        # requests' default HTTPAdapter has retries disabled. Injected transports
        # are for inert tests only; no retry, proxy or redirect enables authority.
        self.wall_clock, self.clock = wall_clock, clock

    def _mac(self, text):
        return hmac.new(bytes.fromhex(self.config.key), text.encode('utf8'), hashlib.sha256).hexdigest()

    def invoke(self):
        if not self.config.enabled:
            return 'DISABLED'
        nonce = secrets.token_hex(32)
        raw = json.dumps({'v': 1, 'purpose': PURPOSE,
                          'timestamp': int(self.wall_clock()*1000), 'nonce': nonce}, separators=(',', ':'))
        original = 'WBE-GUEST-TRIGGER/1\nPOST\n'+self.config.url+'\n'+raw
        expected = hashlib.sha256(original.encode()).hexdigest()
        # Original request binding is captured before the transport await/block.
        with self.session.post(self.config.url, data=raw.encode(),
                               headers={'Content-Type': 'application/json', 'x-wbe-guest-mac': self._mac(original)},
                               timeout=(5, 60), allow_redirects=False, proxies={}, stream=True) as response:
            if response.status_code != 200:
                return 'RETRY'
            parts, size = [], 0
            for chunk in response.iter_content(chunk_size=1024):
                size += len(chunk)
                if size > 1024:
                    return 'RETRY'
                parts.append(chunk)
            text = b''.join(parts).decode('utf8')
            supplied = response.headers.get('x-wbe-guest-mac', '')
            if (not re.fullmatch(r'[a-f0-9]{64}', supplied)
                    or not hmac.compare_digest(supplied, self._mac('WBE-GUEST-TRIGGER-RESPONSE/1\n'+text))):
                return 'RETRY'
            body = json.loads(text)
            if (type(body) is not dict or list(body) != ['v', 'nonce', 'requestDigest', 'status']
                    or type(body['v']) is not int or body['v'] != 1
                    or body['nonce'] != nonce or body['requestDigest'] != expected
                    or body['status'] not in ('VISITED', 'IDLE', 'RETRY')
                    or json.dumps(body, separators=(',', ':')) != text):
                return 'RETRY'
            return body['status']  # Scheduling hint ONLY, never booking/send authority.

    def drain(self, stopping=lambda: False):
        if not self.config.enabled:
            return {'reason': 'DISABLED', 'requests': 0}
        started, count = self.clock(), 0
        while not stopping() and count < self.config.max_requests and self.clock()-started < self.config.max_seconds:
            count += 1
            try:
                status = self.invoke()
            except Exception:
                status = 'RETRY'  # No payload/URL/secret logging, no same-nonce retry.
            if status != 'VISITED':
                return {'reason': status, 'requests': count}
            # No inter-progress sleep; next iteration is a DISTINCT HTTP request.
        return {'reason': 'STOPPED' if stopping() else 'CAP', 'requests': count}

    def close(self):
        self.session.close()


# One process-local lifecycle owner. Remote invocations can still overlap after
# network timeout or deploy overlap; only the Wix durable protocol is authority.
import asyncio
from contextlib import asynccontextmanager
import logging
from threading import Event, Lock, Thread

_log = logging.getLogger('uvicorn.error')
_owner_lock = Lock()
_owner = None
_SHUTDOWN_GRACE = 5


class _Supervisor:
    def __init__(self, config):
        self.stop = Event()
        self.driver = Driver(config)
        self.thread = Thread(target=self.run, name='guest-booking-continuation', daemon=True)

    def run(self):
        failures = 0
        try:
            while not self.stop.is_set():
                started = time.monotonic()
                try:
                    report = self.driver.drain(self.stop.is_set)
                    reason, count = report['reason'], report['requests']
                except Exception:
                    reason, count = 'RETRY', 0
                _log.info('guest_continuation_drain %s requests=%d elapsed=%.3f',
                          reason, count, time.monotonic()-started)
                if reason in ('STOPPED', 'DISABLED'):
                    break
                failures = min(failures+1, 6) if reason == 'RETRY' else 0
                delay = min(60, 2**failures) if failures else (5 if reason == 'IDLE' else 0.25)
                # Only idle, failure or exhausted drain yields/backoffs. There is
                # no arbitrary delay between successful requests WITHIN a drain.
                if self.stop.wait(delay):
                    break
        except BaseException:
            _log.error('guest_continuation_terminal_failure')
        finally:
            self.driver.close()


@asynccontextmanager
async def guest_continuation_lifespan():
    global _owner
    config = Configuration.from_environment()
    if not config.enabled:
        yield
        return
    with _owner_lock:
        if _owner is not None and _owner.thread.is_alive():
            raise RuntimeError('guest_continuation_lifespan_active')
        owner = _Supervisor(config)
        _owner = owner
        owner.thread.start()
    try:
        yield
    finally:
        owner.stop.set()
        await asyncio.to_thread(owner.thread.join, _SHUTDOWN_GRACE)
        if owner.thread.is_alive():
            _log.warning('guest_continuation_shutdown_inflight')
        # No forced session close and no claim that remote IO was cancelled.
