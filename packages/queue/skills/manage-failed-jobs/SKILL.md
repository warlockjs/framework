---
name: manage-failed-jobs
description: 'Inspect and retry failed `@warlock.js/queue` jobs: `failedJobs({ queue, start, end })` returns `FailedJob[]` (`id`, `name`, `payload`, `attemptsMade`, `failedReason`, `stacktrace`, `failedAt`, `retry()`), `retryFailedJob(id, { queue })` (throws `FailedJobNotFoundError`), and the optional bull-board UI via `queueDashboard(server, { basePath, queues })` — needs `@bull-board/api` + `@bull-board/fastify`, loaded only on call, missing ones throw `QueueDashboardDependencyError`. Triggers: `failedJobs`, `retryFailedJob`, `queueDashboard`, `bull-board`; "list failed jobs", "retry a failed job", "queue dashboard", "job admin UI". Skip: defining retries — `@warlock.js/queue/define-jobs/SKILL.md`.'
---

# Failed jobs

A job is failed once it has used every attempt, or failed in a way that cannot be retried (for example, no handler for its name). Failed jobs are kept unless you set `removeOnFail`.

```ts
import { failedJobs, retryFailedJob } from "@warlock.js/queue";

const failed = await failedJobs({ queue: "default", start: 0, end: 49 }); // newest first

for (const job of failed) {
  console.log(job.name, job.failedReason, job.attemptsMade);
}

await failed[0]?.retry(); // back to waiting
await retryFailedJob("invoice:43"); // by id; throws FailedJobNotFoundError if not failed
```

## Dashboard (optional)

```sh
npm install @bull-board/api @bull-board/fastify
```

```ts
import { getHttpServer } from "@warlock.js/core";
import { queueDashboard } from "@warlock.js/queue";

await queueDashboard(getHttpServer(), { basePath: "/admin/queues" });
```

- Call it before the HTTP server starts listening.
- Shows every queue that has a job, plus the default queue, unless you pass `queues`.
- It has no authentication of its own, and it can retry and delete jobs. Protect the path.
