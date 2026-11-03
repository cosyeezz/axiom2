"""Strict artifact consumer for declared self-owned HTTP calibration only.

Caller must first hold/wait the original child, obtain real EOF/exit0 within its
independent deadline, and own these bounded files. This validates artifacts, not
PID ownership, lifecycle containment, provenance, TLS wire or server receipt.
"""
import base64
import json

MAX_EVENTS = 128
MAX_BODY = 256 * 1024
MAX_LOG = 1024 * 1024
MAX_JSON_DEPTH = 16
SCOPE = 'only-self-owned-http-fixture'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def strict_json(raw, cap):
    require(type(raw) is bytes and 0 < len(raw) <= cap, 'JSON input cap/type')
    # Explicit version-independent bound before the recursive JSON parser.
    # Count only structural ASCII outside quoted/escaped JSON strings.
    depth = 0
    quoted = False
    escaped = False
    for byte in raw:
        if quoted:
            if escaped:
                escaped = False
            elif byte == 92:
                escaped = True
            elif byte == 34:
                quoted = False
        elif byte == 34:
            quoted = True
        elif byte in (91, 123):
            depth += 1
            require(depth <= MAX_JSON_DEPTH, 'JSON depth cap')
        elif byte in (93, 125):
            depth -= 1
            require(depth >= 0, 'unbalanced JSON container')
    require(depth == 0 and not quoted, 'incomplete JSON container/string')

    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'duplicate JSON key')
            result[key] = value
        return result

    def integer(value):
        require(len(value) <= 20, 'integer digit cap')
        return int(value)

    def forbidden(value):
        raise ValueError('noninteger/nonfinite JSON number: ' + value[:24])

    try:
        return json.loads(raw.decode('utf-8'), object_pairs_hook=pairs,
                          parse_int=integer, parse_float=forbidden,
                          parse_constant=forbidden)
    except (UnicodeError, RecursionError) as error:
        raise ValueError('invalid JSON encoding/depth') from error


def fields(value, keys):
    require(type(value) is dict and set(value) == set(keys), 'exact object schema')


def natural(value, upper):
    require(type(value) is int and 0 <= value <= upper, 'integer range/type')


def validate_capture(status_raw, trace_raw, *, scope, expected_requests):
    require(scope == SCOPE, 'self-owned scope required')
    require(type(expected_requests) is int and 1 <= expected_requests <= MAX_EVENTS,
            'nonempty declared request set required')
    status = strict_json(status_raw, 2048)
    fields(status, ['ok', 'reason', 'events', 'bodyBytes', 'logBytes', 'requests', 'pendingBodyBytes'])
    require(status['ok'] is True and status['reason'] is None, 'observer failure')
    for name, cap in [('events', MAX_EVENTS), ('bodyBytes', MAX_BODY),
                      ('logBytes', MAX_LOG), ('requests', MAX_EVENTS), ('pendingBodyBytes', MAX_BODY)]:
        natural(status[name], cap)
    require(status['pendingBodyBytes'] == 0, 'unfinished original call')
    require(type(trace_raw) is bytes and 0 < len(trace_raw) <= MAX_LOG, 'trace cap/type')
    require(trace_raw.endswith(b'\n'), 'partial trace tail')
    lines = trace_raw[:-1].split(b'\n')
    require(len(lines) == status['events'] and len(trace_raw) == status['logBytes'],
            'event/log counter mismatch')
    requests = {}
    body_total = 0
    for line in lines:
        event = strict_json(line, MAX_LOG)
        require(type(event) is dict, 'event object')
        kind = event.get('kind')
        require(type(kind) is str, 'event kind')
        if kind == 'request':
            fields(event, ['kind', 'id', 'method', 'path'])
            natural(event['id'], MAX_EVENTS)
            require(event['id'] == len(requests) + 1, 'request identity sequence')
            require(type(event['method']) is str and type(event['path']) is str,
                    'request metadata type')
            requests[event['id']] = {'method': event['method'], 'path': event['path'],
                                      'header': None, 'body': bytearray(), 'ends': 0}
            continue
        if kind == 'request-call':
            require(type(event.get('originalReturned')) is bool, 'return discriminator')
            fields(event, ['kind', 'api', 'originalReturned'] +
                   (['id'] if event['originalReturned'] else []))
            require(event['api'] in ['http.request', 'https.request'], 'request API')
            if not event['originalReturned']:
                continue
        elif kind == 'header-call':
            fields(event, ['kind', 'originalReturned'])
            require(event['originalReturned'] is False, 'rejected header discriminator')
            continue
        elif kind not in ['header-cache', 'write', 'end']:
            raise ValueError('unknown event kind')
        natural(event.get('id'), MAX_EVENTS)
        require(event['id'] in requests, 'unregistered request identity')
        request = requests[event['id']]
        if kind == 'request-call':
            continue
        if kind == 'header-cache':
            fields(event, ['kind', 'id', 'value'])
            require(type(event['value']) is str and event['value'].endswith('\r\n\r\n'),
                    'header cache type/completeness')
            require(request['header'] is None, 'duplicate final header')
            request['header'] = event['value']
            continue
        require(type(event.get('originalReturned')) is bool, 'return discriminator')
        if not event['originalReturned']:
            fields(event, ['kind', 'id', 'originalReturned'])
            continue
        fields(event, ['kind', 'id', 'originalReturned', 'returnType', 'returnIsThis',
                       'booleanReturn', 'bytes', 'bodyBase64'])
        require(type(event['returnIsThis']) is bool, 'receiver result type')
        if kind == 'write':
            require(event['returnType'] == 'boolean' and type(event['booleanReturn']) is bool
                    and event['returnIsThis'] is False, 'write result schema')
        else:
            require(event['returnType'] == 'object' and event['booleanReturn'] is None
                    and event['returnIsThis'] is True, 'end result schema')
            request['ends'] += 1
        natural(event['bytes'], MAX_BODY)
        require(type(event['bodyBase64']) is str, 'body base64 type')
        try:
            body = base64.b64decode(event['bodyBase64'], validate=True)
        except (ValueError, TypeError) as error:
            raise ValueError('invalid body base64') from error
        require(base64.b64encode(body).decode('ascii') == event['bodyBase64'], 'noncanonical base64')
        require(len(body) == event['bytes'], 'body byte mismatch')
        body_total += len(body)
        require(body_total <= MAX_BODY, 'total body cap')
        request['body'].extend(body)
    require(len(requests) == expected_requests == status['requests'], 'declared request set mismatch')
    require(body_total == status['bodyBytes'], 'body counter mismatch')
    require(all(r['header'] is not None and r['ends'] == 1 for r in requests.values()),
            'incomplete declared HTTP requests')
    return {'status': status, 'requests': requests}
