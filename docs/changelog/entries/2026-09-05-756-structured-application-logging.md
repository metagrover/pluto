### Structured application logging with environment-aware transports

- **Issue:** [#756](https://github.com/metagrover/pluto/issues/756)
- **PR:** [#757](https://github.com/metagrover/pluto/pull/757)
- **Changed:** Introduced a lightweight, zero-dependency structured logging architecture (`electron/logger.ts`) with distinct developer and production release profiles. In development, logs feature ANSI color coding, precise timestamps, log level badges, and bright subsystem scopes (`[DB]`, `[Pluto]`, `[AudioCap]`, `[Recorder]`, `[LLM]`). High-frequency startup operations (such as individual database column migration checks) were demoted to `debug` level. In packaged releases, logs automatically persist to rotating files in `~/Library/Logs/Pluto/main.log` (capped at 5MB, up to 3 archives) while suppressing non-error terminal output.
- **Why:** Previous logging relied on ad-hoc `console.log` calls that flooded developer terminals with dozens of column checks on every startup, while packaged releases lacked standard macOS app log files for troubleshooting and risked uncaught `EPIPE`/`EIO` exceptions when writing to detached TTYs.
- **Replaced:** Uncoordinated, unformatted `console.log` statements in the Electron main process and noisy database migration output.
- **Notes:** Log level threshold is configurable via `PLUTO_LOG_LEVEL` (`debug`, `info`, `warn`, `error`, `silent`).
