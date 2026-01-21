# @nxame/net-speed

A production-ready, zero-dependency CLI speed test for macOS, Linux, and Windows.

## Install

```bash
npm i -g @nxame/net-speed
```

Or from this repo:

```bash
npm i -g .
```

## Usage

```bash
net-speed
```

### Common flags

```bash
net-speed --d
net-speed --u
net-speed --ping-only
net-speed --json
net-speed --no-ui
net-speed --ping-only --samples 50
NO_COLOR=1 net-speed
```

### Options

- `--d`, `--download-only`: run ping + download only
- `--u`, `--upload-only`: run ping + upload only
- `--ping-only`: run only latency/jitter/loss
- `--json`: machine-readable JSON output
- `--no-ui`, `--t`, `--text`: plain text, no ANSI
- `--no-ansi`: disable ANSI colors even in TTY
- `--emoji`: allow emojis in output
- `--server <url>`: override base URL for endpoints
- `--ping-host <host>`: ping target (default `1.1.1.1`)
- `--samples <n>`: ping samples (default `20`)
- `--trials <n>`: throughput trials (default `3`, min 1, max 10)
- `--size <mb>`: transfer size per trial (default `25` for download, `10` for upload)
- `--concurrency <n>`: parallel download streams (default `2`)
- `--timeout <ms>`: request timeout (default `15000`)
- `--force-ui`: force TUI even when not in a TTY
- `--verbose`: print selected endpoints and errors
- `--help`, `--version`

## Output examples

### TUI

```text
┌──────────────────────────────────────────────────────────────────┐
│ net-speed > speed.cloudflare.com                                 │
├──────────────────────────────────────────────────────────────────┤
│ DOWNLOAD SPEED                                                   │
│  312.4 Mbps                                                      │
│  ▄▅▆▇▆▆▆▇▇▇▇▇▆▆▅▆▇▇▇▇▆▆▆▇▇▇▆▇▇▆▆▆▅▆▇▇▇▇▇▇▆▇▇▇▆▇▆▇▇▆▆▆▇▆▆▇▇▆  │
│                                                                  │
│ PING LATENCY                                                     │
│  16.2 ms   jitter 2.4 ms   loss 0.0%                             │
│  ▂▃▅▆▇▆▇▇▆▆▇▇▆▇▇▆▇▇▇▆▇▇▆▆▇▆▇▇▆▇▆▆▇▇▇▇▇▆▆▇▇▇▆▇▆▇▇▆▇▇▆▇▇▆▇▇▇▇▇▆  │
│                                                                  │
│ UPLOAD SPEED                                                     │
│  42.8 Mbps                                                       │
│  ▂▃▄▅▆▆▇▇▇▇▆▇▇▇▆▇▆▇▆▇▇▇▇▆▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇  │
└──────────────────────────────────────────────────────────────────┘
```

### JSON

```json
{
  "version": "0.1.0",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "server": "speed.cloudflare.com",
  "ping_host": "1.1.1.1",
  "samples": 20,
  "trials": 3,
  "metrics": {
    "download_mbps": {
      "median": 312.4,
      "mean": 300.2,
      "p95": null,
      "trials": [302.1, 315.0, 320.1]
    },
    "upload_mbps": {
      "median": 42.8,
      "mean": 41.2,
      "p95": null,
      "trials": [40.1, 42.8, 40.6]
    },
    "latency_idle_ms": {
      "median": 16.2,
      "mean": 17.0,
      "jitter": 2.4,
      "loss_pct": 0,
      "samples": [16.1, 15.8, 17.2]
    },
    "latency_loaded_ms": null
  },
  "errors": []
}
```

## Notes

- Download/upload tests stream data and avoid large buffers.
- `NO_COLOR=1` disables ANSI colors automatically.
- If stdout is not a TTY, UI mode is disabled unless `--force-ui` is provided.

## License

MIT
