#!/bin/sh
set -eu
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
phase() { printf '@@phase:%s\n' "$1"; }
setup_action=$1
cache=''
finish() {
  result=$?
  if [ "$setup_action" != check ] && [ -n "${AXIOM_SETUP_RESULT:-}" ]; then printf '%s' "$result" > "$AXIOM_SETUP_RESULT"; fi
  if [ -n "$cache" ]; then rm -rf "$cache"; fi
}
trap finish EXIT
find_node() {
  AXIOM_SETUP_NODE=$(command -v node || true)
  AXIOM_SETUP_NPM=''
  if [ -n "$AXIOM_SETUP_NODE" ]; then
    for candidate in "$(dirname "$AXIOM_SETUP_NODE")/../lib/node_modules/npm/bin/npm-cli.js" "$(dirname "$AXIOM_SETUP_NODE")/node_modules/npm/bin/npm-cli.js"; do
      if [ -f "$candidate" ]; then AXIOM_SETUP_NPM=$candidate; break; fi
    done
  fi
  export AXIOM_SETUP_NPM
}
find_node
case "$1" in
  check)
    if [ -n "$AXIOM_SETUP_NODE" ]; then
      "$AXIOM_SETUP_NODE" -e 'const fs=require("fs"),path=require("path");const [a,b]=process.versions.node.split(".").map(Number);let writable=false;try {const p=path.join(process.env.AXIOM_DATA_DIR,".setup-probe-"+process.pid);fs.writeFileSync(p,"");fs.unlinkSync(p);writable=true}catch{}console.log(JSON.stringify({nodeReady:(a>22||a===22&&b>=19)&&!!process.env.AXIOM_SETUP_NPM,nodeVersion:process.version,node:process.execPath,writable,platform:process.platform,tailscale:fs.existsSync("/Applications/Tailscale.app")||fs.existsSync("/usr/local/bin/tailscale")||fs.existsSync("/opt/homebrew/bin/tailscale")}))'
    else
      writable=false; tailscale=false; platform=linux
      probe="$AXIOM_DATA_DIR/.setup-probe-$$"
      if (umask 077; printf '' > "$probe") 2>/dev/null; then writable=true; rm -f "$probe"; fi
      if [ -d /Applications/Tailscale.app ] || command -v tailscale >/dev/null 2>&1; then tailscale=true; fi
      if [ "$(uname -s)" = Darwin ]; then platform=macos; fi
      printf '{"nodeReady":false,"nodeVersion":"","writable":%s,"platform":"%s","tailscale":%s}\n' "$writable" "$platform" "$tailscale"
    fi
    ;;
  node)
    [ "$(uname -s)" = Darwin ] || { echo '请通过发行版软件管理器安装 Node.js 22.19.0+。' >&2; exit 1; }
    phase '正在下载 Node.js 官方安装程序…'
    cache=$(mktemp -d "$AXIOM_DATA_DIR/setup-node.XXXXXX")
    /usr/bin/curl --fail --location --max-time 60 https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt -o "$cache/SHASUMS256.txt"
    package=$(awk '/ node-v22\.[0-9]+\.[0-9]+\.pkg$/ {print $2;exit}' "$cache/SHASUMS256.txt")
    [ -n "$package" ] || { echo '没有找到官方 Node.js 安装程序。' >&2; exit 1; }
    /usr/bin/curl --fail --location --max-time 600 "https://nodejs.org/dist/latest-v22.x/$package" -o "$cache/$package"
    (cd "$cache" && grep " $package$" SHASUMS256.txt | /usr/bin/shasum -a 256 -c -)
    phase '等待系统授权并安装 Node.js…'
    /usr/bin/osascript - "$cache/$package" <<'APPLESCRIPT'
on run argv
  do shell script "/usr/sbin/installer -pkg " & quoted form of (item 1 of argv) & " -target /" with administrator privileges
end run
APPLESCRIPT
    find_node
    "$AXIOM_SETUP_NODE" -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||a===22&&b<19)process.exit(1)'
    phase 'Node.js 已安装，请重新验证环境。'
    ;;
  tailscale)
    if command -v brew >/dev/null 2>&1; then
      phase '正在通过 Homebrew 安装 Tailscale；请按系统提示授权…'
      brew install --cask tailscale-app
      phase 'Tailscale 已安装，请打开并登录。'
    else
      echo '请先通过 https://tailscale.com/download/mac 安装 Tailscale，完成后重新验证。' >&2; exit 1
    fi
    ;;
  service)
    [ -n "$AXIOM_SETUP_NODE" ] && [ -n "$AXIOM_SETUP_NPM" ] || { echo '请先安装 Node.js 22.19.0+ 和 npm。' >&2; exit 1; }
    "$AXIOM_SETUP_NODE" "$AXIOM_SETUP_SERVICE"
    ;;
  *) exit 1 ;;
esac
