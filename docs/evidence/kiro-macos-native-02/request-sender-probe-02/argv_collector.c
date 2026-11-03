/* Own fake KAS executable: projects roles, never copies unknown argv/env values. */
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#ifndef TRACE_PATH
#error TRACE_PATH is an own CreateNew output file
#endif
#ifndef SERVER_MARKER
#error SERVER_MARKER is an own empty path
#endif
#ifndef EXPECTED_NODE_OPTIONS
#error EXPECTED_NODE_OPTIONS is a controlled marker, not a real observer
#endif

static const char *role(const char *value, int index) {
    if (index == 0) return "program";
    if (strcmp(value, SERVER_MARKER) == 0) return "server-marker";
    if (strcmp(value, "--experimental-wasm-modules") == 0) return "experimental-wasm";
    if (strcmp(value, "--transport=stdio") == 0) return "transport-stdio";
    if (strcmp(value, "--transport=ws") == 0) return "transport-ws";
    if (strcmp(value, "--auth=acp-callback") == 0) return "auth-acp-callback";
    if (strcmp(value, "--auth=user") == 0) return "auth-user";
    if (strcmp(value, "--auth=machine") == 0) return "auth-machine";
    return "unknown";
}

static const char *ca_value(const char *s) {
    if (s == NULL) return "absent";
    if (strcmp(s, "1") == 0) return "1";
    if (strcmp(s, "0") == 0) return "0";
    return "other";
}

int main(int argc, char **argv) {
    if (argc > 64) return 60;
    size_t lengths[64];
    for (int i = 0; i < argc; i++) {
        lengths[i] = strnlen(argv[i], 4097);
        if (lengths[i] > 4096) return 61;
    }
    int fd = open(TRACE_PATH, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0600);
    if (fd < 0) return 62;
    FILE *f = fdopen(fd, "w");
    if (f == NULL) { close(fd); return 63; }
    const char *options = getenv("NODE_OPTIONS");
    const char *ca = getenv("NODE_USE_SYSTEM_CA");
    const char *ua = getenv("KIRO_CUSTOM_USER_AGENT");
    const char *port = getenv("ACP_WS_PORT");
    int failed = fprintf(f, "{\"schema\":\"own-kas-role-1\",\"argc\":%d,\"argvRoles\":[", argc) < 0;
    for (int i = 0; i < argc && !failed; i++) {
        failed = fprintf(f, "%s{\"index\":%d,\"role\":\"%s\",\"byteLength\":%zu}",
                         i ? "," : "", i, role(argv[i], i), lengths[i]) < 0;
    }
    if (!failed) {
        failed = fprintf(f, "],\"nodeOptionsPresent\":%s,\"nodeOptionsMatchesControlled\":%s,"
                         "\"nodeUseSystemCA\":\"%s\",\"customUAPresent\":%s,\"wsPortPresent\":%s,\"complete\":true}\n",
                         options ? "true" : "false",
                         options && strcmp(options, EXPECTED_NODE_OPTIONS) == 0 ? "true" : "false",
                         ca_value(ca), ua ? "true" : "false", port ? "true" : "false") < 0;
    }
    if (ferror(f)) failed = 1;
    if (fclose(f) != 0) failed = 1;
    return failed ? 64 : 0;
}
