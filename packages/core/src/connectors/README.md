# Connectors

Lifecycle management for all framework subsystems (HTTP server, database, cache, storage, message broker, sockets, notifications, access, AI). Each connector wraps the startup/shutdown logic for one subsystem. The `ConnectorsManager` orchestrates them by priority.

## Key Files

| File                          | Purpose                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| `base-connector.ts`           | `BaseConnector` abstract class — name, priority, `start()`, `shutdown()`                   |
| `logger-connector.ts`         | Initializes the logging subsystem                                                          |
| `mail-connector.ts`           | Initializes the mailer subsystem                                                           |
| `http-connector.ts`           | Starts the Fastify HTTP server                                                             |
| `database-connector.ts`       | Connects to the database via `@warlock.js/cascade`                                         |
| `herald-connector.ts`         | Connects to message brokers via `@warlock.js/herald`                                       |
| `cache-connector.ts`          | Initializes the cache subsystem via `@warlock.js/cache`                                    |
| `storage.connector.ts`        | Initializes file storage drivers                                                           |
| `socket-connector.ts`         | Starts the Socket.IO realtime server                                                       |
| `notifications-connector.ts`  | Wires `@warlock.js/notifications` from config                                              |
| `access-connector.ts`         | Wires `@warlock.js/access` authorization from config                                       |
| `ai-connector.ts`             | Wires `@warlock.js/ai` from config                                                         |
| `connectors-manager.ts`       | `ConnectorsManager` — registers, starts, shuts down connectors; handles `SIGINT`/`SIGTERM` |
| `types.ts`                    | `Connector`, `ConnectorName`, `ConnectorPriority`, `ConnectorLifecyclePhase` types         |
| `index.ts`                    | Barrel export                                                                              |

## Key Exports

- `connectorsManager` — singleton `ConnectorsManager` instance
- `BaseConnector` — abstract base for custom connectors
- `LoggerConnector`, `MailerConnector`, `HttpConnector`, `DatabaseConnector`, `HeraldConnector`, `CacheConnector`, `StorageConnector`, `SocketConnector`, `NotificationsConnector`, `AccessConnector`, `AiConnector`
- `Connector`, `ConnectorName` types

## Dependencies

### Internal (within `core/src`)

- `../dev-server/dev-logger` — colored log output
- `../config` — reads subsystem-specific configuration
- `../http` — HTTP server instance
- `../router` — route scanning on HTTP start
- `../storage` — storage driver initialization

### External

- `@warlock.js/cache` — cache driver startup
- `@warlock.js/cascade` — database connection
- `@warlock.js/herald` — communicator connection

## Used By

- Application startup (`bootstrap` → `connectors.start()`)
- `dev-server/` — starts connectors during development
- `production/` — starts connectors during production build
- `tests/` — starts subset of connectors for test environment
