try:
    import os, sys, json, hashlib, resource, signal, time, subprocess, selectors, stat
    from pathlib import Path
except BaseException:
    raise SystemExit(1)

ROOT = Path(__file__).absolute().parent
IDS = ['adrp_signed','adrp_reject','add_shift','add_reject','uleb_valid','uleb_shape','uleb_range','uleb_overflow','uleb_terminator','read_correct','read_reject','scan_four_bounds','scan_window','scan_cap']
COUNTS = [7,5,5,7,3,6,4,3,6,4,7,9,3,6]
PHASES = set(IDS + ['startup','environment','source-bind','publish'])
EXPECTED_SOURCE = 'bb5c054173e3aaf6574a1a8db190be415e1bceb08a1728386420e953e5f53e2f'


def require(condition):
    if not condition:
        raise ValueError()


def save(name, obj):
    data = (json.dumps(obj, sort_keys=True, indent=2) + '\n').encode()
    require(len(data) <= 8192)
    with (ROOT / name).open('xb') as stream:
        stream.write(data)


def bindings():
    result = {}
    for name in ('source.py','harness.py','controller.py'):
        path = ROOT / name
        info = path.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and info.st_size <= 16384)
        data = path.read_bytes()
        result[name] = {'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),
            'device':info.st_dev,'inode':info.st_ino,'mtimeNS':info.st_mtime_ns,
            'ctimeNS':info.st_ctime_ns,'mode':stat.S_IMODE(info.st_mode)}
    return result


def pairs(items):
    result = {}
    for key, value in items:
        require(key not in result)
        result[key] = value
    return result


def invalid(_value):
    raise ValueError()


def integer(value, lower, upper):
    return type(value) is int and lower <= value <= upper


def gate(raw, code):
    require(len(raw) <= 8192)
    value = json.loads(raw, object_pairs_hook=pairs, parse_constant=invalid, parse_float=invalid)
    require(type(value) is dict)
    if code == 1:
        require(set(value) == {'status','phase','completedNamedCases','assertionsAttempted'})
        require(value['status'] == 'unit-failed' and type(value['phase']) is str and value['phase'] in PHASES)
        require(integer(value['completedNamedCases'],0,14) and integer(value['assertionsAttempted'],0,96))
        return value
    require(code == 0 and set(value) == {'status','cases','assertions','environment','tinyFD','ramRestored','runtime','limits'})
    require(value['status'] == 'pass' and type(value['assertions']) is int and value['assertions'] == 75 and value['ramRestored'] is True)
    require(type(value['cases']) is list and len(value['cases']) == 14)
    for row, name, count in zip(value['cases'],IDS,COUNTS):
        require(type(row) is dict and set(row) == {'name','assertions'} and row['name'] == name and type(row['assertions']) is int and row['assertions'] == count)
    env = value['environment']
    require(type(env) is dict and set(env) == {'expectedSixPresent','onlyDocumentedExtras','actualKeyCount','platformExtraCount'})
    require(env['expectedSixPresent'] is True and env['onlyDocumentedExtras'] is True
        and integer(env['platformExtraCount'],0,6) and integer(env['actualKeyCount'],6,12)
        and env['actualKeyCount'] == env['platformExtraCount'] + 6)
    tiny = value['tinyFD']
    require(type(tiny) is dict and set(tiny) == {'size','stable','regular','owned'}
        and type(tiny['size']) is int and tiny['size'] == 10
        and all(tiny[k] is True for k in ('stable','regular','owned')))
    runtime = value['runtime']
    require(type(runtime) is dict and set(runtime) == {'version','platform','machine'})
    require(type(runtime['version']) is list and len(runtime['version']) == 3
        and all(integer(x,0,100) for x in runtime['version'])
        and runtime['platform'] == 'darwin' and runtime['machine'] == 'arm64')
    limits = value['limits']
    require(limits == {'cpu':[2,3],'core':[0,0],'fsize':[65536,65536],'nofile':[32,32]})
    require(all(type(v) is list and all(type(n) is int for n in v) for v in limits.values()))
    return value


def child_limits():
    resource.setrlimit(resource.RLIMIT_CPU,(2,3))
    resource.setrlimit(resource.RLIMIT_CORE,(0,0))
    resource.setrlimit(resource.RLIMIT_FSIZE,(65536,65536))
    resource.setrlimit(resource.RLIMIT_NOFILE,(32,32))
    signal.alarm(5)


def alarm(_signal,_frame):
    raise TimeoutError()


def main():
    child = selector = None
    before = after = safe = None
    fault = None
    gate_consumed = False
    eof = {'stdout':False,'stderr':False}
    buffers = {'stdout':bytearray(),'stderr':bytearray()}
    received = 0
    started = time.monotonic()
    try:
        resource.setrlimit(resource.RLIMIT_CPU,(10,10))
        resource.setrlimit(resource.RLIMIT_CORE,(0,0))
        resource.setrlimit(resource.RLIMIT_FSIZE,(65536,65536))
        resource.setrlimit(resource.RLIMIT_NOFILE,(64,64))
        signal.signal(signal.SIGALRM,alarm)
        signal.alarm(12)
        info = ROOT.lstat()
        require(ROOT.parent == Path('/private/tmp') and ROOT.name.startswith('catalog-xref-unit02-')
            and stat.S_ISDIR(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o700 and info.st_uid == os.getuid())
        with (ROOT/'RUN_ONCE').open('xb') as marker:
            marker.write(b'catalog-xref-unit02-one-worker\n')
        gate_consumed = True
        before = bindings()
        require(before['source.py']['bytes'] == 8114 and before['source.py']['sha256'] == EXPECTED_SOURCE)
        for name in ('home','tmp'):
            (ROOT/name).mkdir(mode=0o700)
        env = {'HOME':str(ROOT/'home'),'TMPDIR':str(ROOT/'tmp'),'TMP':str(ROOT/'tmp'),
            'TEMP':str(ROOT/'tmp'),'PATH':'/usr/bin:/bin','LANG':'C'}
        command = ['/usr/bin/python3','-I','-B',str(ROOT/'harness.py')]
        save('prelaunch.json',{'bindings':before,'command':command,'env':env,'cwd':str(ROOT),
            'controllerEnvironment':'inherited-not-enumerated','childLimits':'preexec-and-script-start'})
        child = subprocess.Popen(command,cwd=str(ROOT),env=env,stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,stderr=subprocess.PIPE,close_fds=True,preexec_fn=child_limits)
        save('held-start.json',{'pid':child.pid,'workerCount':1})
        deadline = time.monotonic() + 5
        selector = selectors.DefaultSelector()
        for stream,label in ((child.stdout,'stdout'),(child.stderr,'stderr')):
            os.set_blocking(stream.fileno(),False)
            selector.register(stream,selectors.EVENT_READ,label)
        while selector.get_map() and fault is None:
            left = deadline - time.monotonic()
            if left <= 0:
                fault = 'deadline'
                break
            for key,_ in selector.select(min(left,.05)):
                try:
                    data = os.read(key.fd,1024)
                except BlockingIOError:
                    continue
                if not data:
                    eof[key.data] = True
                    selector.unregister(key.fileobj)
                    key.fileobj.close()
                else:
                    received += len(data)
                    if received > 8192:
                        fault = 'pipe-cap'
                        break
                    buffers[key.data].extend(data)
        if fault is None:
            child.wait(timeout=max(.001,deadline-time.monotonic()))
    except BaseException:
        fault = fault or 'controller-error'
    finally:
        signal.alarm(0)
        if selector is not None:
            try:
                selector.close()
            except BaseException:
                fault = fault or 'controller-error'
        if child is not None:
            try:
                if child.poll() is None:
                    child.kill()
                child.wait(timeout=2)
            except BaseException:
                fault = fault or 'cleanup-unknown'
            for stream in (child.stdout,child.stderr):
                try:
                    stream.close()
                except BaseException:
                    fault = fault or 'controller-error'
        if not gate_consumed:
            return 1
        # Held outcome is saved even when exit is nonzero or pipe JSON is rejected.
        try:
            after = bindings()
            if before != after:
                fault = fault or 'source-changed'
        except BaseException:
            fault = fault or 'source-check-failed'
        held = {'pid':child.pid if child else None,'actualExitCode':child.returncode if child else None,
            'trueEOF':eof,'captureFault':fault,'receivedBytes':received,
            'retainedStdoutBytes':len(buffers['stdout']),'retainedStderrBytes':len(buffers['stderr']),
            'elapsedBeforePublication':time.monotonic()-started,'before':before,'after':after,
            'directChildOnly':True,'rawStreamsPersisted':False}
        try:
            save('held.json',held)
        except BaseException:
            return 1
        try:
            require(fault is None and all(eof.values()) and not buffers['stderr'] and child is not None)
            safe = gate(bytes(buffers['stdout']),child.returncode)
            save('worker.safe.json',safe)
        except BaseException:
            fault = fault or 'output-gate-rejected'
        passed = fault is None and safe is not None and safe['status'] == 'pass' and child.returncode == 0
        report = {'schema':'catalog-xref-unit02-1','status':'pass' if passed else 'failed',
            'fault':fault,'worker':safe,'held':held,'scope':'synthetic-helper-only-no-target-access',
            'wholeAuthorTimingMeasured':False,'cleanupFaultBranchesExercised':False}
        try:
            own = sum(p.stat().st_size for p in ROOT.rglob('*') if p.is_file())
            require(own + 8192 <= 128*1024)
            save('report.json',report)
        except BaseException:
            return 1
        print(json.dumps({'status':report['status'],'pid':held['pid'],
            'workerExit':held['actualExitCode'],'trueEOF':eof,'fault':fault}))
        return 0 if passed else 1


if __name__ == '__main__':
    try:
        result = main()
    except BaseException:
        result = 1
    raise SystemExit(result)
