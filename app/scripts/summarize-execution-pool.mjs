// Aggregate immutable benchmark artifacts; never starts workers or changes source builds.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
const root=resolve(process.argv[2]||'test-results/execution-pool');
const read=name=>JSON.parse(readFileSync(join(root,name),'utf8'));
const q=(values,p)=>{const a=values.filter(Number.isFinite).sort((a,b)=>a-b);return a.length?a[Math.ceil(a.length*p)-1]:null;};
const stats=rows=>({count:rows.length,prepareP50:q(rows.map(s=>s.prepareMs),.5),prepareP95:q(rows.map(s=>s.prepareMs),.95),firstOutputP50:q(rows.map(s=>s.firstOutputMs),.5),firstOutputP95:q(rows.map(s=>s.firstOutputMs),.95)});
const files=readdirSync(root).filter(n=>/^[ABCD]-v3-batch[123]\.json$/.test(n)).sort();
const reports=files.map(file=>({file,...read(file)}));
const matrix={};
for(const label of ['A','B','C','D']){
  const groups=reports.filter(r=>r.label===label),rows=groups.flatMap(r=>r.samples);
  matrix[label]={batches:groups.map(g=>({file:g.file,status:g.status,summary:g.summary,error:g.error})),scenarios:{}};
  for(const scenario of [...new Set(rows.map(s=>s.scenario))]){
    const selected=rows.filter(s=>s.scenario===scenario);
    matrix[label].scenarios[scenario]={...stats(selected),hits:Object.fromEntries([...new Set(selected.map(s=>s.acquired?.hit||'baseline'))].map(hit=>[hit,stats(selected.filter(s=>(s.acquired?.hit||'baseline')===hit))]))};
  }
  matrix[label].resources=groups.flatMap(g=>g.resources.map(r=>({file:g.file,parentCpuMs:r.parentCpuMs,childCpuMs:r.children.length===(r.finalPool?.created??69)?r.childCpuMs:null,observedChildCpuMs:r.childCpuMs,probeComplete:r.children.length===(r.finalPool?.created??69),probeCount:r.children.length,created:r.finalPool?.created??69,peakWorkerCount:r.peakWorkerCount,peakRssSumBytes:r.peakRssSumBytes,idleResources:r.idleResources,finalPool:r.finalPool})));
}
const arrivals=readdirSync(root).filter(n=>/^[CD]-arrival-(memory|agent)-[123]\.json$/.test(n)).map(file=>({file,...read(file)}));
const arrivalGroups={};
for(const mode of ['C','D'])for(const scenario of ['memory','agent-process']){
  const groups=arrivals.filter(r=>r.mode===mode&&r.scenario===scenario),rows=groups.flatMap(r=>r.samples);
  if(!groups.length)continue;
  const measured=groups.flatMap(r=>r.metrics.slice(r.measurementMetricOffset).filter(m=>m.phase==='acquired'));
  arrivalGroups[`${mode}/${scenario}`]={batches:groups.length,...stats(rows.filter(s=>s.status==='completed')),failed:rows.filter(s=>s.status!=='completed').length,arrivalLagP95:q(rows.map(s=>s.arrivalLagMs),.95),hits:Object.fromEntries([...new Set(measured.map(m=>m.hit))].map(hit=>[hit,measured.filter(m=>m.hit===hit).length])),resources:groups.map(r=>({file:r.file,status:r.status,...r.resources,workers:undefined}))};
}
const matrixIssues=[];
for(const label of ['A','B','C','D'])for(let batch=1;batch<=3;batch++){
  const file=`${label}-v3-batch${batch}.json`,r=reports.find(r=>r.file===file);
  if(!r){matrixIssues.push(`${file}: missing`);continue;}
  if(r.measurementVersion!==3||r.label!==label||r.status!=='completed')matrixIssues.push(`${file}: invalid version, label or status`);
  const expected={'agent-cold':34,'agent-affinity':68,memory:['A','B'].includes(label)?34:68,...(['C','D'].includes(label)?{'agent-process':68}:{})};
  if(r.failedSample||r.samples.some(s=>s.status!=='completed'||!Number.isFinite(s.prepareMs)||!Number.isFinite(s.firstOutputMs)))matrixIssues.push(`${file}: failed or incomplete samples`);
  if(r.samples.length!==Object.values(expected).reduce((a,b)=>a+b,0)||Object.entries(expected).some(([scenario,count])=>r.samples.filter(s=>s.scenario===scenario).length!==count))matrixIssues.push(`${file}: incorrect scenario counts`);
}
const complete=matrixIssues.length===0;
const supplementalNames=readdirSync(root).filter(name=>/^(?:[BCD]-compression|managed-control|D-arrival-pressure|[BD]-(?:scan|tree)-(?:affinity-[123]|scale|paths)|[BD]-scale)\.json$/.test(name)).sort();
const summarizeArtifact=(file)=>{
  const r=read(file), rows=[...(r.samples??r.fixtures?.flatMap(f=>f.samples)??[]),...(r.failedSample?[r.failedSample]:[])];
  const resources=(Array.isArray(r.resources)?r.resources:r.resources?[r.resources]:r.fixtures?.map(f=>({...f.resourceUsage,finalPool:f.finalPool}))??[]).map(resource=>{
    const children=resource.children??resource.workers??[];
    const baselineExpected=r.kind==='scale-trend'?1:r.arguments?.scenarios?.split(',').reduce((count,scenario)=>count+(scenario==='agent-affinity'?1:scenario==='compression'?2*Number(r.arguments.samples||100):['agent-cold','memory'].includes(scenario)?Number(r.arguments.samples||100):NaN),0);
    const expected=resource.finalPool?.created??baselineExpected;
    const valid=resource.valid!==false&&children.length>0&&Number.isFinite(expected)&&children.length===expected&&children.every(c=>Number.isFinite(c.cpuMs)&&Number.isFinite(c.maxRSSBytes));
    return {valid,parentCpuMs:resource.parentCpuMs,childCpuMs:valid?resource.childCpuMs:null,observedChildCpuMs:resource.childCpuMs,probeCount:children.length,created:expected??null,peakWorkerCount:resource.peakWorkerCount,peakRssSumBytes:resource.peakRssSumBytes,finalPool:resource.finalPool,idleResources:resource.idleResources};
  });
  return {file,status:r.status,error:r.error,build:r.build??r.source,hashes:r.hashes,probeSha256:r.probeSha256,launched:rows.length,successful:rows.filter(s=>s.status==='completed').length,failed:rows.filter(s=>s.status!=='completed').length,notAtProvider:rows.filter(s=>!s.requests).length,resourceValid:resources.length>0&&resources.every(s=>s.valid),resources,scenarios:Object.fromEntries([...new Set(rows.map(s=>s.scenario??r.scenario??'scale'))].map(scenario=>[scenario,stats(rows.filter(s=>(s.scenario??r.scenario??'scale')===scenario&&s.status==='completed'))])),arrivalLagP95:q(rows.map(s=>s.arrivalLagMs),.95)};
};
const supplemental=supplementalNames.map(summarizeArtifact);
const arrivalBatches=arrivals.map(r=>summarizeArtifact(r.file));
const aggregate={generatedAt:new Date().toISOString(),matrixComplete:complete,matrixIssues,matrix,arrivalGroups,arrivalBatches,supplemental};
writeFileSync(join(root,'aggregate.json'),JSON.stringify(aggregate,null,2));
const ms=n=>n===null?'—':n.toFixed(1),mib=n=>(n/1048576).toFixed(1);
const lines=['# 执行池生产基准', '',`生成时间：${aggregate.generatedAt}。主矩阵${complete?'三批完成':'尚未完成，仅为阶段性结果'}。`, '', '所有时间单位为毫秒；准备端点为本地 mock HTTP 收到请求。Agent 首输出为首条可见 assistant 文本，记忆和压缩为结果返回。A/B为独立冻结构建，C/D共用pooled-final构建。', '', '主表只汇总measurementVersion 3的交错三批。较早A-main在记忆第80次后异常退出，B-main及小样本冒烟也使用不同批次／口径；这些原始产物保留，但不混入本次统计，不能作为完整通过证据。', '', '| 组 | 场景 | 样本 | 准备P50 | 准备P95 | 首输出P50 | 首输出P95 |', '| --- | --- | ---: | ---: | ---: | ---: | ---: |'];
for(const [label,g]of Object.entries(matrix))for(const [scenario,s]of Object.entries(g.scenarios))lines.push(`| ${label} | ${scenario} | ${s.count} | ${ms(s.prepareP50)} | ${ms(s.prepareP95)} | ${ms(s.firstOutputP50)} | ${ms(s.firstOutputP95)} |`);
lines.push('','## 批间差异','','合并分位数不能替代逐批检查；尤其保留亲和路径中位数和第二批P95的回归。','','| 文件 | 状态 | 场景 | 样本 | 准备P50 | 准备P95 |','| --- | --- | --- | ---: | ---: | ---: |');
for(const r of reports)for(const [scenario,s]of Object.entries(r.summary))lines.push(`| ${r.file} | ${r.status} | ${scenario} | ${s.count} | ${ms(s.prepareP50)} | ${ms(s.prepareP95)} |`);
if(matrixIssues.length)lines.push('',...matrixIssues.map(issue=>`- 完整性检查：${issue}`));
lines.push('','## 实际命中分类','','类别来自请求入口与进程／环境ready时间的比较；借用时的source字段不等于请求前命中。小样本分位数只用于诊断。','','| 组 | 场景 | 类别 | 样本 | 准备P50 | 准备P95 |','| --- | --- | --- | ---: | ---: | ---: |');
for(const[label,g]of Object.entries(matrix))for(const[scenario,s]of Object.entries(g.scenarios))for(const[hit,h]of Object.entries(s.hits))lines.push(`| ${label} | ${scenario} | ${hit} | ${h.count} | ${ms(h.prepareP50)} | ${ms(h.prepareP95)} |`);
lines.push('','## 固定到达','','按绝对计划时间启动，不等待上个任务或预热完成。失败计数单独保留；延迟统计针对成功请求，须连同失败率读取。','','| 组/场景 | 批次 | 成功 | 失败 | 准备P50 | 准备P95 | 到达偏差P95 |','| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
for(const[key,s]of Object.entries(arrivalGroups))lines.push(`| ${key} | ${s.batches} | ${s.count} | ${s.failed} | ${ms(s.prepareP50)} | ${ms(s.prepareP95)} | ${ms(s.arrivalLagP95)} |`);
lines.push('','### 固定到达逐批结果','','请求成功与整批／资源状态分别列出；资源失效、清理失败不能由请求成功数掩盖。','','| 文件 | 批状态/资源有效 | 成功/失败 | 准备P50/P95 | 到达偏差P95 |','| --- | --- | ---: | ---: | ---: |');
for(const r of arrivalBatches){const s=Object.values(r.scenarios)[0];lines.push(`| ${r.file} | ${r.status}/${r.resourceValid} | ${r.successful}/${r.failed} | ${ms(s?.prepareP50??null)}/${ms(s?.prepareP95??null)} | ${ms(r.arrivalLagP95)} |`);}
lines.push('','## 资源成本','','主矩阵旧探针按PID命名，Windows复用PID会覆盖旧记录；子CPU缺少完整进程记录时显示“—”，原始部分值只保留作诊断，不用于资源放行。固定到达补测使用每次启动独立的探针ID。主矩阵C/D包含额外跨会话场景且记忆样本更多，因此组间总CPU不能直接当作同工作量对比。固定到达的同场景C/D才具有相同请求量和节奏。RSS是跨进程合计，含共享页；250ms峰值采样可能漏掉短峰值。空闲CPU窗口只有约1秒，CPU包含100ms周期探针自身开销，不能视为未插桩产品的精确空闲成本；Node句柄数不是OS句柄数。','','| 文件 | 父/子CPU ms | 峰值worker | 峰值RSS MiB | 空闲worker/RSS MiB |','| --- | ---: | ---: | ---: | ---: |');
for(const g of Object.values(matrix))for(const r of g.resources)lines.push(`| ${r.file} | ${ms(r.parentCpuMs)}/${ms(r.childCpuMs)} | ${r.peakWorkerCount} | ${mib(r.peakRssSumBytes)} | ${r.idleResources?.workerCount??'—'}/${mib(r.idleResources?.rssSumBytes??0)} |`);
for(const g of Object.values(arrivalGroups))for(const r of g.resources)lines.push(`| ${r.file} | ${ms(r.parentCpuMs)}/${ms(r.childCpuMs)} | ${r.peakWorkerCount} | ${mib(r.peakRssSumBytes)} | — |`);
lines.push('','## 历史与资源规模趋势','','每个夹具4次请求，首请求与后续请求分别列出；这些小样本不用于P95放行。','','| 组 | JSONL MiB/行数 | 技能数/资源KiB | 首请求准备ms | 后三次准备中位数ms | 峰值worker/RSS MiB |','| --- | ---: | ---: | ---: | ---: | ---: |');
for(const name of ['B-scale','D-scale','D-scan-scale','D-tree-scale'])if(existsSync(join(root,`${name}.json`))){const r=read(`${name}.json`);for(const f of r.fixtures)lines.push(`| ${name} | ${mib(f.jsonlBytes)}/${f.jsonlLines} | ${f.resources}/${(f.fixtureResourcesBytes/1024).toFixed(1)} | ${ms(f.samples[0]?.prepareMs??null)} | ${ms(q(f.samples.slice(1).map(s=>s.prepareMs),.5))} | ${f.resourceUsage?.peakWorkerCount??'—'}/${mib(f.resourceUsage?.peakRssSumBytes??0)} |`);}
lines.push('','## 补充与优化候选','','scan对应独立pooled-scan构建，tree对应后续独立pooled-tree构建；它们不混入首轮矩阵。压缩每组5次只作趋势，CPU还包含建立输入的Agent请求。压力为40次25ms间隔的短突发，不能解释为持续吞吐能力。规模场景的总分位数没有业务可比性，详见上面的逐夹具表。','','| 文件 | 批状态/资源有效 | 成功/失败 | 场景 | 准备P50/P95 | 首输出P50/P95 |','| --- | --- | ---: | --- | ---: | ---: |');
for(const r of supplemental)for(const [scenario,s]of Object.entries(r.scenarios))if(scenario!=='scale')lines.push(`| ${r.file} | ${r.status}/${r.resourceValid} | ${r.successful}/${r.failed} | ${scenario} | ${ms(s.prepareP50)}/${ms(s.prepareP95)} | ${ms(s.firstOutputP50)}/${ms(s.firstOutputP95)} |`);
lines.push('','| 文件 | 父/子CPU ms | 探针/创建 | 采样worker/池峰值 | 峰值RSS MiB | 关闭后池总数 |','| --- | ---: | ---: | ---: | ---: | ---: |');
for(const r of supplemental)for(const resource of r.resources)lines.push(`| ${r.file} | ${ms(resource.parentCpuMs??null)}/${ms(resource.childCpuMs)} | ${resource.probeCount}/${resource.created??'未知'} | ${resource.peakWorkerCount??'—'}/${resource.finalPool?.peak??'—'} | ${mib(resource.peakRssSumBytes??0)} | ${resource.finalPool?.total??'无池'} |`);
lines.push('','原始JSON保留构建路径/摘要、全部样本、每批统计、错误与资源探针。冻结构建不能被重新构建覆盖。当前报告不自动宣称性能门槛通过；需结合批间波动、实际命中样本数和补充验证作判断。','');
writeFileSync(join(root,'REPORT.md'),lines.join('\n'));
console.log(JSON.stringify({root,matrixComplete:complete,matrixReports:reports.length,arrivalReports:arrivals.length}));
