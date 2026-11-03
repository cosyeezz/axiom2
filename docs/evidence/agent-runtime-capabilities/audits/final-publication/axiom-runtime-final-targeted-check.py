from pathlib import Path
from collections import Counter
import re,json,urllib.parse,hashlib
R=Path('/Volumes/D_Work/axiom2'); E=R/'docs/evidence/agent-runtime-capabilities'
files=[E/'README.md',E/'validation.md',E/'audits/final-static/report.md',E/'audits/final-recheck/report.md',E/'audits/final-contract-review.md',E/'audits/final-contract-recheck.md']
errors=[]; nlinks=0
for p in files:
    t=p.read_text(); fence=None; width=None; visible=[]
    assert t.endswith('\n'),p
    for no,line in enumerate(t.splitlines(),1):
        fm=re.match(r'^\s*(`{3,}|~{3,})',line)
        if fm:
            m=fm[1]
            if fence is None: fence=m
            elif m[0]==fence[0] and len(m)>=len(fence): fence=None
            visible.append(''); width=None; continue
        if fence: visible.append(''); continue
        visible.append(line)
        if re.match(r'^\s*(<{7}|={7}|>{7})(\s|$)',line): errors.append((str(p),no,'conflict'))
        if line.startswith('|'):
            w=len(re.split(r'(?<!\\)\|',line.strip())[1:-1])
            if width is not None and width!=w: errors.append((str(p),no,'table width'))
            width=w
        else: width=None
    if fence: errors.append((str(p),'fence'))
    text='\n'.join(visible)
    for m in re.finditer(r'!?\[[^\]\n]*\]\(',text):
        i=m.end(); j=i; depth=1
        while j<len(text) and depth:
            if text[j]=='(' and (not j or text[j-1]!='\\'): depth+=1
            if text[j]==')' and (not j or text[j-1]!='\\'): depth-=1
            j+=1
        if depth: errors.append((str(p),'unclosed link')); continue
        u=text[i:j-1].strip().strip('<>')
        if re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:',u): continue
        dest,_,frag=u.partition('#'); q=(p.parent/urllib.parse.unquote(dest)).resolve() if dest else p
        nlinks+=1
        if not q.exists(): errors.append((str(p),u,'missing'))
        elif frag and re.fullmatch(r'L\d+(?:-L?\d+)?',frag):
            if int(re.findall(r'\d+',frag)[-1])>len(q.read_text().splitlines()): errors.append((str(p),u,'line anchor'))
        elif frag and q.suffix=='.md':
            slugs=[]; count=Counter()
            for h in re.findall(r'^#{1,6}\s+(.+?)\s*#*$',q.read_text(),re.M):
                s=re.sub(r'[^\w\-\s]','',h.replace('`','').lower()).replace(' ','-'); n=count[s]; count[s]+=1; slugs.append(s+('-'+str(n) if n else ''))
            if urllib.parse.unquote(frag) not in slugs: errors.append((str(p),u,'heading anchor'))
assert '最终独立检查进行中' not in (E/'validation.md').read_text()
assert '物理绝对路径' in (E/'README.md').read_text()
copied=0; json_count=0
for src,dest in [(Path('/tmp/axiom-runtime-final-static'),E/'audits/final-static'),(Path('/tmp/axiom-runtime-final-recheck'),E/'audits/final-recheck')]:
    for p in dest.iterdir():
        if not p.is_file(): continue
        assert p.read_bytes()==(src/p.name).read_bytes(),p
        copied+=1
        if p.suffix=='.json':
            def unique(pairs):
                d={}
                for k,v in pairs:
                    assert k not in d,k
                    d[k]=v
                return d
            json.loads(p.read_text(),object_pairs_hook=unique); json_count+=1
for src,dest in [(Path('/tmp/axiom-runtime-final-review.md'),E/'audits/final-contract-review.md'),(Path('/tmp/axiom-runtime-final-prose-recheck.md'),E/'audits/final-contract-recheck.md')]:
    assert src.read_bytes()==dest.read_bytes(); copied+=1
result=dict(markdownFiles=len(files),localLinks=nlinks,archivedFilesVerified=copied,archivedJsonParsed=json_count,errors=errors)
Path('/tmp/axiom-runtime-final-targeted-results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(result,ensure_ascii=False))
assert not errors
