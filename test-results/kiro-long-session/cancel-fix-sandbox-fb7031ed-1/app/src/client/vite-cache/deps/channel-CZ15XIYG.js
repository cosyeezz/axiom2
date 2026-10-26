import { ot as Color, st as Utils } from "./chunk-DSNLSHJZ-BQJBHMMB.js";
//#region F:/Axiom/axiom2/app/node_modules/khroma/dist/methods/channel.js
var channel = (color, channel) => {
	return Utils.lang.round(Color.parse(color)[channel]);
};
//#endregion
export { channel as t };
