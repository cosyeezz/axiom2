"""Pure bounded snapshot checker. No IO, terminal ownership, or request equality.

Only exact bytes input. Never returns decoded values, exception text or input hashes.
A schema-valid candidate is still only a provenance-free partial API projection.
"""
import json

MAX_BYTES = 16384
MAX_DEPTH = 16
STATES = frozenset(('not-installed', 'active', 'closed', 'conflict'))
FAULTS = frozenset(('none', 'late-call', 'unsupported-receiver', 'record-cap',
    'reentrant-request', 'repeated-end', 'scan-cap', 'original-threw',
    'observer-fault', 'call-cap', 'restore-conflict', 'close-pending',
    'install-refused', 'install-failed'))
BODIES = frozenset(('no-end', 'write-seen', 'reentrant', 'repeated-end',
    'unsupported-arity', 'no-primitive-string', 'unsupported-encoding',
    'string-cap', 'scan-cap', 'primitive-utf8-argument', 'original-threw'))
METHODS = frozenset(('GET', 'POST', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS',
    'CONNECT', 'TRACE', 'other'))
ENDPOINTS = frozenset(('unknown', 'generate-assistant-response', 'create-response'))
UNKNOWN_HEADER_REASONS = frozenset(('invalid-bound', 'unsupported-input-type',
    'header-cap', 'unsupported-text', 'header-grammar', 'header-count-cap',
    'header-line-cap', 'projection-failed'))
ROOT_KEYS = frozenset(('schema', 'state', 'fault', 'calls', 'pending', 'coverage',
    'requestCompletenessProved', 'wireReceiptProved', 'naturalInstallationProved', 'records'))
RECORD_KEYS = frozenset(('ordinal', 'endSeen', 'endReturned', 'body', 'header'))
HEADER_KEYS = frozenset(('schema', 'coverage', 'reason', 'method', 'httpVersion',
    'endpoint', 'queryPresent', 'authorization', 'otherHeadersPresent',
    'valueEqualityProved', 'wireReceiptProved'))
AUTH_KEYS = frozenset(('present', 'duplicate', 'scheme', 'form', 'tokenShape', 'scope'))


def _result(valid=False, reason='invalid-input-type', candidate=False, observations=0):
    return {'schema': 'end-string-snapshot-check-1',
        'result': 'schema-valid' if valid else 'invalid', 'reason': reason,
        'endStringShapeCandidate': candidate, 'observations': observations,
        'requestCompletenessProved': False, 'wireReceiptProved': False,
        'naturalInstallationProved': False, 'valueEqualityProved': False}


def _keys(value, expected):
    return type(value) is dict and value.keys() == expected


def _enum(value, values):
    return type(value) is str and value in values


def _integer(value, lo, hi):
    return type(value) is int and lo <= value <= hi


def _pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise ValueError()
        result[key] = value
    return result


def _number(text):
    # Producer counters are nonnegative <=128, no floating/negative/exponent forms.
    if len(text) > 3 or not text or text[0] == '-':
        raise ValueError()
    return int(text)


def _forbidden_number(_):
    raise ValueError()


def _depth_ok(text):
    depth = 0
    quoted = False
    escaped = False
    for character in text:
        if quoted:
            if escaped:
                escaped = False
            elif character == '\\':
                escaped = True
            elif character == '"':
                quoted = False
        elif character == '"':
            quoted = True
        elif character in '[{':
            depth += 1
            if depth > MAX_DEPTH:
                return False
        elif character in ']}':
            depth -= 1
            if depth < 0:
                return False
    # JSON grammar remains the decoder's responsibility, including mismatched kinds.
    return depth == 0 and not quoted


def _auth_valid(auth, unknown):
    if not _keys(auth, AUTH_KEYS) or auth['scope'] != 'unknown':
        return False
    if unknown:
        return (auth['present'] is None and auth['duplicate'] is None
            and auth['scheme'] == auth['form'] == auth['tokenShape'] == 'unknown')
    if auth['present'] is False:
        return (auth['duplicate'] is False
            and auth['scheme'] == auth['form'] == auth['tokenShape'] == 'absent')
    if auth['present'] is not True:
        return False
    if auth['duplicate'] is True:
        return auth['scheme'] == auth['form'] == auth['tokenShape'] == 'unknown'
    if auth['duplicate'] is not False:
        return False
    if auth['scheme'] == 'other':
        return auth['form'] == auth['tokenShape'] == 'unknown'
    if auth['scheme'] != 'bearer':
        return False
    return ((auth['form'] == 'unrecognized' and auth['tokenShape'] == 'unknown')
        or (auth['form'] == 'nonempty-ascii'
            and _enum(auth['tokenShape'], ('opaque', 'three-segment'))))


def _header_valid(header):
    if not _keys(header, HEADER_KEYS) or header['schema'] != 'real-http-header-shape-1':
        return False
    if header['valueEqualityProved'] is not False or header['wireReceiptProved'] is not False:
        return False
    unknown = header['coverage'] == 'unknown'
    if unknown:
        return (_enum(header['reason'], UNKNOWN_HEADER_REASONS)
            and header['method'] == header['httpVersion'] == header['endpoint'] == 'unknown'
            and header['queryPresent'] is None and header['otherHeadersPresent'] is None
            and _auth_valid(header['authorization'], True))
    if header['coverage'] != 'format-only' or header['reason'] != 'bounded-header-cache':
        return False
    if not (_enum(header['method'], METHODS)
        and _enum(header['httpVersion'], ('1.0', '1.1'))
        and _enum(header['endpoint'], ENDPOINTS)
        and type(header['queryPresent']) is bool
        and type(header['otherHeadersPresent']) is bool):
        return False
    if header['endpoint'] != 'unknown' and not (header['method'] == 'POST'
            and header['queryPresent'] is False):
        return False
    return _auth_valid(header['authorization'], False)


def _snapshot_valid(snapshot):
    if not _keys(snapshot, ROOT_KEYS) or snapshot['schema'] != 'end-string-observer-1':
        return False
    if not (_enum(snapshot['state'], STATES) and _enum(snapshot['fault'], FAULTS)):
        return False
    if snapshot['coverage'] != 'partial-api-only':
        return False
    if any(snapshot[key] is not False for key in ('requestCompletenessProved',
            'wireReceiptProved', 'naturalInstallationProved')):
        return False
    if not _integer(snapshot['calls'], 0, 128):
        return False
    if not _integer(snapshot['pending'], 0, snapshot['calls']):
        return False
    records = snapshot['records']
    if type(records) is not list or len(records) > min(4, snapshot['calls']):
        return False
    for ordinal, record in enumerate(records, 1):
        if not _keys(record, RECORD_KEYS) or not _integer(record['ordinal'], ordinal, ordinal):
            return False
        if type(record['endSeen']) is not bool or type(record['endReturned']) is not bool:
            return False
        if record['endReturned'] and not record['endSeen']:
            return False
        if not _enum(record['body'], BODIES) or not _header_valid(record['header']):
            return False
    return True


def _candidate(snapshot):
    records = snapshot['records']
    return (snapshot['state'] == 'closed' and snapshot['fault'] == 'none'
        and snapshot['pending'] == 0 and 0 < len(records) == snapshot['calls']
        and all(record['endSeen'] and record['endReturned']
            and record['body'] == 'primitive-utf8-argument'
            and record['header']['coverage'] == 'format-only' for record in records))


def check_snapshot(encoded):
    """Classify exact bounded bytes. No side effects or provenance/receipt proof."""
    if type(encoded) is not bytes:
        return _result()
    if len(encoded) > MAX_BYTES:
        return _result(reason='byte-cap')
    try:
        text = encoded.decode('utf-8', errors='strict')
    except Exception:
        return _result(reason='unsupported-encoding')
    try:
        if not _depth_ok(text):
            return _result(reason='depth-or-structure')
        snapshot = json.loads(text, object_pairs_hook=_pairs, parse_int=_number,
            parse_float=_forbidden_number, parse_constant=_forbidden_number)
    except Exception:
        return _result(reason='json-invalid')
    try:
        if not _snapshot_valid(snapshot):
            return _result(reason='schema-invalid')
        return _result(True, 'bounded-snapshot-schema', _candidate(snapshot), len(snapshot['records']))
    except Exception:
        # Do not expose exception instances, raw data or arbitrary key/value text.
        return _result(reason='schema-invalid')
