#!/bin/sh
set -eu
if ! command -v node >/dev/null 2>&1; then
  echo 'Install Node.js 22.19.0+ from https://nodejs.org/ and reopen your terminal, then retry.' >&2
  exit 1
fi
if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 19)) process.exit(1)'; then
  echo 'Axiom2 requires Node.js 22.19.0+.' >&2
  exit 1
fi
npm install --global 'https://github.com/cosyeezz/axiom2/releases/latest/download/axiom2.tgz'
axiom_prefix=$(npm prefix --global)
exec "$axiom_prefix/bin/axiom2" start
