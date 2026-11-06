# CodeBuddy CLI 2.179.0：bounded 静态证据（2026-11-06）

## 来源与边界

- 官方安装产物：[codebuddy-headless.js](/Users/dane/.local/share/codebuddy-cli/2.179.0/lib/node_modules/@tencent-ai/codebuddy-code/dist/codebuddy-headless.js)，28227431 bytes。
- SHA256：`dfba8dc057a592d1428ed2db9554aa3d5640674c9e98d794f1cce1783be5afa8`。
- 仅 Python mmap 定点字符串定位/少量窗口读取；没有执行或导入 CLI、联网、读取凭据、修改实现。所有偏移为原文件 **0-based byte、右端不含**；代码块为原始连续切片，不补写省略号。
- 本文件不证明实际发送、服务器接受图片或当前 worker/UI 已加载；旧 full bundle parser 窗口不能代替此 headless 路径。

## 可行动结论

修复前 [request.ts](../../../app/src/native-providers/codebuddy/request.ts) 的 `content(..., tool=true)` 拒绝图片工具结果。下面正规化分支则可得到 `role:"tool", tool_call_id:原ID, content:[{type:"image_url",image_url:{...options,url}}]`；角色与call配对保留，文本块不因此消失。这是结构推导，非 wire 捕获。

**不要把 hoist 无条件用于 CN 产品网关。** §2 明确要求目标不是 product-gateway，且 custom-context/plugin 匹配，才执行 §3。网关先经 direct/relay/omit 图片投影；direct 情况可保留 tool 内 image_url。模型投影选择、实际网关接受性仍需单列验证。

§5 明确客户端预赋 run ID 是小写32hex UUIDv7；§4 是实现依据。§6 证明调用ID与有效run身份、官方session.id的头映射，不能作为复用宿主ID的授权。建议 provider-owned 映射；官方 session.id 最初创建点与全部恢复生命周期尚未追完。另修复前 request.ts 存在无关header透传，本轮已改显式白名单（验证结果见REPORT.md）。

## 原始切片

### 1. tool 图片正规化（保持 tool 角色）

字节 `[7382090, 7382615)`：

```js
async normalizeMessageImages(eA){for(let el of eA){let eA;if(Array.isArray(el.content))eA=el.content;else{if("tool"!==el.role||"string"!=typeof el.content)continue;let ec=el.content.trim();if(!ec.startsWith("["))continue;try{eA=JSON.parse(ec)}catch{continue}}if(!Array.isArray(eA))continue;let ec=!1;for(let el=0;el<eA.length;el++){let ed=await resolveImagePart(eA[el],this.imagePartDeps);ed&&(eA[el]="text"in ed?{type:"text",text:ed.text}:{type:"image_url",image_url:{...ed.options,url:ed.url}},ec=!0)}ec&&(el.content=eA)}}}
```

### 2. product-gateway 分流

字节 `[7394721, 7395461)`：

```js
let eE=(0,mF.v2)(ey),ew=el.purpose===AW.AgentPurpose.ViewImage&&"relay"===eE?"direct":eE,eC=await projectImageContextForRequest(eu,ew,eh,eg),ev={modelId:eu.model??"",requestModelId:em,modelConfig:ey,supportsImages:ey.supportsImages,enableToolMediaHoist:(0,oS.isCustomModelRequestContext)({modelId:eu.model??"",modelConfig:ey,requestModelId:em}),thinkingEnabled:!1},eb=new g$.CustomModelToolMediaHoistPlugin,e_=(0,oS.collectProductGatewayDomains)(ef,["function"==typeof ep.getEndpoint?ep.getEndpoint():void 0,process.env[s1.ENV_KEY_CODEBUDDY_BASE_URL]]);if(!(0,oS.isProductGatewayHost)((0,oS.parseHost)(el.url),e_)&&eb.matches(ev)){let eA={...eC};eb.apply(eA,ev),eA.messages!==eC.messages&&(eC=eA)}return eC===eu?eA:ed?JSON.stringify(eC):eC}
```

### 3. 非网关 custom-context hoist

字节 `[15001002, 15002255)`：

```js
el.TOOL_MEDIA_HOIST_USER_TEXT="Attached image(s) from tool result:",el.TOOL_MEDIA_HOIST_PLACEHOLDER="(see attached image)",el.TOOL_MEDIA_OMITTED_NOTE="[image omitted: model does not support image input]";let CustomModelToolMediaHoistPlugin=class CustomModelToolMediaHoistPlugin{constructor(){this.name="custom-model-tool-media-hoist"}matches(eA){return!0===eA.enableToolMediaHoist}apply(eA,ec){if(!Array.isArray(eA.messages))return;let ed=!1!==ec.supportsImages,eu=eA.messages,ep=[],eh=!1,eg=0;for(;eg<eu.length;){let eA=eu[eg];if(eA?.role!=="tool"){ep.push(eA),eg++;continue}let ec=[],ef=eg;for(;ef<eu.length&&eu[ef]?.role==="tool";ef++){let eA=eu[ef];if(Array.isArray(eA.content)){let eu=[],ep=!1;for(let el of eA.content){let eA=this.toImageUrlPart(el);if(eA){ed&&ec.push(eA),ep=!0;continue}if("string"==typeof el?.text){eu.push(el.text);continue}eu.push("string"==typeof el?el:JSON.stringify(el))}ep&&(eA={...eA,content:eu.join("\n")||(ed?el.TOOL_MEDIA_HOIST_PLACEHOLDER:el.TOOL_MEDIA_OMITTED_NOTE)},eh=!0)}ep.push(eA)}ec.length>0&&(ep.push({role:"user",content:[{type:"text",text:el.TOOL_MEDIA_HOIST_USER_TEXT},...ec]}),eh=!0),eg=ef}eh&&(eA.messages=ep)}toImageUrlPart(eA){if(eA&&"object"==typeof eA&&"image_url"===eA.type&&eA.image_url)return eA}}
```

### 4a. UUIDv7 导出

字节 `[26357046, 26357070)`：

```js
ec.d(el,{nH:()=>uuidv7})
```

### 4b. UUIDv7 版本位/variant 与字段编码

字节 `[26357491, 26357772)`：

```js
let eu=new Uint8Array(16);return eu[0]=eA/0x10000000000,eu[1]=eA/0x100000000,eu[2]=eA/0x1000000,eu[3]=eA/65536,eu[4]=eA/256,eu[5]=eA,eu[6]=112|el>>>8,eu[7]=el,eu[8]=128|ec>>>24,eu[9]=ec>>>16,eu[10]=ec>>>8,eu[11]=ec,eu[12]=ed>>>24,eu[13]=ed>>>16,eu[14]=ed>>>8,eu[15]=ed,new UUID(eu)
```

### 4c. UUIDv7 时间与单调计数

字节 `[26359833, 26360614)`：

```js
generate(){return this.generateOrResetWithTs(Date.now())}generateOrAbort(){return this.generateOrAbortWithTs(Date.now())}generateOrResetWithTs(eA){let el=this.generateOrAbortWithTs(eA);return void 0===el&&(this.timestampBiased=0,el=this.generateOrAbortWithTs(eA)),el}generateOrAbortWithTs(eA){let el=0x3ffffffffff;if(!Number.isInteger(eA)||eA<0||eA>0xffffffffffff)throw RangeError("`unixTsMs` must be a 48-bit unsigned integer");if(++eA>this.timestampBiased)this.timestampBiased=eA,this.resetCounter();else{if(!(eA+this.rollbackAllowance>=this.timestampBiased))return;this.counter++,this.counter>el&&(this.timestampBiased++,this.resetCounter())}return UUID.fromFieldsV7(this.timestampBiased-1,Math.trunc(this.counter/0x40000000),this.counter&0x40000000-1,this.random.nextUint32())}
```

### 4d. UUIDv7 最终字符串入口

字节 `[26361863, 26361952)`：

```js
let uuidv7=()=>uuidv7obj().toString(),uuidv7obj=()=>(ed||(ed=new V7Generator)).generate()
```

### 5. conversationRequestId 格式与生成

字节 `[15487734, 15488317)`：

```js
let n2="codebuddy.ai/conversationRequestId",n3="conversationRequestIdCandidate",n4=/^[0-9a-f]{12}7[0-9a-f]{3}[89ab][0-9a-f]{15}$/;let ConversationRequestIdError=class ConversationRequestIdError extends TypeError{constructor(){super(...arguments),this.name="ConversationRequestIdError"}};function assertClientConversationRequestId(eA){if("string"!=typeof eA||!n4.test(eA))throw new ConversationRequestIdError("conversationRequestId must be a lowercase UUIDv7 encoded as 32 hexadecimal characters");return eA}function generateConversationRequestId(){return(0,tJ.nH)().replace(/-/g,"")}
```

### 6a. 每模型调用 ID

字节 `[6665912, 6666064)`：

```js
function withModelMessageCorrelation(eA,el,ec,ed){let snapshot=()=>{let eA=(0,ep.nH)().replace(/-/g,""),ed=(0,eu.getEffectiveConversationRequestId)(el),
```

### 6b. 上游头与身份关联

字节 `[7321720, 7322081)`：

```js
ek=eR?.messageId??(0,gV.nH)().replace(/-/g,""),eD=eR?eR.conversationRequestId:(0,AW.getEffectiveConversationRequestId)(eI),eT=eR?eR.purpose:(0,AW.getEffectiveAgentPurpose)(eI);eI.messageId=ek,eb[uH.CONVERSATION_ID_HEADER]=eI.id,eb[uH.CONVERSATION_REQUEST_ID_HEADER]=eD||"",eb[uH.CONVERSATION_MESSAGE_ID_HEADER]=eI.messageId,eb[uH.REQUEST_ID_HEADER]=eI.messageId
```

## 后续与未验

本轮已完成离线图片工具结果、多工具完整配对、续轮、headers 白名单及 provider-owned ID 测试；当前验收见[REPORT](REPORT.md)。旧 claims 不复用。本次未运行测试或实发；仅静态检索命令 exit0。已有 parser/失败历史见 [parity](../../codebuddy-native-parity.md)、[协议矩阵](../codebuddy-native-component-01/PROTOCOL-MATRIX.md)。

## 补证：session.id 默认创建格式

定位 `ng` 的 `async create(eA)`（字节15442422），不是猜测constructor。默认session.id为**带横线、小写UUIDv7（36字符）**；显式传入id则保留，不能外推所有恢复/自定义会话。调用链：

- `[15369630, 15369642)`：`tJ=ec(34506)`，模块34506见§4a。
- `[15442704, 15442726)`：`id:eA?.id??(0,tJ.nH)()`。
- `[26358571, 26358752)`：
```js
toString(){let eA="";for(let el=0;el<this.bytes.length;el++)eA+=eu.charAt(this.bytes[el]>>>4),eA+=eu.charAt(15&this.bytes[el]),(3===el||5===el||7===el||9===el)&&(eA+="-");return eA}
```

§4d调用此toString；字节3/5/7/9后插入横线，字符表为小写hex（字节26357010起模块头：`let eu="0123456789abcdef"`）。对比§5：run ID显式去横线；session创建此处没有replace。共展示7个静态窗口，静态命令exit0；无CLI执行、凭据或网络访问。
