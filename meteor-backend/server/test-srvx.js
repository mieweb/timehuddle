/**
 * Test: Can Meteor import srvx with full path?
 */
try {
  const srvx = require('srvx/dist/adapters/node.mjs');
  console.log('[test-srvx] require(full path) SUCCESS:', typeof srvx);
} catch (e) {
  console.log('[test-srvx] require(full path) FAILED:', e.message);
}

try {
  import('srvx/dist/adapters/node.mjs').then((mod) => {
    console.log('[test-srvx] import(full path) SUCCESS:', typeof mod);
  }).catch((err) => {
    console.log('[test-srvx] import(full path) FAILED:', err.message);
  });
} catch (e) {
  console.log('[test-srvx] import(full path) SYNC FAILED:', e.message);
}
