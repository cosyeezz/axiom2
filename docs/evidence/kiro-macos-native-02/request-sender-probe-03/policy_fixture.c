/* Own synthetic sandbox-policy producer, NOT the KAS role collector. */
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

static void result(const char *op, const char *stage, bool success, int error) {
    printf("{\"operation\":\"%s\",\"stage\":\"%s\",\"success\":%s,\"errno\":%d}\n",
           op, stage, success ? "true" : "false", error);
}

int main(int argc, char **argv) {
    setbuf(stdout, NULL);
    puts("{\"producerEntered\":true}");
    if (argc == 2 && strcmp(argv[1], "entry") == 0) {
        result("entry", "main", true, 0);
        return 0;
    }
    if (argc == 3 && strcmp(argv[1], "write") == 0) {
        static const char payload[] = "OWN_POLICY03_WRITE\n";
        int fd = open(argv[2], O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW, 0600);
        if (fd < 0) {
            result("write", "open", false, errno);
            return 0;
        }
        ssize_t count = write(fd, payload, sizeof(payload) - 1);
        int error = count < 0 ? errno : EIO;
        if (count != (ssize_t)(sizeof(payload) - 1)) {
            (void)close(fd);
            result("write", "write", false, error);
            return 0;
        }
        if (close(fd) != 0) {
            result("write", "close", false, errno);
            return 0;
        }
        result("write", "close", true, 0);
        return 0;
    }
    if (argc == 2 && strcmp(argv[1], "bind") == 0) {
        int fd = socket(AF_INET, SOCK_STREAM, 0);
        if (fd < 0) {
            result("loopback-bind", "socket", false, errno);
            return 0;
        }
        struct sockaddr_in address = {0};
        address.sin_len = sizeof(address);
        address.sin_family = AF_INET;
        address.sin_port = htons(0);
        address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        int bound = bind(fd, (const struct sockaddr *)&address, sizeof(address));
        int error = bound < 0 ? errno : 0;
        (void)close(fd);
        result("loopback-bind", "bind", bound == 0, error);
        return 0;
    }
    if (argc == 2 && strcmp(argv[1], "exec-self") == 0) {
        char *args[] = {argv[0], "entry", NULL};
        (void)execv(argv[0], args);
        result("exec-self", "exec", false, errno);
        return 0;
    }
    if (argc == 2 && strcmp(argv[1], "exec-denied") == 0) {
        char *args[] = {"/usr/bin/true", NULL};
        (void)execv(args[0], args);
        result("exec-denied", "exec", false, errno);
        return 0;
    }
    result("usage", "arguments", false, EINVAL);
    return 64;
}
