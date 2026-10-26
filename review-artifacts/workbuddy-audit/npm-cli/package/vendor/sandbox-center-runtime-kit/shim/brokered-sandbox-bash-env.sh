if [ -n "${CODEBUDDY_TOYBOX_BIN:-}" ] && [ -n "${CODEBUDDY_BROKERED_BIN_DIR:-}" ]; then
    [ -n "${TOYBOX_SANDBOX_SOCK:-}" ] || [ -z "${CODEBUDDY_SANDBOX_BROKER_IPC_ADDRESS:-}" ] || export TOYBOX_SANDBOX_SOCK="${CODEBUDDY_SANDBOX_BROKER_IPC_ADDRESS}"

    [ -d "${CODEBUDDY_BROKERED_BIN_DIR}" ] || return 0 2>/dev/null || true
    for __cb_cmd in "${CODEBUDDY_BROKERED_BIN_DIR}"/*; do
        [ -e "$__cb_cmd" ] || continue
        __cb_name="${__cb_cmd##*/}"; unalias "$__cb_name" 2>/dev/null || true; unset -f "$__cb_name" 2>/dev/null || true
    done
    unset __cb_cmd __cb_name; export PATH="${CODEBUDDY_BROKERED_BIN_DIR}:$PATH"
fi
