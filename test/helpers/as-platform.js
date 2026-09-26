// Loaded with `node --import` ahead of the kit, by `asPlatform` in cli.js: the
// process takes OBK_TEST_PLATFORM for its `process.platform`. The kit reloads
// Orca's window only on macOS (#343), and CI runs on Linux, so a test of the
// reload says which platform the run is on rather than taking the machine's.
// Without the variable it changes nothing.

const platform = process.env.OBK_TEST_PLATFORM;
if (platform !== undefined && platform !== '') {
  Object.defineProperty(process, 'platform', { value: platform, enumerable: true, configurable: true });
}
