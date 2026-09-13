// MIT License - Copyright (c) fintonlabs.com
/**
 * Stands in for electron-updater in `npm run verify:updater`.
 *
 * The prompt under test never touches the real updater — every side effect is
 * injected — and loading the real one outside a packaged app goes looking for
 * app-update.yml. So the test bundle aliases the package to this.
 */
module.exports = { autoUpdater: {} }
