import { n as __name } from "./chunk-Y2CYZVJY-C2ZLz3hV.js";
import { z as log } from "./src-BEUNmVuZ.js";
import { s as common_default, y as getConfig } from "./chunk-DSNLSHJZ-BQJBHMMB.js";
import { f as interpolateToCurve } from "./chunk-7S6XSTFO-CUOQ4ARa.js";
import { t as insertLookDefs } from "./chunk-DUW6YSOI-D8f8AIGW.js";
import { o as labelHelper } from "./chunk-HAGFOTED-2bp6bH7p.js";
import { r as insertNode } from "./chunk-ZAUX2LTX-YU1Yy7gO.js";
import { r as insertCluster } from "./chunk-HNE4Q36P-BmwRqiww.js";
import { a as insertEdgeLabel, c as markers_default, i as insertEdge, l as positionEdgeLabel } from "./chunk-WQQL4CDK-DUG7jE6X.js";
//#region F:/Axiom/axiom2/app/node_modules/mermaid/dist/chunks/mermaid.core/chunk-EJLWFMJV.mjs
var internalHelpers = {
	common: common_default,
	getConfig,
	insertCluster,
	insertEdge,
	insertEdgeLabel,
	insertMarkers: markers_default,
	insertNode,
	interpolateToCurve,
	labelHelper,
	log,
	positionEdgeLabel
};
var ELK_ALGORITHMS = [
	"elk.stress",
	"elk.force",
	"elk.mrtree",
	"elk.sporeOverlap",
	"elk.box",
	"elk.rectpacking"
];
var layoutAlgorithms = /* @__PURE__ */ Object.create(null);
var registerLayoutLoaders = /* @__PURE__ */ __name((loaders) => {
	for (const loader of loaders) layoutAlgorithms[loader.name] = loader;
}, "registerLayoutLoaders");
var elkLayoutLoaders = /* @__PURE__ */ __name(() => {
	const loader = /* @__PURE__ */ __name(async () => await import("./elk-QONTBCTQ--n1mI5YB.js"), "loader");
	return [{
		name: "elk",
		loader,
		algorithm: "elk.layered"
	}, ...ELK_ALGORITHMS.map((algorithm) => ({
		name: algorithm,
		loader,
		algorithm
	}))];
}, "elkLayoutLoaders");
(/* @__PURE__ */ __name(() => {
	registerLayoutLoaders([
		{
			name: "dagre",
			loader: /* @__PURE__ */ __name(async () => await import("./dagre-NK4GIZVX-BoGpJeZg.js"), "loader")
		},
		{
			name: "swimlane",
			loader: /* @__PURE__ */ __name(async () => await import("./swimlanes-B3ENRKFQ-D5Xc70_B.js"), "loader")
		},
		...[{
			name: "cose-bilkent",
			loader: /* @__PURE__ */ __name(async () => await import("./cose-bilkent-JH36ORCC-DfDSCrvp.js"), "loader")
		}, ...elkLayoutLoaders()]
	]);
}, "registerDefaultLayoutLoaders"))();
var render = /* @__PURE__ */ __name(async (data4Layout, svg) => {
	if (!Object.hasOwn(layoutAlgorithms, data4Layout.layoutAlgorithm)) throw new Error(`Unknown layout algorithm: ${data4Layout.layoutAlgorithm}`);
	if (data4Layout.diagramId) for (const node of data4Layout.nodes) {
		const originalDomId = node.domId || node.id;
		node.domId = `${data4Layout.diagramId}-${originalDomId}`;
	}
	const layoutDefinition = layoutAlgorithms[data4Layout.layoutAlgorithm];
	const layoutRenderer = await layoutDefinition.loader();
	insertLookDefs(svg, data4Layout.config);
	return layoutRenderer.render(data4Layout, svg, internalHelpers, { algorithm: layoutDefinition.algorithm });
}, "render");
var LAST_RESORT_LAYOUT = "dagre";
var getRegisteredLayoutAlgorithm = /* @__PURE__ */ __name((algorithm = "", { fallback = LAST_RESORT_LAYOUT } = {}) => {
	if (Object.hasOwn(layoutAlgorithms, algorithm)) return algorithm;
	for (const candidate of [fallback, LAST_RESORT_LAYOUT]) if (Object.hasOwn(layoutAlgorithms, candidate)) {
		log.warn(`Layout algorithm ${algorithm} is not registered. Using ${candidate} as fallback.`);
		return candidate;
	}
	throw new Error(`Neither layout algorithm ${algorithm}, ${fallback}, nor ${LAST_RESORT_LAYOUT} is registered.`);
}, "getRegisteredLayoutAlgorithm");
//#endregion
export { registerLayoutLoaders as n, render as r, getRegisteredLayoutAlgorithm as t };
