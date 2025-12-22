/**
 * playwright-ws-trace
 * 
 * Adds WebSocket frame tracing to Playwright.
 * This package patches Playwright on postinstall to:
 * - Record WebSocket frames during test execution
 * - Display them in the trace viewer
 * 
 * @see https://github.com/kabaneridev/playwright-ws-trace
 */

module.exports = {
  name: 'playwright-ws-trace',
  version: require('../package.json').version,
};
