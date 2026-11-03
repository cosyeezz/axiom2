"""One synthetic AST-only output-gate check; no LLDB or target/input access."""
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import signal
import struct
import sys

ROOT = Path(__file__).absolute().parent


def expired(_signal, _frame):
    raise TimeoutError()


def fixture(label, count, start):
    path = '/private/tmp/kiro-window01-lldb-' + label + '-fixture/' + label + '.macho'
    body = struct.pack('<I', 0xd503201f) * count
    lines = ['(lldb) target create --no-dependents --arch arm64 ' + path,
        "Current executable set to '" + path + "' (arm64).",
        '(lldb) disassemble --bytes --start-address ' + hex(start)
        + ' --end-address ' + hex(start + len(body))]
    lines += [label + '.macho[' + hex(start + i * 4) + ']: 0xd503201f   nop' for i in range(count)]
    return (('\n'.join(lines) + '\n').encode(), path, start, body)


def main():
    phase = 'startup'
    completed = attempted = 0
    try:
        resource.setrlimit(resource.RLIMIT_CPU, (2, 3))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        resource.setrlimit(resource.RLIMIT_FSIZE, (65536, 65536))
        resource.setrlimit(resource.RLIMIT_NOFILE, (32, 32))
        signal.signal(signal.SIGALRM, expired)
        signal.alarm(3)
        with (ROOT / 'LLDB_PARSER_ONCE').open('xb') as f:
            f.write(b'window01-lldb-parser-check-1\n')
        phase = 'source'
        source = (ROOT / 'disassemble_once.py').read_bytes()
        tree = ast.parse(source)
        functions = [x for x in tree.body if isinstance(x, ast.FunctionDef) and x.name == 'validate_assembly']
        if len(functions) != 1 or len(source) > 24576:
            raise ValueError()
        namespace = {'re': re, 'struct': struct}
        exec(compile(ast.Module(body=functions, type_ignores=[]), '<ast-output-gate>', 'exec'), namespace)
        check = namespace['validate_assembly']
        phase = 'fixtures'
        f = fixture('format', 162, 0x100000000)
        g = fixture('field', 1229, 0x200000000)
        raw, path, start, body = f
        rows = raw.splitlines(keepends=True)
        trials = [
            ('valid-format', f, True),
            ('valid-field', g, True),
            ('wrong-word', (raw.replace(b'0xd503201f', b'0xd503201e', 1), path, start, body), False),
            ('wrong-address', (raw.replace(b'format.macho[0x100000000]', b'format.macho[0x100000004]', 1), path, start, body), False),
            ('missing-line', (b''.join(rows[:-1]), path, start, body), False),
            ('extra-line', (raw + rows[-1], path, start, body), False),
            ('changed-banner', (raw.replace(b'--no-dependents', b'--has-dependents', 1), path, start, body), False),
            ('non-ascii', (raw.replace(b'   nop', b'   n\xc3\xb6p', 1), path, start, body), False),
            ('argument-cap', (raw.replace(b'   nop\n', b'   nop ' + b'a' * 193 + b'\n', 1), path, start, body), False),
            ('raw-cap', (b'x' * 262145, path, start, body), False),
        ]
        phase = 'calls'
        for name, args, expected_success in trials:
            attempted += 1
            try:
                result = check(*args)
                passed = expected_success and result == {
                    'wordLines': len(args[3]) // 4, 'directiveOrUnknownLines': 0,
                    'completeWordRoundtrip': True, 'cfgProved': False}
            except ValueError:
                passed = not expected_success
            assert passed
            completed += 1
        phase = 'source-after'
        if (ROOT / 'disassemble_once.py').read_bytes() != source:
            raise ValueError()
        report = {'status': 'synthetic-parser-pass', 'namedCases': completed,
            'caseAssertions': attempted, 'cases': [x[0] for x in trials],
            'source': {'bytes': len(source), 'sha256': hashlib.sha256(source).hexdigest()},
            'sourceUnchanged': True, 'sourceGuardsExcludedFromAssertionCount': True,
            'pythonVersion': '.'.join(map(str, sys.version_info[:3])), 'platform': sys.platform,
            'lldbInvocations': 0, 'targetAccess': False, 'environment': 'inherited-not-enumerated',
            'actualLimits': {name: list(resource.getrlimit(kind)) for name, kind in
                [('cpu', resource.RLIMIT_CPU), ('core', resource.RLIMIT_CORE),
                 ('fsize', resource.RLIMIT_FSIZE), ('nofile', resource.RLIMIT_NOFILE)]}}
        phase = 'publish'
        with (ROOT / 'LLDB-PARSER-RESULT.json').open('x') as f:
            json.dump(report, f, sort_keys=True, indent=2)
            f.write('\n')
        print(json.dumps({'status': report['status'], 'namedCases': completed, 'caseAssertions': attempted}))
        return 0
    except BaseException:
        print(json.dumps({'status': 'synthetic-parser-failed', 'phase': phase,
            'completedNamedCases': completed, 'assertionsAttempted': attempted}))
        return 1
    finally:
        signal.alarm(0)


if __name__ == '__main__':
    raise SystemExit(main())
