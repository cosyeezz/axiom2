#!/bin/sh
set -eu
if ! command -v node >/dev/null 2>&1; then
  echo 'Install Node.js 24+ from https://nodejs.org/ and reopen your terminal, then retry.' >&2
  exit 1
fi
if ! node -e 'if (Number(process.versions.node.split(".")[0]) < 24) process.exit(1)'; then
  echo 'Axiom2 requires Node.js 24+.' >&2
  exit 1
fi
npm install --global 'https://github.com/cosyeezz/axiom2/releases/latest/download/axiom2.tgz'
axiom_prefix=$(npm prefix --global)
exec "$axiom_prefix/bin/axiom2" start
