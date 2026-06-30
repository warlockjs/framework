import { createRequire } from "node:module";
import type { DoctorCheck } from "../check.types";

/**
 * A single optional peer dependency and the feature it unlocks. These are NOT
 * bundled by core — each is loaded lazily by the connector/driver that needs
 * it, so a missing peer simply means that feature is unavailable (a `warn`),
 * never a failure.
 */
type OptionalPeer = {
  /** The npm package name to probe via `require.resolve`. */
  package: string;

  /** The framework feature this peer enables. */
  feature: string;
};

/**
 * The optional peers core knows how to use. Kept in sync with the install
 * targets in the `warlock add` feature registry (sharp, nodemailer, socket.io,
 * the AWS SDK family, redis, the Cascade DB drivers, …).
 */
const OPTIONAL_PEERS: OptionalPeer[] = [
  { package: "sharp", feature: "image processing" },
  { package: "nodemailer", feature: "mail (SMTP) channel" },
  { package: "socket.io", feature: "realtime socket server" },
  { package: "@aws-sdk/client-s3", feature: "S3 cloud storage" },
  { package: "@aws-sdk/client-sesv2", feature: "Amazon SES mail channel" },
  { package: "redis", feature: "Redis cache driver" },
  { package: "mongodb", feature: "MongoDB database driver" },
  { package: "pg", feature: "Postgres database driver" },
  { package: "mysql2", feature: "MySQL database driver" },
];

/**
 * Resolve from the project's working directory, not from core's own
 * `node_modules`, so the probe reflects what the *consuming app* has installed.
 */
const projectRequire = createRequire(`${process.cwd()}/package.json`);

/**
 * Whether a package can be resolved from the project. A failed resolve (the
 * normal "not installed" case) is swallowed and reported as missing.
 */
function isInstalled(packageName: string): boolean {
  try {
    projectRequire.resolve(packageName);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detects which optional peer dependencies are installed and which are not,
 * reporting the features that are consequently unavailable. Missing peers are
 * a `warn` (the feature is simply off), never a `fail`.
 *
 * Read-only: resolves module paths only; never imports or executes the peers.
 */
export const optionalPeersCheck: DoctorCheck = {
  name: "optional-peers",
  run: () => {
    const missing = OPTIONAL_PEERS.filter((peer) => !isInstalled(peer.package));

    if (missing.length === 0) {
      return {
        name: "optional-peers",
        status: "ok",
        detail: `all ${OPTIONAL_PEERS.length} known optional peers installed`,
      };
    }

    const unavailable = missing
      .map((peer) => `${peer.package} (${peer.feature})`)
      .join("; ");

    return {
      name: "optional-peers",
      status: "warn",
      detail: `not installed → unavailable: ${unavailable}`,
    };
  },
};
