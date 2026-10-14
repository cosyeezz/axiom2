import { realpathSync } from "node:fs";
import { tmpdir as systemTmpdir } from "node:os";

// macOS exposes /var through /private/var; Windows runners use short TEMP paths.
// Fixtures that directly write native
// session headers or register picker results must use canonical paths, just as
// workspace.open and the production native picker do.
export const tmpdir = () => realpathSync.native(systemTmpdir());
