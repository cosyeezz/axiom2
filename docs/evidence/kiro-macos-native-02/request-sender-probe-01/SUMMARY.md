# Official request command interface: help captured, not a real request

The [experiment](EXPERIMENT.md) and [driver](capture_help.py) ran exactly once. [Main exit](main.exit)0/[main stderr](main.stderr)0B. The installed public launcher/chat hashes matched the frozen2.35.2 identities and held-FD/path stats remained unchanged. This is not atomic loaded-image proof.

The [manifest](results/manifest.json) records one sandboxed `kiro-cli chat --help`: held PID79642, exit0, no timeout, 0.587629709s; [raw stdout](results/help.stdout)4128B/SHA`411e9dc35aa29d9aa7cd286e402ebd5a2ba9a504b9bfee199267c74d246c2aea`, [raw stderr](results/help.stderr)0B. Own namespace and minimal environment are in [preflight](results/preflight.json). The applied [sandbox profile](results/sandbox-profile.sb) denied network, real HOME reads, global writes and mach-lookup, with exec restricted to official launcher/chat paths. No extracted JS or fake-only observer ran.

## Directly useful parameters

- `--model <MODEL>` selects a model; intended comparison remains exactly `deepseek-3.2`.
- `--no-interactive` runs without expecting user input.
- `--v3` or `--agent-engine v3` explicitly selects the next-generation agent without changing the real stored setting.
- `--list-models --format json` is a documented model-listing interface, **not yet executed** and not proof that the target model is available.
- `--output-format stream-json` is supported and implies non-interactive mode. Its stream is not safe to persist blindly in a real authenticated run.

Five saved result files passed a separate data-only size/SHA/mode0400/manifest/main consistency check; no help, identity/signature/extraction or old tests were rerun. Source SHA`b6f124236e7e924c9ff8c4d2771bfd8e64db5f78a3bed45fe6334d718ec40010`. Main/source files are not included in the result-only0400 promise.

## Limits and next decision

This proves only the command interface. It does not prove the stored default engine's actual execution, natural KAS creation, NODE_OPTIONS inheritance, selected auth provider/API/feature, model availability, real requests or request consistency. Ordinary files are not pipe EOF proof; no full-tree containment claim is made or required for this request-only investigation.

Next define one zero-secret, no-network instrumented V3 launch to identify whether the KAS command/auth-provider selection and controlled preload marker are passed. Use own fake executable overrides rather than execute extracted JS, preserve any failure, and label the result as instrumented selection—not unmodified wire or a model request. No model requests have been made.
