#!/usr/bin/env node
/**
 * Postinstall script for playwright-ws-trace
 * Patches Playwright to add WebSocket frame tracing support
 */

const fs = require('fs');
const path = require('path');

const PACKAGE_ROOT = path.join(__dirname, '..');

// Colors for console output
const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function findPlaywrightCore() {
  const possiblePaths = [
    path.join(process.cwd(), 'node_modules', 'playwright-core'),
    path.join(process.cwd(), 'node_modules', '@playwright', 'test', 'node_modules', 'playwright-core'),
    path.join(process.cwd(), '..', 'node_modules', 'playwright-core'),
    path.join(process.cwd(), '..', '..', 'node_modules', 'playwright-core'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // Bun monorepo: packages are hoisted to node_modules/.bun/
  const bunDir = path.join(process.cwd(), 'node_modules', '.bun');
  if (fs.existsSync(bunDir)) {
    try {
      const entries = fs.readdirSync(bunDir);
      const pwCoreDir = entries.find(e => e.startsWith('playwright-core@'));
      if (pwCoreDir) {
        const bunPath = path.join(bunDir, pwCoreDir, 'node_modules', 'playwright-core');
        if (fs.existsSync(bunPath)) {
          return bunPath;
        }
      }
    } catch {
      // ignore errors reading .bun directory
    }
  }

  try {
    const resolved = require.resolve('playwright-core/package.json', { paths: [process.cwd()] });
    return path.dirname(resolved);
  } catch {
    return null;
  }
}

function patchTracingJs(playwrightCorePath) {
  const tracingPath = path.join(playwrightCorePath, 'lib', 'server', 'trace', 'recorder', 'tracing.js');
  
  if (!fs.existsSync(tracingPath)) {
    log(`  File not found: ${tracingPath}`, 'red');
    return false;
  }

  let content = fs.readFileSync(tracingPath, 'utf-8');

  // Check if already patched
  if (content.includes('_startWebSocketTracing')) {
    log('  tracing.js already patched ✓', 'cyan');
    return true;
  }

  // 1. Add import for network module (after import_page)
  const importMarker = 'var import_page = require("../../page");';
  if (!content.includes(importMarker)) {
    log('  Could not find import_page marker', 'red');
    return false;
  }
  content = content.replace(
    importMarker,
    `${importMarker}\nvar import_network = require("../../network");`
  );

  // 2. Add call to _startWebSocketTracing after _snapshotter?.start()
  // Handle different formatting styles
  const patterns = [
    {
      find: /await this\._snapshotter\?\.start\(\);\s*\n\s*return \{ traceName: this\._state\.traceName \};/,
      replace: `await this._snapshotter?.start();
    this._startWebSocketTracing();
    return { traceName: this._state.traceName };`
    }
  ];

  let patched = false;
  for (const pattern of patterns) {
    if (pattern.find.test(content)) {
      content = content.replace(pattern.find, pattern.replace);
      patched = true;
      break;
    }
  }

  if (!patched) {
    log('  Could not find startChunk return statement', 'red');
    return false;
  }

  // 3. Add WebSocket tracing methods before _allocateNewTraceFile
  const wsTracingCode = `
  _startWebSocketTracing() {
    if (!(this._context instanceof import_browserContext.BrowserContext))
      return;
    for (const page of this._context.pages())
      this._startWebSocketTracingInPage(page);
    this._eventListeners.push(
      import_eventsHelper.eventsHelper.addEventListener(this._context, import_browserContext.BrowserContext.Events.Page, this._startWebSocketTracingInPage.bind(this))
    );
  }
  _startWebSocketTracingInPage(page) {
    this._eventListeners.push(
      import_eventsHelper.eventsHelper.addEventListener(page, import_page.Page.Events.WebSocket, (ws) => {
        this._onWebSocketCreated(ws, page);
      })
    );
  }
  _onWebSocketCreated(ws, page) {
    const wsGuid = ws.guid;
    const event = {
      type: "websocket-created",
      wsGuid,
      timestamp: (0, import_time.monotonicTime)(),
      url: ws.url(),
      pageId: page.guid
    };
    this._appendTraceEvent(event);
    const frameListener = (frameEvent, direction) => {
      const frameTraceEvent = {
        type: "websocket-frame",
        wsGuid,
        timestamp: (0, import_time.monotonicTime)(),
        opcode: frameEvent.opcode,
        data: frameEvent.data,
        direction
      };
      this._appendTraceEvent(frameTraceEvent);
    };
    this._eventListeners.push(
      import_eventsHelper.eventsHelper.addEventListener(ws, import_network.WebSocket.Events.FrameSent, (e) => frameListener(e, "sent")),
      import_eventsHelper.eventsHelper.addEventListener(ws, import_network.WebSocket.Events.FrameReceived, (e) => frameListener(e, "received")),
      import_eventsHelper.eventsHelper.addEventListener(ws, import_network.WebSocket.Events.SocketError, (error) => {
        const errorEvent = {
          type: "websocket-error",
          wsGuid,
          timestamp: (0, import_time.monotonicTime)(),
          error
        };
        this._appendTraceEvent(errorEvent);
      }),
      import_eventsHelper.eventsHelper.addEventListener(ws, import_network.WebSocket.Events.Close, () => {
        const closeEvent = {
          type: "websocket-closed",
          wsGuid,
          timestamp: (0, import_time.monotonicTime)()
        };
        this._appendTraceEvent(closeEvent);
      })
    );
  }
`;

  const allocateMarker = '_allocateNewTraceFile(state) {';
  if (content.includes(allocateMarker)) {
    content = content.replace(
      allocateMarker,
      wsTracingCode + '\n  ' + allocateMarker
    );
  } else {
    log('  Could not find _allocateNewTraceFile marker', 'red');
    return false;
  }

  fs.writeFileSync(tracingPath, content, 'utf-8');
  log('  ✓ Patched tracing.js (WebSocket recording enabled)', 'green');
  return true;
}

function copyBuiltViewer(playwrightCorePath) {
  // Copy pre-built trace viewer from our package if available
  const prebuiltDir = path.join(PACKAGE_ROOT, 'dist', 'traceViewer');
  const targetDir = path.join(playwrightCorePath, 'lib', 'vite', 'traceViewer');

  if (fs.existsSync(prebuiltDir)) {
    log('  Copying pre-built trace viewer with WebSocket support...', 'cyan');
    copyDirRecursive(prebuiltDir, targetDir);
    log('  ✓ Installed custom trace viewer', 'green');
    return true;
  }
  
  return false;
}

function patchTraceViewerBundle(playwrightCorePath) {
  const assetsDir = path.join(playwrightCorePath, 'lib', 'vite', 'traceViewer', 'assets');
  
  if (!fs.existsSync(assetsDir)) {
    log('  Trace viewer assets not found', 'yellow');
    return false;
  }

  const files = fs.readdirSync(assetsDir);
  const bundleFile = files.find(f => f.startsWith('defaultSettingsView-') && f.endsWith('.js'));
  
  if (!bundleFile) {
    log('  Bundle file not found', 'yellow');
    return false;
  }

  const bundlePath = path.join(assetsDir, bundleFile);
  let content = fs.readFileSync(bundlePath, 'utf-8');

  if (content.includes('"WS"')) {
    log('  Trace viewer already has WS filter ✓', 'cyan');
    return true;
  }

  // Add WS to resource types filter
  const resourceTypesMarker = '"Fetch","HTML","JS","CSS","Font","Image"';
  if (content.includes(resourceTypesMarker)) {
    content = content.replace(
      resourceTypesMarker,
      '"Fetch","HTML","JS","CSS","Font","Image","WS"'
    );
    log('  ✓ Added WS filter to trace viewer', 'green');
  }

  // Add WS content type predicate  
  const predicatesPattern = /(Font:\w+=>\w+\.includes\("font"\),Image:\w+=>\w+\.includes\("image"\))/;
  const match = content.match(predicatesPattern);
  if (match) {
    content = content.replace(
      predicatesPattern,
      '$1,WS:e=>e==="websocket"'
    );
    log('  ✓ Added WS type predicate', 'green');
  }

  fs.writeFileSync(bundlePath, content, 'utf-8');
  return true;
}

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function main() {
  console.log('');
  log('╔══════════════════════════════════════════════════════════════╗', 'cyan');
  log('║           playwright-ws-trace - WebSocket Tracing            ║', 'cyan');
  log('╚══════════════════════════════════════════════════════════════╝', 'cyan');
  console.log('');

  const isPostInstall = process.env.npm_lifecycle_event === 'postinstall';
  
  if (!isPostInstall && !process.argv.includes('--force')) {
    log('Not running as postinstall. Use --force to run manually.', 'yellow');
    log('Example: node scripts/postinstall.js --force', 'yellow');
    return;
  }

  const playwrightCorePath = findPlaywrightCore();

  if (!playwrightCorePath) {
    log('⚠️  No Playwright installation found.', 'yellow');
    log('   Install @playwright/test first, then reinstall this package.', 'yellow');
    console.log('');
    return;
  }

  log(`Found playwright-core: ${playwrightCorePath}`, 'green');
  console.log('');
  log('Applying patches...', 'bold');
  console.log('');

  // Step 1: Patch recording (tracing.js) - this is the main feature
  log('1. Patching WebSocket recording...', 'cyan');
  const tracingSuccess = patchTracingJs(playwrightCorePath);

  // Step 2: Try to install pre-built viewer, or patch the bundle minimally
  log('2. Patching trace viewer...', 'cyan');
  const viewerSuccess = copyBuiltViewer(playwrightCorePath) || patchTraceViewerBundle(playwrightCorePath);

  console.log('');
  
  if (tracingSuccess) {
    log('═══════════════════════════════════════════════════════════════', 'green');
    log('✓ Playwright WebSocket tracing enabled!', 'green');
    log('═══════════════════════════════════════════════════════════════', 'green');
    console.log('');
    log('WebSocket frames will now be recorded in your traces.', 'cyan');
    console.log('');
    
    if (!viewerSuccess) {
      log('ℹ️  Trace viewer: WS filter added, but full WebSocket panel requires', 'yellow');
      log('   the custom-built viewer. Run: npx playwright-ws-trace view <trace.zip>', 'yellow');
    } else {
      log('ℹ️  Use npx playwright show-trace <trace.zip> to view traces', 'cyan');
    }
  } else {
    log('═══════════════════════════════════════════════════════════════', 'red');
    log('✗ Failed to patch Playwright', 'red');
    log('═══════════════════════════════════════════════════════════════', 'red');
    console.log('');
    log('Your Playwright version may not be compatible.', 'yellow');
    log('Tested with: @playwright/test ^1.40.0', 'yellow');
  }
  
  console.log('');
}

main();
