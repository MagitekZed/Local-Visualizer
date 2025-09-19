// Audio context manager
// Provides a singleton AudioContext and utilities to resume
// and create gain nodes.

let audioContext;

export function getAudioContext() {
  if (!audioContext) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioCtx();
  }
  return audioContext;
}

// Ensures the audio context is running. Must be called in response to a user gesture.
export function resumeAudioContext() {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') {
    return ctx.resume();
  }
  return Promise.resolve();
}

// Create a gain node for volume control
export function createGain() {
  const ctx = getAudioContext();
  return ctx.createGain();
}

