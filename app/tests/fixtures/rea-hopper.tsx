import { createRoot } from "react-dom/client";
import { useState } from "react";
import { Icons } from "../../src/client/components.js";
import { ReaEngines } from "../../src/client/pages/ReaEngines.js";
import { connect } from "../../src/client/transport.js";
import { emptyReaState, type ReaState } from "../../src/shared/rea.js";
import "../../src/client/styles/tokens.css";
import "../../src/client/styles/workbench.css";
import "../../src/client/styles/icon-geometry.css";
import "../../src/client/styles/builtin-tools.css";
import "../../src/client/styles/theme.css";
import "../../src/client/styles/confirmation-inline.css";

type Call = { op: string; params?: Record<string, unknown> };
type Flags = { busy?: boolean; blocked?: boolean; sending?: string[] };
const fixture = (window as any).hopperFixture = { calls: [] as Call[], reset: (_state: ReaState, _flags?: Flags) => {} };
function Fixture() {
  const [state, setState] = useState(emptyReaState), [flags, setFlags] = useState<Flags>({});
  fixture.reset = (state: ReaState, flags: Flags = {}) => { setState(state); setFlags(flags); };
  return <><Icons /><main data-fixture-state={JSON.stringify({ state, flags })} style={{ width: "min(100%, 860px)", margin: "0 auto", padding: "20px", minWidth: 0 }}>
    <ReaEngines state={state} busy={!!flags.busy} blocked={!!flags.blocked} sending={flags.sending ?? []} feedback={{}} reportedErrorResources={[]} action={async (op, params) => { fixture.calls.push({ op, params }); }} />
  </main></>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
void connect();
