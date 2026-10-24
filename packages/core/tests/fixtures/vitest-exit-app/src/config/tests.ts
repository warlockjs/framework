// "file" (the default) or "worker", chosen by the spawning test.
export default {
  lifetime: process.env.EXIT_APP_LIFETIME === "worker" ? "worker" : "file",
};
