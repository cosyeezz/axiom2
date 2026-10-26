import { n as __name } from "./chunk-Y2CYZVJY-C2ZLz3hV.js";
import { z as log } from "./src-BEUNmVuZ.js";
import { c as configureSvgSize } from "./chunk-DSNLSHJZ-BQJBHMMB.js";
import { t as selectSvgElement } from "./chunk-OYAV6JZA-DOldIzaa.js";
import { n as parse } from "./mermaid-parser.core-Dtdyo5ud.js";
//#region F:/Axiom/axiom2/app/node_modules/mermaid/dist/chunks/mermaid.core/infoDiagram-MVDRKAX5.mjs
var parser = { parse: /* @__PURE__ */ __name(async (input) => {
	const ast = await parse("info", input);
	log.debug(ast);
}, "parse") };
var DEFAULT_INFO_DB = { version: "12.2.0" };
var diagram = {
	parser,
	db: { getVersion: /* @__PURE__ */ __name(() => DEFAULT_INFO_DB.version, "getVersion") },
	renderer: { draw: /* @__PURE__ */ __name((text, id, version) => {
		log.debug("rendering info diagram\n" + text);
		const svg = selectSvgElement(id);
		configureSvgSize(svg, 100, 400, true);
		svg.append("g").append("text").attr("x", 100).attr("y", 40).attr("class", "version").attr("font-size", 32).style("text-anchor", "middle").text(`v${version}`);
	}, "draw") }
};
//#endregion
export { diagram };
