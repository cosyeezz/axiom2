import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getPackageDir, getReadmePath, getDocsPath, getExamplesPath } from "@earendil-works/pi-coding-agent";

const packageRoot = getPackageDir();
const { version } = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
console.log(JSON.stringify({ version, packageRoot, readme: getReadmePath(), docs: getDocsPath(), examples: getExamplesPath() }, null, 2));
