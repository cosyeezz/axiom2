#define _DARWIN_C_SOURCE 1
#include <dlfcn.h>
#include <inttypes.h>
#include <mach-o/loader.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/utsname.h>
#include <unistd.h>
#if __has_feature(ptrauth_calls)
#include <ptrauth.h>
#endif

/* Pure own-process metadata/code-prefix observation, never a control call. */
int main(void) {
#if !defined(__arm64__)
    fputs("unsupported_arch\n", stderr);
    return 2;
#endif
    struct utsname u;
    if (uname(&u) != 0) return 2;
    printf("pid=%d\nuid=%d\neuid=%d\nrelease=%s\nmachine=%s\nkernel_version=%s\n",
           (int)getpid(), (int)getuid(), (int)geteuid(), u.release, u.machine, u.version);
    dlerror();
    void *symbol = dlsym(RTLD_DEFAULT, "coalition_terminate");
    if (!symbol || dlerror()) { puts("symbol_present=0"); return 2; }
    puts("symbol_present=1");
#if __has_feature(ptrauth_calls)
    symbol = ptrauth_strip(symbol, ptrauth_key_function_pointer);
#endif
    Dl_info info;
    if (!dladdr(symbol, &info) || !info.dli_fbase || !info.dli_fname || !info.dli_saddr) return 2;
    printf("image=%s\nsymbol=%s\n", info.dli_fname, info.dli_sname ? info.dli_sname : "");
    if (strcmp(info.dli_fname, "/usr/lib/system/libsystem_kernel.dylib") &&
        strcmp(info.dli_fname, "/usr/lib/system/libsystem_c.dylib") &&
        strcmp(info.dli_fname, "/usr/lib/system/libsystem_platform.dylib")) return 2;
    if ((uintptr_t)info.dli_saddr != (uintptr_t)symbol) return 2;
    const struct mach_header_64 *h = (const struct mach_header_64 *)info.dli_fbase;
    if (h->magic != MH_MAGIC_64 || h->ncmds > 512 || h->sizeofcmds > 65536) return 2;
    printf("image_cputype=%d\nimage_cpusubtype=%d\n", h->cputype, h->cpusubtype);
    const unsigned char *cursor = (const unsigned char *)(h + 1);
    const unsigned char *end = cursor + h->sizeofcmds;
    int have_uuid = 0;
    for (uint32_t i = 0; i < h->ncmds; i++) {
        if ((size_t)(end - cursor) < sizeof(struct load_command)) return 2;
        const struct load_command *lc = (const struct load_command *)cursor;
        if (lc->cmdsize < sizeof(*lc) || (size_t)(end - cursor) < lc->cmdsize) return 2;
        if (lc->cmd == LC_UUID && lc->cmdsize == sizeof(struct uuid_command)) {
            const struct uuid_command *uuid = (const struct uuid_command *)cursor;
            fputs("image_uuid=", stdout);
            for (unsigned j = 0; j < 16; j++) printf("%02x", uuid->uuid[j]);
            putchar('\n');
            have_uuid = 1;
        }
        cursor += lc->cmdsize;
    }
    if (!have_uuid) return 2;
    long page = sysconf(_SC_PAGESIZE);
    if (page <= 0 || (uintptr_t)symbol < (uintptr_t)info.dli_fbase) return 2;
    size_t remaining = (size_t)page - ((uintptr_t)symbol % (size_t)page);
    size_t length = remaining < 64 ? remaining : 64;
    if (length == 0) return 2;
    unsigned char bytes[64];
    memcpy(bytes, symbol, length);
    printf("image_offset=%" PRIuPTR "\nprefix_length=%zu\nprefix_hex=",
           (uintptr_t)symbol - (uintptr_t)info.dli_fbase, length);
    for (size_t i = 0; i < length; i++) printf("%02x", bytes[i]);
    puts("\ncoalition_api_calls=0");
    return 0;
}
