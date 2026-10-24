#!/bin/sh
set -eu
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
phase() {
  printf '@@phase:%s\n' "$1"
  if [ -n "${task_file:-}" ]; then
    /usr/bin/plutil -replace message -string "$1" "$task_file"
    previous_stage=$(/usr/bin/plutil -extract phase raw -o - "$task_file")
    if [ "$previous_stage" != "${2:-checking}" ]; then /usr/bin/plutil -replace phaseStartedAt -integer "$(date +%s)000" "$task_file"; fi
    /usr/bin/plutil -replace phase -string "${2:-checking}" "$task_file"
    /usr/bin/plutil -replace capabilities.cancel -bool "${3:-false}" "$task_file"
    /usr/bin/plutil -replace capabilities.extend -bool "${3:-false}" "$task_file"
    case "${2:-checking}" in checking) step=0;; downloading) step=1;; verifying) step=2;; installing) step=3;; validating) step=4;; esac
    /usr/bin/plutil -replace completedSteps -integer "$step" "$task_file"
    publish_task
  fi
}
publish_task() {
  /usr/bin/plutil -replace updatedAt -integer "$(date +%s)000" "$task_file"
  /usr/bin/plutil -convert json -o "$AXIOM_SETUP_TASK_DIR/task.shell.next" "$task_file"
  mv -f "$AXIOM_SETUP_TASK_DIR/task.shell.next" "$AXIOM_SETUP_TASK_DIR/task.json"
}
read_budget() {
  budget_key=$1; budget_default=$2
  budget_value=$(/usr/bin/plutil -extract "budgets.$budget_key" raw -o - "$task_file" 2>/dev/null || printf '%s' "$budget_default")
  if [ -f "$AXIOM_SETUP_TASK_DIR/control.json" ]; then
    extended=$(/usr/bin/plutil -extract "budgets.$budget_key" raw -o - "$AXIOM_SETUP_TASK_DIR/control.json" 2>/dev/null || printf 0)
    if [ "$extended" -gt "$budget_value" ]; then budget_value=$extended; /usr/bin/plutil -replace "budgets.$budget_key" -integer "$budget_value" "$task_file"; fi
  fi
  printf '%s' "$budget_value"
}
check_control() {
  [ -n "${task_file:-}" ] || return 0
  if [ -f "$AXIOM_SETUP_TASK_DIR/control.json" ] && [ "$(/usr/bin/plutil -extract cancel raw -o - "$AXIOM_SETUP_TASK_DIR/control.json" 2>/dev/null || true)" = true ]; then
    terminal_status=cancelled; printf '%s\n' '已取消下载与安装准备。' >&2; return 1
  fi
  final_total=$(read_budget totalMs 1200000)
  task_start=$(/usr/bin/plutil -extract startedAt raw -o - "$task_file")
  if [ $(($(date +%s) * 1000 - task_start)) -ge "$final_total" ]; then printf '%s\n' '任务达到总时限。' >&2; return 1; fi
}
download() {
  download_url=$1; download_path=$2
  download_started=$(date +%s); download_last=$download_started; download_sample=$download_started; download_bytes=0; received_headers=false
  header_file="$download_path.headers"
  /usr/bin/curl --fail --location --silent --show-error --dump-header "$header_file" "$download_url" -o "$download_path" &
  download_pid=$!
  while kill -0 "$download_pid" 2>/dev/null; do
    now=$(date +%s)
    bytes=0; if [ -f "$download_path" ]; then bytes=$(wc -c < "$download_path" | tr -d ' '); fi
    if [ "$bytes" -ne "$download_bytes" ]; then download_last=$now; fi
    if [ -f "$header_file" ] && grep -Eq '^HTTP/[^ ]+ 2[0-9][0-9]' "$header_file"; then received_headers=true; fi
    reason=''
    if [ -n "${task_file:-}" ]; then
      if [ -f "$AXIOM_SETUP_TASK_DIR/control.json" ] && [ "$(/usr/bin/plutil -extract cancel raw -o - "$AXIOM_SETUP_TASK_DIR/control.json" 2>/dev/null || true)" = true ]; then terminal_status=cancelled; reason='已取消下载。'; fi
      headers_budget=$(read_budget headersMs 30000); idle_budget=$(read_budget idleMs 60000); total_budget=$(read_budget totalMs 1200000)
      task_started=$(/usr/bin/plutil -extract startedAt raw -o - "$task_file")
      if [ $((now * 1000 - task_started)) -ge "$total_budget" ]; then reason='任务达到总时限。'; fi
    else headers_budget=30000; idle_budget=60000; fi
    if [ "$received_headers" = false ] && [ $(((now - download_started) * 1000)) -ge "$headers_budget" ]; then reason='等待下载源响应头超时。'; fi
    if [ "$received_headers" = true ] && [ $(((now - download_last) * 1000)) -ge "$idle_budget" ]; then reason='下载源长时间没有返回数据。'; fi
    if [ "$bytes" -gt 536870912 ]; then reason='安装文件超出大小限制。'; fi
    if [ -n "$reason" ]; then kill "$download_pid" 2>/dev/null || true; wait "$download_pid" 2>/dev/null || true; rm -f "$download_path"; printf '%s\n' "$reason" >&2; return 1; fi
    if [ -n "${task_file:-}" ]; then
      connection=connecting; if [ "$received_headers" = true ]; then connection=receiving; fi
      sample_seconds=$((now - download_sample)); if [ "$sample_seconds" -lt 1 ]; then sample_seconds=1; fi
      /usr/bin/plutil -replace transfer -json "{\"received\":$bytes,\"bytesPerSecond\":$(((bytes - download_bytes) / sample_seconds)),\"connection\":\"$connection\",\"updatedAt\":${now}000,\"source\":\"https://nodejs.org\"}" "$task_file"
      publish_task
    fi
    download_bytes=$bytes; download_sample=$now
    sleep 1
  done
  if wait "$download_pid"; then
    if ! check_control; then rm -f "$download_path"; return 1; fi
    if [ -n "${task_file:-}" ]; then
      bytes=$(wc -c < "$download_path" | tr -d ' ')
      /usr/bin/plutil -replace transfer -json "{\"received\":$bytes,\"connection\":\"finished\",\"updatedAt\":$(date +%s)000,\"source\":\"https://nodejs.org\"}" "$task_file"
      publish_task
    fi
  else rm -f "$download_path"; return 1; fi
}
setup_action=$1
cache=''
task_file=''; terminal_status=''
if [ "$setup_action" != check ] && [ "$setup_action" != service ] && [ "$(uname -s)" = Darwin ] && [ -n "${AXIOM_SETUP_TASK_DIR:-}" ]; then
  task_file="$AXIOM_SETUP_TASK_DIR/task.shell.json"
  cp "$AXIOM_SETUP_TASK_DIR/task.json" "$task_file"
fi
finish() {
  result=$?
  if [ -n "$task_file" ]; then
    if [ -z "$terminal_status" ]; then if [ "$result" = 0 ]; then terminal_status=succeeded; else terminal_status=failed; fi; fi
    /usr/bin/plutil -replace status -string "$terminal_status" "$task_file"
    /usr/bin/plutil -replace capabilities -json '{"cancel":false,"extend":false}' "$task_file"
    /usr/bin/plutil -replace finishedAt -integer "$(date +%s)000" "$task_file"
    if [ "$result" = 0 ]; then /usr/bin/plutil -replace completedSteps -integer 5 "$task_file"; fi
    publish_task
  fi
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
    phase '正在下载 Node.js 官方安装程序…' downloading true
    cache=$(mktemp -d "$AXIOM_DATA_DIR/setup-node.XXXXXX")
    download https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt "$cache/SHASUMS256.txt"
    package=$(awk '/ node-v22\.[0-9]+\.[0-9]+\.pkg$/ {print $2;exit}' "$cache/SHASUMS256.txt")
    [ -n "$package" ] || { echo '没有找到官方 Node.js 安装程序。' >&2; exit 1; }
    download "https://nodejs.org/dist/latest-v22.x/$package" "$cache/$package"
    phase '正在校验 Node.js 安装程序…' verifying true
    (cd "$cache" && grep " $package$" SHASUMS256.txt | /usr/bin/shasum -a 256 -c -)
    check_control
    phase '等待系统授权并安装 Node.js…' installing
    check_control
    /usr/bin/osascript - "$cache/$package" <<'APPLESCRIPT'
on run argv
  do shell script "/usr/sbin/installer -pkg " & quoted form of (item 1 of argv) & " -target /" with administrator privileges
end run
APPLESCRIPT
    find_node
    "$AXIOM_SETUP_NODE" -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||a===22&&b<19)process.exit(1)'
    phase 'Node.js 已安装，请重新验证环境。' validating
    ;;
  tailscale)
    if command -v brew >/dev/null 2>&1; then
      phase '正在通过 Homebrew 安装 Tailscale；请按系统提示授权…' installing
      brew install --cask tailscale-app
      phase 'Tailscale 已安装，请打开并登录。' validating
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
