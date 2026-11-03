# Exact host-tag ref: complete404, no source binding

[Experiment](EXPERIMENT.md) uniquely executed [one new metadata query](browser-results/manifest.json): `https://api.github.com/repos/apple-oss-distributions/xnu/git/ref/tags/xnu-12377.161.14`. This is not a retry of the earlier raw kern_proc.c path or broad commits endpoint.

Actual result: **HTTP404**, complete/no cap, [128B JSON](browser-results/01-exact-tag-ref.body) `Not Found`, SHA256`af34d7e1c24c2c3bd1da5d50fee4e8711a488d218f814c6c4f644603390fdf52`. Main read manifest/body/result. No ref, dereference or subsequent file download occurred. Harnessexit0/1.253s means the bounded observation and lease cleanup completed, **not** that exact source was obtained. All3OpenCLI children exited0/no timeout; own-session release receipt is not independent proof all native tabs closed.

This is the endpoint's observed anonymous view. It does not prove that no exact source exists elsewhere. The [other public main pin](../mac-supervision-primitives-05/SUMMARY.md) must not be substituted for this host build. Rootless control authority, kernel zero-ID behavior and complete-tree supervision remain unknown. No control API, privilege/global change, credentials read, official/KAS execution or model request. Do not rerun this CreateNew case or vary tags to manufacture a match.
