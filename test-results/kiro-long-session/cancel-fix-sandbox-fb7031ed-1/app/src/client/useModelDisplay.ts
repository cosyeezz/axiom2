import { modelDisplay } from "../shared/model-display.js";
import type { Configuration } from "../shared/protocol.js";
import { useScope } from "./transport.js";

const emptyConfig: Pick<Configuration, "available"> = { available: [] };

/** Shared live metadata also works on standalone cost and processing pages. */
export function useModelDisplay() {
  const config = useScope("configuration", emptyConfig);
  return (identity: Parameters<typeof modelDisplay>[1]) => modelDisplay(config.available, identity);
}
