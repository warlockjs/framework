// The quiet failure: app code decides it cannot continue and exits cleanly,
// without ever having served anything. Exit code 0 here is a lie the supervisor
// must not pass on.
process.exit(0);
