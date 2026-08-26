import { accessFeature } from "./access.feature";
import { aiAnthropicFeature } from "./ai-anthropic.feature";
import { aiBedrockFeature } from "./ai-bedrock.feature";
import { aiGoogleFeature } from "./ai-google.feature";
import { aiOllamaFeature } from "./ai-ollama.feature";
import { aiOpenaiFeature } from "./ai-openai.feature";
import { aiPanopticFeature } from "./ai-panoptic.feature";
import { aiToolsFeature } from "./ai-tools.feature";
import { aiWorkspaceFeature } from "./ai-workspace.feature";
import { aiFeature } from "./ai.feature";
import { heraldFeature } from "./herald.feature";
import { imageFeature } from "./image.feature";
import { mailFeature } from "./mail.feature";
import { mongodbFeature } from "./mongodb.feature";
import { mysqlFeature } from "./mysql.feature";
import { notificationsFeature } from "./notifications.feature";
import { postgresFeature } from "./postgres.feature";
import { reactEmailFeature } from "./react-email.feature";
import { reactFeature } from "./react.feature";
import { redisFeature } from "./redis.feature";
import { s3Feature } from "./s3.feature";
import { schedulerFeature } from "./scheduler.feature";
import { sesFeature } from "./ses.feature";
import { shadcnFeature } from "./shadcn.feature";
import { socketFeature } from "./socket.feature";
import { tailwindFeature } from "./tailwind.feature";
import { testFeature } from "./test.feature";
import { FeatureDefinition } from "./types";
import { webFeature } from "./web.feature";

export type { FeatureDefinition } from "./types";

/**
 * The feature registry `warlock add` dispatches against.
 *
 * This file is an INDEX, nothing more: every entry lives in its own module
 * alongside the `onExecuting` body it runs. Key order is load-bearing — it is
 * the order `--list` prints and the order the "not allowed" error lists — so
 * add new features in the place they should appear, not alphabetically.
 */
export const featuresMap: Record<string, FeatureDefinition> = {
  "react-email": reactEmailFeature,
  react: reactFeature,
  image: imageFeature,
  mail: mailFeature,
  ses: sesFeature,
  mongodb: mongodbFeature,
  scheduler: schedulerFeature,
  // swagger / postman intentionally omitted — those packages do not exist yet;
  // they will ship together in the unified @warlock.js/api-docs package.
  postgres: postgresFeature,
  mysql: mysqlFeature,
  redis: redisFeature,
  s3: s3Feature,
  test: testFeature,
  web: webFeature,
  // Directly after `web`, and only there: it `requires` it, it is useless
  // without it, and a reader scanning `--list` for the page stack should meet
  // the two together rather than find styling filed between queues and sockets.
  tailwind: tailwindFeature,
  // Immediately after `tailwind`, for the same reason `tailwind` follows `web`:
  // it `requires` it, it appends to the stylesheet that feature creates, and the
  // three of them are one stack a reader should meet in build order.
  shadcn: shadcnFeature,
  herald: heraldFeature,
  socket: socketFeature,
  notifications: notificationsFeature,
  access: accessFeature,
  ai: aiFeature,
  "ai-openai": aiOpenaiFeature,
  "ai-google": aiGoogleFeature,
  "ai-anthropic": aiAnthropicFeature,
  "ai-bedrock": aiBedrockFeature,
  "ai-ollama": aiOllamaFeature,
  "ai-tools": aiToolsFeature,
  "ai-panoptic": aiPanopticFeature,
  "ai-workspace": aiWorkspaceFeature,
};
