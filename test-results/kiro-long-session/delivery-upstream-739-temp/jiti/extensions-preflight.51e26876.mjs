"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.default = _default;
var _nodeFs = await jitiImport("node:fs");
var _nodePath = await jitiImport("node:path");
function _default(pi) {
  pi.on("context", (event, ctx) => (0, _nodeFs.existsSync)((0, _nodePath.join)(ctx.cwd, "block-request")) ?
  { messages: [null] } : { messages: event.messages });
} /* v9-12786afba520443c */
