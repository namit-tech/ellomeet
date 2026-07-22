const util = require('util');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * NODE VERSION WORKAROUND — remove this once Node is on a supported release.
 *
 * React Native 0.86 requires Node ^20.19.4 || ^22.13.0 || ^24.3.0 || >=25.
 * On Node 21 (a dead non-LTS release that happens to sit in the gap),
 * `util.styleText` exists but only accepts a single format string. Metro's
 * TerminalReporter calls it with `['blue', 'bold']`, which throws — and it
 * throws while *constructing the bundler*, so `assembleRelease` dies with a
 * useless "command 'cmd' finished with non-zero exit value 1".
 *
 * Feature-detected rather than version-checked, so it disappears by itself the
 * moment Node is upgraded, instead of lingering as a stale version comparison.
 */
function styleTextSupportsArrays() {
  try {
    util.styleText(['blue', 'bold'], 'x');
    return true;
  } catch {
    return false;
  }
}

const config = {};

if (!styleTextSupportsArrays()) {
  console.warn(
    '[metro] Node ' +
      process.version +
      ' is not a supported React Native version; using a plain reporter. ' +
      'Upgrade to Node 22 LTS to remove this workaround.',
  );
  // Minimal stand-in for TerminalReporter. Purely presentational — it does not
  // touch bundling, only what gets printed.
  config.reporter = {
    update(event) {
      if (event.type === 'bundle_build_done') console.log('[metro] bundle built');
      if (event.type === 'bundle_build_failed') console.error('[metro] bundle FAILED');
      if (event.type === 'bundling_error') console.error('[metro]', event.error);
    },
  };
}

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
