# playwright-ws-trace 🔌

> WebSocket frame tracing for Playwright - see every WebSocket message in your traces!

[![npm version](https://badge.fury.io/js/playwright-ws-trace.svg)](https://www.npmjs.com/package/playwright-ws-trace)

This package implements the long-requested feature from [Issue #10996](https://github.com/microsoft/playwright/issues/10996) (👍 49+ upvotes since 2021). Microsoft rejected our [PR #38427](https://github.com/microsoft/playwright/pull/38427), so we made it ourselves. 💪

## Features

- 📡 **Record WebSocket frames** - Captures all sent and received frames during test execution
- 🔍 **View in trace viewer** - Browse WebSocket connections and frames in the standard Playwright trace viewer
- 🎯 **Filter by type** - New "WS" filter in the Network tab to show only WebSocket traffic
- 📊 **Frame details** - See direction (sent/received), timestamps, and payload data
- 📝 **JSON formatting** - Automatically formats JSON payloads for readability

## Installation

```bash
npm install playwright-ws-trace
# or
yarn add playwright-ws-trace
# or
pnpm add playwright-ws-trace
```

The package automatically patches your Playwright installation on install. That's it!

## Usage

### 1. Enable tracing in your tests

Configure in `playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  use: {
    trace: 'on', // or 'on-first-retry', 'retain-on-failure'
  },
});
```

Or start tracing manually:

```typescript
import { test } from '@playwright/test';

test('websocket test', async ({ page, context }) => {
  await context.tracing.start({ snapshots: true, screenshots: true });
  
  await page.goto('https://your-websocket-app.com');
  // Your test actions...
  
  await context.tracing.stop({ path: 'trace.zip' });
});
```

### 2. View WebSocket traces

Use the standard Playwright trace viewer:

```bash
npx playwright show-trace ./test-results/my-test/trace.zip
```

Or open from HTML report - click "View Trace" on any test.

### 3. Find WebSocket data

In the trace viewer:
1. Click the **Network** tab
2. Click the **WS** filter to show only WebSocket traffic
3. Click on a WebSocket connection to see frames
4. View sent (↑) and received (↓) frames with full payload data

## Screenshot

![Trace Viewer with WS filter](https://raw.githubusercontent.com/kabaneridev/playwright-ws-trace/main/demo.png)

## How it works

This package patches Playwright on install:

1. **Recording** (`tracing.js`) - Hooks into CDP events to capture:
   - `webSocketCreated` - Connection opened
   - `webSocketFrameSent` - Frame sent to server
   - `webSocketFrameReceived` - Frame received from server
   - `webSocketClosed` - Connection closed
   - `webSocketError` - Connection error

2. **Trace Viewer** - Replaces the bundled viewer with a patched version that:
   - Adds "WS" filter to Network tab
   - Displays WebSocket connections and frames
   - Shows frame direction, timestamp, and payload

## Compatibility

| Playwright | Status |
|------------|--------|
| 1.50.x - 1.56.x | ✅ Tested |
| 1.40.0+    | ⚠️ Should work |

## After Playwright Updates

When you update Playwright, the patches need to be reapplied:

```bash
# Reinstall to reapply patches
npm uninstall playwright-ws-trace && npm install playwright-ws-trace

# Or run postinstall manually
node node_modules/playwright-ws-trace/scripts/postinstall.js --force
```

## Troubleshooting

### Patches not applying

Run the postinstall script with `--force`:

```bash
node node_modules/playwright-ws-trace/scripts/postinstall.js --force
```

### WS filter not showing

Make sure the patched trace viewer was installed. Check that:
```bash
ls node_modules/playwright-core/lib/vite/traceViewer/
```
Contains files from this package.

### WebSocket frames not recorded

Ensure tracing is enabled in your config with `trace: 'on'` or similar.

## Contributing

PRs welcome! The original PR to Playwright is at [#38427](https://github.com/microsoft/playwright/pull/38427).

If Microsoft ever accepts WebSocket tracing into Playwright core, this package will become obsolete - and that's a good thing! 🎉

## License

MIT - do whatever you want with it.

---

Made with ❤️ because Microsoft said no.
