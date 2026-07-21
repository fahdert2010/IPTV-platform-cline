'use strict';

/**
 * Player Module — Browser-based HLS.js player manager.
 *
 * Used by the Viewer interface to manage HLS.js instances.
 * This runs in the browser, not on the server.
 *
 * Responsibilities:
 *   - Initialize HLS.js with config from settings
 *   - Play/stop/destroy HLS streams
 *   - Handle errors and auto-reconnect
 *   - CPU saver mode support
 *   - Picture-in-Picture support
 *
 * Exports:
 *   createPlayer(videoElement, config) → PlayerInstance
 *   destroyPlayer(instance)            → void
 */

function createPlayer(videoElement, config) {
  // to be implemented in next phase
  return {
    load: (url) => {},
    play: () => {},
    pause: () => {},
    destroy: () => {},
    on: (event, callback) => {},
    setLevel: (level) => {},
    getLevels: () => []
  };
}

function destroyPlayer(instance) {
  // to be implemented in next phase
}

module.exports = { createPlayer, destroyPlayer };