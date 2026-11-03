import ast, hashlib, json, pathlib, struct, sys, time
D=pathlib.Path(__file__).resolve().parent
t=time.monotonic(); c=time.process_time(); source=(D/'source.py').read_bytes()
tree=ast.parse(source); names={'signed','find_xrefs'}
nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in names]
assert len(nodes)==2
ns={'struct':struct}; exec(compile(ast.Module(body=nodes,type_ignores=[]),'pure-focused-helpers','exec'),ns)
xrefs=ns['find_xrefs']; rows=[]; base=0x100008ffc
# Independent synthetic encoder; address expectations are explicit mathematical ADR / page arithmetic.
def producer(delta,rd,page=False):
    imm=delta % 2097152
    return (0x90000000 if page else 0x10000000) + (imm%4)*536870912 + (imm//4)*32 + rd
def addition(imm,rn,rd,shift,bit23):
    return 0x91000000 + shift*4194304 + bit23*8388608 + imm*1024 + rn*32 + rd
def check(name,ws,target,want,reason):
    code=struct.pack('<'+'I'*len(ws),*ws); got=xrefs(code,base,target)
    rows.append({'name':name,'words':['%08x'%w for w in ws],'target':target,'expected':want,'actual':got,'oracleReason':reason,'status':'PASS' if got==want else 'FAIL'})
for rd in (0,30,31):
    for delta in (-4097,0,4097):
        want=[] if rd==31 else [{'va':base,'kind':'ADR'}]
        check('ADR_rd%d_delta%d'%(rd,delta),[producer(delta,rd)],base+delta,want,'ADR rd31 discards; rd0/30 retains PC-relative result')
for rd in (0,30,31):
    for pages in (-1,0,1):
        for shift in (0,1):
            for bit23 in (0,1):
                target=(base//4096)*4096+pages*4096+7*(4096 if shift else 1)
                want=[] if rd==31 or bit23 else [{'va':base,'addVA':base+4,'kind':'adjacent ADRP+ADD'}]
                check('ADRP_rd%d_pages%d_shift%d_bit23%d'%(rd,pages,shift*12,bit23),[producer(pages,rd,True),addition(7,rd,4,shift,bit23)],target,want,'rd31 result discarded and ADD rn31 means SP; bit23 conservatively outside ordinary ADD-immediate form; otherwise page result + immediate')
for rd in (0,30):
    for shift in (0,1):
        for bit23 in (0,1):
            target=(base//4096)*4096+4096+7*(4096 if shift else 1)
            check('SP_not_producer_rd%d_shift%d_bit23%d'%(rd,shift*12,bit23),[producer(1,rd,True),addition(7,31,4,shift,bit23)],target,[],'ADD rn31 reads SP, not preceding rd0/30')
for rd in (0,30):
    for shift in (0,1):
        target=(base//4096)*4096+4096+7*(4096 if shift else 1)
        check('ADD_destSP_from_rd%d_shift%d'%(rd,shift*12),[producer(1,rd,True),addition(7,rd,31,shift,0)],target,[{'va':base,'addVA':base+4,'kind':'adjacent ADRP+ADD'}],'ADD destination31 is SP; valid producer rn0/30 remains a dependency')
result={'sourceSHA256':hashlib.sha256(source).hexdigest(),'cases':len(rows),'passed':sum(r['status']=='PASS' for r in rows),'failed':sum(r['status']=='FAIL' for r in rows),'wallSeconds':time.monotonic()-t,'cpuSeconds':time.process_time()-c,'noMainExecuted':True,'onlySyntheticBinaryInputs':True,'results':rows}
(D/'extra-results.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='results'}))
sys.exit(1 if result['failed'] else 0)
