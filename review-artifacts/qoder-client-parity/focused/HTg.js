function HTg(A){return"string"==typeof A?A:A.map(A=>{if("text"!==A.type)throw new Error(`Remote Chat 系统消息不支持 ${A.type} 内容块。`);return A.text}).join("")}
