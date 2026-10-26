import { n as __name } from "./chunk-Y2CYZVJY-C2ZLz3hV.js";
import { R as select_default } from "./src-BEUNmVuZ.js";
import { b as getConfig2 } from "./chunk-DSNLSHJZ-BQJBHMMB.js";
//#region F:/Axiom/axiom2/app/node_modules/mermaid/dist/chunks/mermaid.core/chunk-OYAV6JZA.mjs
var selectSvgElement = /* @__PURE__ */ __name((id) => {
	const { securityLevel } = getConfig2();
	let root = select_default("body");
	if (securityLevel === "sandbox") {
		const doc = select_default(`#i${id}`).node()?.contentDocument ?? document;
		root = select_default(doc.body);
	}
	return root.select(`#${id}`);
}, "selectSvgElement");
//#endregion
export { selectSvgElement as t };
