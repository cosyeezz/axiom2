#!/usr/bin/env node
// Render and structurally verify research evidence; never imports product modules.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const output = process.argv[2] ? path.resolve(process.argv[2]) : here;
const inventory = JSON.parse(fs.readFileSync(path.join(here,"pi-coupling-inventory.json"),"utf8"));
const matrixBytes = fs.readFileSync(path.join(here,"capability-matrix.json"));
const matrix = JSON.parse(matrixBytes);
const digest = b => crypto.createHash("sha256").update(b).digest("hex");
const sourcePath = f => f.startsWith("shared/") || f.startsWith("client/") ? `app/src/${f}` : `app/src/server/${f}`;
const sourceRefs = row => row[5].split(",").map(sourcePath);
const relative = f => path.relative(output,path.join(root,f)).split(path.sep).join("/");
const link = (file,label = file.replace(/^app\/src\//,""),line) => `[${label}](${relative(file)}${line ? `#L${line}` : ""})`;
const escape = s => String(s).replaceAll("|","\\|").replaceAll("\n"," ");
const countBy = (xs,key) => Object.fromEntries([...new Set(xs.map(key))].sort().map(k=>[k,xs.filter(x=>key(x)===k).length]));
const rows = matrix.domains.flatMap(g=>g.rows);
assert.equal(new Set(rows.map(r=>r[0])).size,rows.length,"duplicate capability IDs");
const byFile = new Map();
for (const g of matrix.domains) for (let i=0;i<g.rows.length;i++) {
  const r=g.rows[i];
  assert.equal(r.length,matrix.columns.length,`column count: ${r[0]}`);
  assert.equal(r[0],`${g.id}${String(i+1).padStart(2,"0")}`,"nonsequential ID");
  assert.ok(matrix.owners[r[2]],`unknown owner ${r[2]}`);
  assert.ok(matrix.states[r[3]],`unknown state ${r[3]}`);
  assert.ok(r[4] && r[6],`missing semantics/port: ${r[0]}`);
  for (const f of sourceRefs(r)) {
    assert.ok(fs.statSync(path.join(root,f)).isFile(),`missing source ${f}`);
    const ids=byFile.get(f)??[]; ids.push(r[0]); byFile.set(f,ids);
  }
}
const coupled=inventory.fileModes.map(f=>f.file);
const uncovered=coupled.filter(f=>!byFile.has(f));
assert.deepEqual(uncovered,[],"unclassified direct Pi files");
assert.equal(inventory.sites.length,inventory.summary.moduleSites);
assert.equal(inventory.bindings.length,inventory.summary.importedBindings);
const sourceByPath = new Map(inventory.files.map(f=>[f.path,f]));
const changedEvidence = [...byFile.keys()].filter(f => sourceByPath.has(f) && digest(fs.readFileSync(path.join(root,f))) !== sourceByPath.get(f).sha256);
assert.deepEqual(changedEvidence,[],"evidence sources changed since saved scan; review changes and rescan");
const summary={
  capabilityCount: rows.length,
  domains: matrix.domains.map(g=>({ id:g.id,name:g.name,count:g.rows.length })),
  owners: countBy(rows,r=>r[2]), states: countBy(rows,r=>r[3]),
  evidenceFiles: byFile.size, directPiFiles: coupled.length, classifiedDirectPiFiles: coupled.length-uncovered.length, uncoveredDirectPiFiles: uncovered,
  sourceManifestHash: inventory.summary.sourceManifestHash,
  matrixSha256: digest(matrixBytes),
  limitations: ["Capability rows are manually normalized semantic boundaries, not method count or implementation percentage.","Coverage means every direct Pi-reference file is classified by at least one capability; it does not prove exhaustive behavior, tests or dataflow coverage.","Status live means source-visible product path, never runtime validation in this audit."]
};
fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(path.join(output,"capability-summary.json"),JSON.stringify(summary,null,2)+"\n");
const md=["# Axiom 运行时抽象能力完整矩阵","","> 由 capability-matrix.json 生成；只做静态研究。接口族名称是建议边界，不表示已实现中性接口。", "",`归一化 **${rows.length} 项 / ${matrix.domains.length} 域**，来源文件 **${byFile.size}**；${coupled.length} 个直接 Pi 引用文件全部有分类。分类覆盖不是行为测试覆盖率。`,"",`源码 manifest SHA256：\`${summary.sourceManifestHash}\`；矩阵 SHA256：\`${summary.matrixSha256}\`。`,"","## 口径","",matrix.countingUnit,"","主责是应该收口的依赖边界，不表示整份来源文件搬迁。协作授权、事实源和失败约束仍按每项语义留在宿主。当前所有统一端口均是设计建议，live 指已有业务路径的原生实现。","","| 状态 | 项数 | 含义 |","| --- | ---: | --- |",...Object.entries(summary.states).map(([k,n])=>`| ${k} | ${n} | ${matrix.states[k]} |`),"","| 主责边界 | 项数 |","| --- | ---: |",...Object.entries(summary.owners).map(([k,n])=>`| ${matrix.owners[k]} | ${n} |`)];
for (const g of matrix.domains) {
  md.push("",`## ${g.id}. ${g.name}（${g.rows.length}）`,"","| ID | 能力 | 主责 | 现状 | 建议接口族 | 关键语义 | 源码证据 |","| --- | --- | --- | --- | --- | --- | --- |");
  for (const r of g.rows) md.push(`| ${r[0]} | ${escape(r[1])} | ${matrix.owners[r[2]]} | ${r[3]} | \`${r[4]}\` | ${escape(r[6])} | ${sourceRefs(r).map(f=>link(f)).join("、")} |`);
}
fs.writeFileSync(path.join(output,"capability-matrix.md"),md.join("\n")+"\n");
const append=["# Pi 依赖文件与符号全量附录","","> 自动生成的识别范围：app/src 下的当前代码，排除 vite-cache/node_modules/.git。包含未提交文件；不包含测试及仓库外资源。这里只是语法依赖，不是完整运行时调用图。","",`HEAD：\`${inventory.summary.head}\`；Pi coding-agent：\`${inventory.summary.piCodingAgentVersion}\`。`,"",`源码 manifest SHA256：\`${inventory.summary.sourceManifestHash}\`。`,"","## 1. 直接依赖文件（去重）","",`共 **${coupled.length}** 个。type/value 为源码显式声明，不代表编译擦除、实际执行或该文件没有实例方法调用。能力列按人工矩阵的来源映射。`,"","| 文件 | 显式依赖分类 | 字面量模块引用点 | 包 | 能力ID |","| --- | --- | ---: | --- | --- |"];
for (const f of inventory.fileModes) append.push(`| ${link(f.file)} | ${f.mode} | ${f.sites} | ${f.packages.map(p=>p.replace("@earendil-works/","")).join("、")} | ${(byFile.get(f.file)??[]).join("、")} |`);
append.push("","## 2. 导入符号全量表","",`共 **${inventory.summary.uniquePackageSymbols}** 个包内去重符号，**${inventory.summary.importedBindings}** 个本地导入绑定。下表声明数可求和；包/文件数存在交集不得跨包直接相加。直接调用/构造仅统计以导入绑定为根的语法引用，不包含session实例方法，更不是运行频率。`);
for (const p of inventory.summary.packages) {
  const bb=inventory.bindings.filter(b=>inventory.sites[b.siteId-1].package===p.package);
  append.push("",`### ${p.package}（${p.uniqueSymbols} 符号）`,"","| 导入名 | 绑定数 | type绑定 | value绑定 | 直接调用或构造引用 | 来源 |","| --- | ---: | ---: | ---: | ---: | --- |");
  for (const symbol of [...new Set(bb.map(b=>b.imported))].sort()) {
    const bindings=bb.filter(b=>b.imported===symbol), files=[...new Set(bindings.map(b=>b.file))].sort();
    const calls=bindings.flatMap(b=>b.references).filter(r=>r.kind==="call"||r.kind==="construct").length;
    append.push(`| \`${symbol}\` | ${bindings.length} | ${bindings.filter(b=>b.mode==="type").length} | ${bindings.filter(b=>b.mode==="value").length} | ${calls} | ${files.map(f=>link(f)).join("、")} |`);
  }
}
append.push("","## 3. 私有路径与非字面量补充","","下列是版本敏感的静态发现，不表示已测试模块加载；与上面的字面量包锚点有包含关系，不能简单加总为总调用数。","","| 来源 | 原生私有模块相对路径 |","| --- | --- |");
for (const p of inventory.summary.privateModulePaths) append.push(`| ${link(p.file,undefined,p.line)} | \`${p.relativePath}\` |`);
append.push("","| 来源 | 借用的 Pi 安装树第三方依赖 |","| --- | --- |");
for (const p of inventory.summary.borrowedDependencies) append.push(`| ${link(p.file,undefined,p.line)} | \`${p.dependency}\` |`);
append.push("","| 来源 | 计算式 resolve |","| --- | --- |");
for (const p of inventory.summary.computedResolutionSites) append.push(`| ${link(p.file,undefined,p.line)} | \`${p.expression.replaceAll("`","'")}\` |`);
append.push("","## 4. 可解析语法图的间接反向依赖","",`图闭包 **${inventory.summary.sourceImportGraph.piReachableFiles} = ${coupled.length} 直接 + ${inventory.summary.sourceImportGraph.indirectlyReachableFiles} 间接**，含显式type-only和字面worker URL边；未穷尽本地import-type/require/别名/计算路径。以下仅列没有直接Pi引用的可达文件，不是应整体搬进adapter的文件清单。`,"",...inventory.piReachableFiles.filter(f=>!coupled.includes(f)).map(f=>`- ${link(f)}`),"","完整边、模块锚点、引用位置及字节hash见同目录 pi-coupling-inventory.json；所有语义计数见 capability-summary.json。");
fs.writeFileSync(path.join(output,"pi-coupling-appendix.md"),append.join("\n")+"\n");
console.log(JSON.stringify(summary,null,2));
