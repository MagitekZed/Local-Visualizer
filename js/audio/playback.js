// Playback module to handle HTMLAudioElement and connect it to the AudioContext
// Allows loading of File objects, play/pause, and routing through analyser nodes.

import { getAudioContext, resumeAudioContext } from './context.js';

export class AudioPlayer {
  constructor() {
    this.audio = new Audio();
    this.audio.crossOrigin = 'anonymous';
    this.source = null;
  }

  /**
   * Load a local File (from input[type="file"]). Returns a promise that resolves when metadata is loaded.
   */
  async loadFile(file) {
    if (!file) return;
    // Revoke previous object URL
    if (this.audio.src) {
      URL.revokeObjectURL(this.audio.src);
    }
    this.audio.src = URL.createObjectURL(file);
    await this.audio.load();
    await resumeAudioContext();
    // Create or recreate source node
    const ctx = getAudioContext();
    if (this.source) {
      try {
        this.source.disconnect();
      } catch (e) {}
    }
    this.source = ctx.createMediaElementSource(this.audio);
    // By default connect directly to destination; user of this class can re-route via connect()
    this.source.connect(ctx.destination);
  }

  /** Play the current track */
  play() {
    return this.audio.play();
  }

  /** Pause the current track */
  pause() {
    return this.audio.pause();
  }

  /** Toggle play/pause */
  toggle() {
    if (this.audio.paused) {
      return this.play();
    } else {
      return this.pause();
    }
  }

  /** Connect the source through an audio node (e.g., analyser). */
  connect(node) {
    if (!this.source) return;
    const ctx = getAudioContext();
    // Disconnect from previous destination
    try {
      this.source.disconnect();
    } catch (e) {}
    // Connect to the provided node
    this.source.connect(node);
    // If the node is not the destination, connect it to destination
    if (node !== ctx.destination) {
      node.connect(ctx.destination);
    }
  }
}

