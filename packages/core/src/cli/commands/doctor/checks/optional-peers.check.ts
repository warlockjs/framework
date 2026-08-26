import { createRequire } from "node:module";
import { config } from "../../../../config/config-getter";
import type { CheckStatus, DoctorCheck } from "../check.types";

/**
 * A package this project's own configuration requires, and what asked for it.
 */
type RequiredPeer = {
  /** The npm package name to probe via `require.resolve`. */
  package: string;

  /** The config that asked for it, quoted back to the user verbatim. */
  because: string;
};

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
 * A non-empty string, or `undefined`. Config values arrive from `env(...)` and
 * an unset variable yields `undefined` — but a `.env` line with nothing after
 * the `=` yields `""`, which is "not configured" just as much.
 */
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * The database driver's package. `driver` is a closed union in cascade
 * (`mongodb | postgres | mysql`), so an unrecognised value means the config is
 * wrong in a way this check is not the right one to report.
 */
function databasePeer(): RequiredPeer | undefined {
  const driver = text(config.get("database.driver"));

  const packageName =
    driver === "mongodb"
      ? "mongodb"
      : driver === "postgres"
        ? "pg"
        : driver === "mysql"
          ? "mysql2"
          : undefined;

  return packageName ? { package: packageName, because: `database.driver = "${driver}"` } : undefined;
}

/**
 * The selected cache driver. Only the DEFAULT matters: `cache.drivers` is a
 * menu the scaffold fills in for every driver the framework ships, and warning
 * about a menu entry nobody selected is the false positive this whole check was
 * rewritten to remove.
 */
function cachePeer(): RequiredPeer | undefined {
  const selected = text(config.get("cache.default"));

  if (!selected || !/redis/i.test(selected)) return undefined;

  return { package: "redis", because: `cache.default = "${selected}"` };
}

/**
 * The selected storage driver, read through its canonical `driver` field
 * (`local` / `s3` / `r2` / `spaces`) rather than the key the app happened to
 * name it, so a driver called "cdn" is still recognised as S3.
 */
function storagePeer(): RequiredPeer | undefined {
  const selected = text(config.get("storage.default"));

  if (!selected) return undefined;

  const driver = text(config.get(`storage.drivers.${selected}.driver`));

  if (!driver || driver === "local") return undefined;

  return {
    package: "@aws-sdk/client-s3",
    because: `storage.default = "${selected}" (driver "${driver}")`,
  };
}

/**
 * The mail transport. A `mail` config with no host and no driver is the
 * scaffold's placeholder — every field is an unset env var — so it asks for
 * nothing and this stays quiet.
 */
function mailPeer(): RequiredPeer | undefined {
  const driver = text(config.get("mail.driver"));

  if (driver === "ses") {
    return { package: "@aws-sdk/client-sesv2", because: `mail.driver = "ses"` };
  }

  const host = text(config.get("mail.host"));

  if (!host) return undefined;

  return { package: "nodemailer", because: `mail.host = "${host}"` };
}

/**
 * Realtime sockets. The connector no-ops without a `socket` config, so the
 * presence of that config is exactly the request for the peer.
 */
function socketPeer(): RequiredPeer | undefined {
  if (!config.get("socket")) return undefined;

  return { package: "socket.io", because: "a socket config is present" };
}

/**
 * Every peer THIS project's configuration asks for.
 */
function requiredPeers(): RequiredPeer[] {
  return [databasePeer(), cachePeer(), storagePeer(), mailPeer(), socketPeer()].filter(
    (peer): peer is RequiredPeer => Boolean(peer),
  );
}

/**
 * Checks that every optional peer the project's own configuration selects is
 * actually installed.
 *
 * NEEDS NO BOOTED APP — it reads config and resolves module paths. It runs after
 * the boot pass only because config is loaded by then.
 *
 * WHAT THIS REPLACED, AND WHY: the previous version probed nine packages and
 * warned about every one that was absent. Every one of them is an OPTIONAL
 * peer — a fresh app installs none of them by design — so the check warned, at
 * length, about the framework's own default state. "No MySQL driver installed"
 * is not a diagnosis for someone who never wanted MySQL; it is noise that
 * teaches the reader to skim past the line where a real finding will one day
 * appear.
 *
 * Inverted, it becomes a genuine one: a project whose config selects a driver
 * whose package is missing is broken — it will throw the first time that
 * feature is used — so a missing peer here is a `fail`, not a warning.
 */
export const optionalPeersCheck: DoctorCheck = {
  name: "optional-peers",
  run: () => {
    const required = requiredPeers();

    if (required.length === 0) {
      return undefined;
    }

    const missing = required.filter((peer) => !isInstalled(peer.package));

    const status: CheckStatus = missing.length > 0 ? "fail" : "ok";

    if (missing.length > 0) {
      return {
        name: "optional-peers",
        status,
        detail:
          `${missing.length} configured feature(s) have no driver installed:\n` +
          missing.map((peer) => `  - ${peer.package} — required by ${peer.because}`).join("\n"),
      };
    }

    return {
      name: "optional-peers",
      status,
      detail: `every configured driver is installed (${required
        .map((peer) => peer.package)
        .join(", ")})`,
    };
  },
};
