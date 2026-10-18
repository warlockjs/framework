/*
 * macOS identity reader. No signalling or process discovery.
 * APIs verified against Apple's XNU proc_info.h/sysctl.h and adv_cmds ps source:
 * https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/proc_info.h
 * https://github.com/apple-oss-distributions/adv_cmds/blob/main/ps/print.c
 */
#include <errno.h>
#include <inttypes.h>
#include <limits.h>
#include <libproc.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/proc.h>
#include <sys/proc_info.h>
#include <sys/sysctl.h>

/* Exit 3 means the selected PID is gone; other failures must fail closed. */
int main(int argc, char **argv) {
  if (argc < 2 || argc > 3) return 2;
  char *end = NULL;
  errno = 0;
  long selected = strtol(argv[1], &end, 10);
  if (errno || !end || *end || selected <= 1 || selected > INT_MAX) return 2;
  int pid = (int)selected;
  struct proc_taskallinfo before;
  if (proc_pidinfo(pid, PROC_PIDTASKALLINFO, 0, &before, sizeof(before)) != sizeof(before))
    return errno == ESRCH ? 3 : 4;
  if (before.pbsd.pbi_status == SZOMB) return 3;

  char token[65] = {0};
  if (argc == 3) {
    if (strcmp(argv[2], "--token")) return 2;
    int argmax = 0;
    size_t size = sizeof(argmax);
    int max_mib[] = {CTL_KERN, KERN_ARGMAX};
    if (sysctl(max_mib, 2, &argmax, &size, NULL, 0) || argmax <= 0) return 4;
    char *buffer = malloc((size_t)argmax);
    if (!buffer) return 4;
    int mib[] = {CTL_KERN, KERN_PROCARGS2, pid};
    size = (size_t)argmax;
    if (sysctl(mib, 3, buffer, &size, NULL, 0)) {
      int result = errno == ESRCH ? 3 : 4;
      free(buffer);
      return result;
    }
    if (size < sizeof(int)) { free(buffer); return 4; }
    int arguments = 0;
    memcpy(&arguments, buffer, sizeof(arguments));
    if (arguments < 1) { free(buffer); return 4; }
    char *cursor = buffer + sizeof(arguments);
    char *limit = buffer + size;
    /* Saved executable path, followed by padding, then exactly argc arguments. */
    char *zero = memchr(cursor, '\0', (size_t)(limit - cursor));
    if (!zero) { free(buffer); return 4; }
    cursor = zero;
    while (cursor < limit && !*cursor) cursor++;
    for (int index = 0; index < arguments; index++) {
      zero = memchr(cursor, '\0', (size_t)(limit - cursor));
      if (!zero) { free(buffer); return 4; }
      cursor = zero + 1;
    }
    const char prefix[] = "WARLOCK_PROCESS_TOKEN=";
    while (cursor < limit && *cursor) {
      zero = memchr(cursor, '\0', (size_t)(limit - cursor));
      if (!zero) { free(buffer); return 4; }
      size_t length = (size_t)(zero - cursor);
      if (length == sizeof(prefix) - 1 + 64 && !memcmp(cursor, prefix, sizeof(prefix) - 1)) {
        const char *candidate = cursor + sizeof(prefix) - 1;
        for (int index = 0; index < 64; index++) {
          if (!((candidate[index] >= '0' && candidate[index] <= '9') ||
                (candidate[index] >= 'a' && candidate[index] <= 'f'))) {
            free(buffer); return 4;
          }
        }
        memcpy(token, candidate, 64);
        break;
      }
      cursor = zero + 1;
    }
    free(buffer);
  }
  struct proc_taskallinfo after;
  if (proc_pidinfo(pid, PROC_PIDTASKALLINFO, 0, &after, sizeof(after)) != sizeof(after))
    return errno == ESRCH ? 3 : 4;
  if (after.pbsd.pbi_status == SZOMB) return 3;
  if (before.pbsd.pbi_start_tvsec != after.pbsd.pbi_start_tvsec ||
      before.pbsd.pbi_start_tvusec != after.pbsd.pbi_start_tvusec ||
      before.pbsd.pbi_pgid != after.pbsd.pbi_pgid) return 4;
  printf("{\"start\":\"%" PRIu64 ":%" PRIu64 "\",\"group\":%u,\"rss\":%" PRIu64
         ",\"state\":\"%s\",\"token\":\"%s\"}\n",
         after.pbsd.pbi_start_tvsec, after.pbsd.pbi_start_tvusec,
         after.pbsd.pbi_pgid, after.ptinfo.pti_resident_size,
         after.pbsd.pbi_status == SSTOP ? "T" : "R", token);
  return 0;
}
