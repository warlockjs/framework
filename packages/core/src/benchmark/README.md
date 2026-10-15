# Benchmark

Performance measurement utility. Wraps sync/async function execution with timing and latency classification, plus optional aggregation (profiler) and raw capture (snapshots).

## Key Files

| File                     | Purpose                                                                          |
| ------------------------ | -------------------------------------------------------------------------------- |
| `benchmark.ts`           | `measure()` — times execution, classifies latency, fires hooks, records to sinks |
| `profiler.ts`            | `BenchmarkProfiler` — ring-buffer percentiles (p50/p90/p95/p99), counts, errorRate |
| `benchmark-snapshots.ts` | `BenchmarkSnapshots` — bounded raw result capture (error/value/all)              |
| `channels/`              | `BenchmarkChannel` implementations (`ConsoleChannel`, `NoopChannel`)             |
| `types.ts`               | `BenchmarkOptions`, `BenchmarkResult`, `BenchmarkConfigurations`, stats types     |
| `index.ts`               | Barrel export                                                                    |

## Key Exports

- `measure(name, fn, options?)` — runs `fn`, returns a discriminated result: on success `{ success: true, value, latency, state, ... }`, on a benchmarked error `{ success: false, error, latency, state, ... }`. Never throws unless `shouldBenchmarkError` opts out.
- `BenchmarkProfiler` / `BenchmarkSnapshots` — aggregation + capture
- `ConsoleChannel` / `NoopChannel` — flush targets
- `BenchmarkOptions` / `BenchmarkResult` / `BenchmarkConfigurations` — types

## Dependencies

### Internal (within `core/src`)

- `../config` — reads `config.get("benchmark")` for default `latencyRange` / `profiler` / `snapshotContainer`

### External

- None

## Used By

- `use-cases/` — benchmarks the use case **handler** (enabled by default; the latency excludes the guard/validation prelude and retry delays)
- Any module that needs to profile a function call
