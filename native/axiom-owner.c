// Linux process ownership, not a filesystem or network sandbox.
// Build: cc -std=c11 -O2 -Wall -Wextra -Werror axiom-owner.c -o axiom-owner
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <poll.h>
#include <sched.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mount.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

static int control = 4;
static char nonce[65];
static int64_t now_ms(void) {
    struct timespec t;
    if (clock_gettime(CLOCK_MONOTONIC, &t)) _exit(111);
    return (int64_t)t.tv_sec * 1000 + t.tv_nsec / 1000000;
}
static int write_all(int fd, const char *data, size_t length) {
    while (length) {
        ssize_t n = write(fd, data, length);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) return -1;
        data += n; length -= (size_t)n;
    }
    return 0;
}
static void frame(const char *kind, int reason, int status) {
    char message[160];
    int length = snprintf(message, sizeof message, "%s %s %d %d\n", kind, nonce, reason, status);
    if (length > 0 && (size_t)length < sizeof message) (void)write_all(control, message, (size_t)length);
}
static int ready_frame(pid_t init, int child) {
    char path[96], contents[4096], start[32];
    // fdinfo translates this pidfd into the PID namespace of the mounted proc.
    // Refuse a different proc view instead of reading an unrelated numeric PID.
    snprintf(path, sizeof path, "/proc/self/fdinfo/%d", child);
    FILE *info = fopen(path, "re");
    if (!info) return -1;
    long visible = -1;
    while (fgets(contents, sizeof contents, info)) {
        if (!strncmp(contents, "Pid:\t", 5)) { visible = strtol(contents + 5, NULL, 10); break; }
    }
    fclose(info);
    if (visible != init) return -1;
    snprintf(path, sizeof path, "/proc/%d/stat", init);
    int fd = open(path, O_RDONLY | O_CLOEXEC);
    if (fd < 0) return -1;
    ssize_t length = read(fd, contents, sizeof contents - 1);
    close(fd);
    if (length <= 0 || length == (ssize_t)sizeof contents - 1) return -1;
    contents[length] = 0;
    // comm may contain spaces and ')'; field 22 follows the final closing ')'.
    char *end = strrchr(contents, ')'), *save = NULL;
    if (!end || end[1] != ' ') return -1;
    char *value = strtok_r(end + 2, " ", &save);
    for (int field = 3; field < 22 && value; field++) value = strtok_r(NULL, " ", &save);
    if (!value || !*value || strlen(value) >= sizeof start || strspn(value, "0123456789") != strlen(value)) return -1;
    strcpy(start, value);
    char message[160];
    int count = snprintf(message, sizeof message, "READY %s %d %s\n", nonce, init, start);
    return count > 0 && (size_t)count < sizeof message ? write_all(control, message, (size_t)count) : -1;
}
static void fail(const char *message) {
    int error = errno;
    frame("ERROR", error, 0);
    dprintf(STDERR_FILENO, "ownership unavailable: %s (%d)\n", message, error);
    _exit(111);
}
static int pidfd(pid_t pid) {
    int fd = (int)syscall(SYS_pidfd_open, pid, 0);
    if (fd < 0) fail("pidfd_open");
    return fd;
}
static void arm_parent(int fd) {
    if (prctl(PR_SET_PDEATHSIG, SIGKILL)) fail("parent death signal");
    struct pollfd parent = { .fd = fd, .events = POLLIN };
    int result;
    do { result = poll(&parent, 1, 0); } while (result < 0 && errno == EINTR);
    if (result != 0) _exit(112);
}
static void put(const char *path, const char *value) {
    int fd = open(path, O_WRONLY | O_CLOEXEC);
    if (fd < 0) fail("open namespace mapping");
    if (write_all(fd, value, strlen(value))) fail("write namespace mapping");
    if (close(fd)) fail("close namespace mapping");
}
static long number(const char *value, long minimum, long maximum) {
    char *end;
    if (!value || !*value) { errno = EINVAL; fail("missing argument"); }
    errno = 0;
    long parsed = strtol(value, &end, 10);
    if (errno || *end || parsed < minimum || parsed > maximum) { errno = EINVAL; fail("invalid argument"); }
    return parsed;
}
static void init_process(int parent, int host, int channel, int gate, int ready, char **command) {
    arm_parent(parent); // fork clears PDEATHSIG; getppid() is zero across the namespace boundary.
    close(parent); close(host); close(control);
    if (unshare(CLONE_NEWNS)) _exit(113);
    if (mount(NULL, "/", NULL, MS_REC | MS_PRIVATE, NULL)) _exit(113);
    if (mount("proc", "/proc", "proc", MS_NOSUID | MS_NODEV | MS_NOEXEC, NULL)) _exit(113);
    if (write_all(ready, "R", 1)) _exit(113);
    close(ready);
    char go;
    ssize_t count;
    do { count = read(gate, &go, 1); } while (count < 0 && errno == EINTR);
    close(gate);
    if (count != 1 || go != 'G') _exit(113);
    pid_t worker = fork();
    if (worker < 0) _exit(113);
    if (!worker) {
        // The business IPC is inherited unchanged; no ownership control FD reaches Node.
        unsetenv("AXIOM_OWNER_PARENT"); unsetenv("AXIOM_OWNER_NONCE"); unsetenv("AXIOM_OWNER_DEADLINE");
        execv(command[0], command);
        _exit(127);
    }
    close(channel);
    // Stay PID1 and reap orphans. PID1 exit causes the kernel to kill all remaining descendants.
    for (;;) {
        int status;
        pid_t ended = waitpid(-1, &status, 0);
        if (ended < 0 && errno == EINTR) continue;
        if (ended < 0) _exit(113);
        if (ended == worker) _exit(WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status));
    }
}
// Keep the duplex readable until the host consumes CLEANED. Closing immediately
// can turn a concurrent STOP/DEADLINE write into EPIPE and discard that receipt.
// All descendants are already gone; an absent ACK only delays exit, never work.
static void await_cleanup_ack(int host) {
    const int64_t deadline = now_ms() + 2000;
    char input[256], expected[sizeof nonce + 4]; size_t used = 0;
    snprintf(expected, sizeof expected, "ACK %s", nonce);
    for (;;) {
        int64_t remaining = deadline - now_ms();
        if (remaining <= 0) return;
        struct pollfd fds[] = {
            { .fd = host, .events = POLLIN }, { .fd = control, .events = POLLIN }
        };
        int result = poll(fds, 2, (int)remaining);
        if (result < 0 && errno == EINTR) continue;
        if (result <= 0 || fds[0].revents) return;
        if (!fds[1].revents) continue;
        ssize_t n = read(control, input + used, sizeof input - used - 1);
        if (n <= 0) return;
        used += (size_t)n; input[used] = 0;
        char *line;
        while ((line = memchr(input, '\n', used))) {
            *line = 0;
            if (!strcmp(input, expected)) return;
            // Late control frames cannot affect a tree that is already reaped.
            size_t consumed = (size_t)(line - input) + 1;
            used -= consumed; memmove(input, input + consumed, used); input[used] = 0;
        }
        if (used == sizeof input - 1) return;
    }
}
int main(int argc, char **argv) {
    signal(SIGPIPE, SIG_IGN);
    const char *token = getenv("AXIOM_OWNER_NONCE");
    if (!token || strlen(token) != 36 || strspn(token, "abcdef0123456789-") != 36) return 110;
    memcpy(nonce, token, 37);
    if (argc < 2 || argv[1][0] != '/') { errno = EINVAL; fail("absolute Node executable required"); }
    int channel = (int)number(getenv("NODE_CHANNEL_FD"), 3, 1024);
    if (channel == control) { errno = EINVAL; fail("IPC/control collision"); }
    pid_t expected = (pid_t)number(getenv("AXIOM_OWNER_PARENT"), 1, INT_MAX);
    int64_t deadline = number(getenv("AXIOM_OWNER_DEADLINE"), 1, LONG_MAX);
    if (getppid() != expected) return 112;
    int host = pidfd(expected);
    arm_parent(host);
    if (getppid() != expected) return 112;
    uid_t uid = getuid(); gid_t gid = getgid();
    if (getuid() != geteuid() || getgid() != getegid()) { errno = EPERM; fail("privileged helper is forbidden"); }
    if (unshare(CLONE_NEWUSER)) fail("user namespace");
    char mapping[96];
    put("/proc/self/setgroups", "deny");
    // Preserve numeric UID/GID so npm and created file ownership keep their ordinary behavior.
    snprintf(mapping, sizeof mapping, "%u %u 1\n", uid, uid); put("/proc/self/uid_map", mapping);
    snprintf(mapping, sizeof mapping, "%u %u 1\n", gid, gid); put("/proc/self/gid_map", mapping);
    arm_parent(host);
    if (getppid() != expected) return 112;
    if (unshare(CLONE_NEWPID)) fail("PID namespace");
    int gate[2], ready[2];
    if (pipe2(gate, O_CLOEXEC) || pipe2(ready, O_CLOEXEC)) fail("control pipes");
    int self = pidfd(getpid());
    pid_t init = fork();
    if (init < 0) fail("namespace init");
    if (!init) {
        close(gate[1]); close(ready[0]);
        init_process(self, host, channel, gate[0], ready[1], argv + 1);
        _exit(113);
    }
    close(self); close(channel); close(gate[0]); close(ready[1]);
    int child = pidfd(init), sent_ready = 0, started = 0, reason = 0;
    char input[256]; size_t used = 0;
    for (;;) {
        int64_t remaining = deadline - now_ms();
        if (remaining <= 0) { reason = 2; break; }
        struct pollfd fds[] = {
            { .fd = host, .events = POLLIN }, { .fd = control, .events = POLLIN },
            { .fd = child, .events = POLLIN }, { .fd = ready[0], .events = POLLIN }
        };
        int result = poll(fds, 4, remaining > INT_MAX ? INT_MAX : (int)remaining);
        if (result < 0 && errno == EINTR) continue;
        if (result < 0) { reason = 4; break; }
        if (fds[0].revents) { reason = 3; break; }
        if (fds[2].revents) break;
        if (!sent_ready && fds[3].revents) {
            char value;
            if (read(ready[0], &value, 1) != 1 || value != 'R') { reason = 4; break; }
            close(ready[0]); ready[0] = -1;
            if (ready_frame(init, child)) { reason = 4; break; }
            sent_ready = 1;
        }
        if (fds[1].revents) {
            ssize_t n = read(control, input + used, sizeof input - used - 1);
            if (n <= 0) { reason = 3; break; }
            used += (size_t)n; input[used] = 0;
            char *line;
            while ((line = memchr(input, '\n', used))) {
                *line = 0;
                if (!strcmp(input, "STOP")) { reason = 1; goto stopped; }
                if (!strcmp(input, "GO") && sent_ready && !started) {
                    if (write_all(gate[1], "G", 1)) { reason = 4; goto stopped; }
                    started = 1; close(gate[1]); gate[1] = -1;
                } else if (!strncmp(input, "DEADLINE ", 9)) {
                    char *end; errno = 0;
                    long next = strtol(input + 9, &end, 10);
                    if (errno || *end || next < 1) { reason = 4; goto stopped; }
                    deadline = next;
                } else { reason = 4; goto stopped; }
                size_t consumed = (size_t)(line - input) + 1;
                used -= consumed; memmove(input, input + consumed, used); input[used] = 0;
            }
            if (used == sizeof input - 1) { reason = 4; break; }
        }
    }
stopped:
    if (syscall(SYS_pidfd_send_signal, child, SIGKILL, NULL, 0) < 0 && errno != ESRCH) fail("terminate namespace");
    int status;
    pid_t reaped;
    do { reaped = waitpid(init, &status, 0); } while (reaped < 0 && errno == EINTR);
    if (reaped != init) fail("confirm namespace exit");
    // This receipt is the only successful cleanup proof. A launcher exit alone proves nothing.
    frame("CLEANED", reason, status);
    if (gate[1] >= 0) close(gate[1]);
    if (ready[0] >= 0) close(ready[0]);
    close(child);
    await_cleanup_ack(host);
    close(host); close(control);
    return reason == 0 && WIFEXITED(status) ? WEXITSTATUS(status) : 1;
}
