// Entry point for the local jukebox + visualiser.  This script builds the
// audio player UI, manages the track library, and interfaces with the
// visualiser through a simple manager.  The WebGL visualiser (AuroraOrbit)
// will be used when available; otherwise we fall back to a 2D canvas.

import { AuroraOrbitVisualizer } from './visualizers/aurora.js';
import { AuroraOrbit2DVisualizer } from './visualizers/aurora2d.js';

class VisualizerManager {
  constructor() {
    this.container = null;
    this.analyser = null;
    this.impl = null;
    this.lastWidth = 0;
    this.lastHeight = 0;
    this.activeType = null;
    this.fallbackCanvas = null;
    this.quality = this._detectDefaultQuality();
  }

  /**
   * Choose a reasonable default quality based on device pixel ratio and
   * whether the device looks like a mobile.  High DPR mobile devices use
   * medium or low quality by default to avoid excessive GPU load.
   */
  _detectDefaultQuality() {
    const dpr = window.devicePixelRatio || 1;
    const isMobile = /Mobi|Android/i.test(navigator.userAgent) || window.innerWidth < 820;
    if (isMobile) {
      if (dpr > 3.0) return 'low';
      return 'medium';
    }
    if (dpr > 2.6) return 'medium';
    return 'high';
  }

  /**
   * Test whether WebGL is available.  We cache the result because
   * context creation is relatively expensive.
   */
  static supportsWebGL() {
    if (typeof VisualizerManager._webglCapable !== 'undefined') {
      return VisualizerManager._webglCapable;
    }
    let support = false;
    try {
      const canvas = document.createElement('canvas');
      support = !!(canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
    } catch (e) {
      support = false;
    }
    VisualizerManager._webglCapable = support;
    return support;
  }

  /**
   * Initialise the manager with a container element and an AnalyserNode.
   * This will immediately create the visualiser implementation.
   */
  init(container, analyser) {
    if (this.impl) return;
    this.container = container;
    this.analyser = analyser;
    this.fallbackCanvas = container.querySelector('#vis');
    this._create(true);
  }

  /**
   * Create either the WebGL or 2D visualiser.  When preferWebGL is true
   * and WebGL is supported, we attempt to create AuroraOrbitVisualizer.
   * Otherwise we fall back to AuroraOrbit2DVisualizer.  On failure, the
   * other visualiser will be created automatically.  When WebGL is active
   * we hide the fallback canvas; when 2D is active we show it again.
   */
  _create(preferWebGL) {
    if (!this.container || !this.analyser) return;
    // Dispose previous implementation if it exists
    if (this.impl) {
      this.impl.dispose();
      this.impl = null;
    }

    if (preferWebGL && VisualizerManager.supportsWebGL()) {
      try {
        const vis = new AuroraOrbitVisualizer();
        vis.init(this.container, this.analyser);
        if (typeof vis.setQuality === 'function') vis.setQuality(this.quality);
        // Listen for context loss to fall back gracefully
        if (typeof vis.onContextLost === 'function') {
          vis.onContextLost(() => {
            this._switchToFallback();
          });
        }
        this.impl = vis;
        this.activeType = 'webgl';
        // Hide fallback canvas so it doesn't overlay the WebGL canvas
        if (this.fallbackCanvas) this.fallbackCanvas.style.display = 'none';
      } catch (err) {
        console.warn('AuroraOrbitVisualizer failed, falling back to 2D:', err);
        this.impl = null;
        // Create the 2D fallback instead
        this._create(false);
        return;
      }
    } else {
      // Use the 2D fallback
      const fallback = new AuroraOrbit2DVisualizer();
      fallback.init(this.container, this.analyser);
      if (typeof fallback.setQuality === 'function') fallback.setQuality(this.quality);
      this.impl = fallback;
      this.activeType = '2d';
      // Ensure the fallback canvas is visible
      if (this.fallbackCanvas) this.fallbackCanvas.style.display = 'block';
    }
    // Resize the visualiser to the current container size
    const width = this.lastWidth || this.container.clientWidth;
    const height = this.lastHeight || this.container.clientHeight;
    this.resize(width, height);
  }

  /**
   * Switch explicitly to the 2D visualiser.  Called when the WebGL
   * context is lost or when the WebGL visualiser throws an error.
   */
  _switchToFallback() {
    if (this.activeType === '2d') return;
    if (this.impl) {
      this.impl.dispose();
      this.impl = null;
    }
    this._create(false);
  }

  /**
   * Resize the active visualiser.  The manager keeps track of the last
   * container dimensions so that newly created visualisers can be sized
   * correctly without flicker.
   */
  resize(width, height) {
    if (!width || !height) return;
    this.lastWidth = width;
    this.lastHeight = height;
    if (this.impl && typeof this.impl.resize === 'function') {
      this.impl.resize(width, height);
    }
  }

  /**
   * Forward the audio data and time delta to the visualiser.  If there
   * is no implementation or the WebGL implementation failed to create a
   * renderer, skip the update to avoid burning CPU on analysis.
   */
  update(freq, wave, dt) {
    if (!this.impl || typeof this.impl.update !== 'function') return;
    // Skip update if WebGL failed to initialise
    if (this.activeType === 'webgl' && !this.impl.renderer) return;
    this.impl.update(freq, wave, dt);
  }

  /**
   * Update the quality preset for the visualiser.  Both the WebGL and
   * 2D implementations expose setQuality so they can adjust particle
   * counts, ribbon segments and bloom intensity.
   */
  setQuality(level) {
    this.quality = level;
    if (this.impl && typeof this.impl.setQuality === 'function') {
      this.impl.setQuality(level);
    }
  }

  /**
   * Dispose of the current visualiser and reset state.  After calling
   * dispose() you can call init() again to start a new visualiser.
   */
  dispose() {
    if (this.impl) {
      this.impl.dispose();
      this.impl = null;
    }
    this.activeType = null;
    if (this.fallbackCanvas) this.fallbackCanvas.style.display = 'block';
  }
}

// Immediately invoke a function to bootstrap the player UI and bind events.
(() => {
  const $ = (sel) => document.querySelector(sel);

  // DOM elements
  const audioEl = $('#audio');
  const stage = document.querySelector('.stage');
  const playPauseBtn = $('#playPause');
  const addBtn = $('#btn-add');
  const fileInput = $('#fileInput');
  const trackListEl = $('#trackList');
  const dropzone = $('#dropzone');
  const timeEl = $('#time');
  const seekEl = $('#seek');
  const volEl = $('#volume');
  const cinemaBtn = $('#btn-cinema');
  const exitCinemaBtn = $('#btn-exit-cinema');
  const qualitySel = $('#quality');

  // Create the visualiser manager
  const visualizerManager = new VisualizerManager();
  // Initialise quality selection UI
  qualitySel.value = visualizerManager.quality;

  // Application state
  const STATE = {
    tracks: [],
    current: -1,
    playing: false,
    rafId: null,
    quality: qualitySel.value,
    lastFrameTime: performance.now()
  };

  // Web Audio objects
  let audioCtx = null;
  let analyser = null;
  let srcNode = null;
  let freqData = null;
  let timeData = null;

  // Resize observer to keep the visualiser sized to the stage element
  const stageResizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const { width, height } = entry.contentRect;
      visualizerManager.resize(width, height);
    }
  });
  stageResizeObserver.observe(stage);

  /**
   * Format a time in seconds as "m:ss".  If the value is not finite, return
   * 0:00.  Used for the time display next to the seek bar.
   */
  const fmtTime = (sec) => {
    if (!isFinite(sec)) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  /**
   * Ensure the AudioContext and AnalyserNode are created.  On iOS
   * contexts must be created in response to a user gesture, so we delay
   * initialisation until the first play.
   */
  function ensureAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.82;
    analyser.minDecibels = -85;
    analyser.maxDecibels = -15;
    freqData = new Uint8Array(analyser.frequencyBinCount);
    timeData = new Uint8Array(analyser.fftSize);
    srcNode = audioCtx.createMediaElementSource(audioEl);
    const gain = audioCtx.createGain();
    gain.gain.value = parseFloat(volEl.value);
    srcNode.connect(gain);
    gain.connect(analyser);
    analyser.connect(audioCtx.destination);
    // Now that we have an analyser, we can initialise the visualiser manager
    visualizerManager.init(stage, analyser);
    visualizerManager.setQuality(qualitySel.value);
  }

  /**
   * Add multiple files to the library.  Filters out non‑audio files.  Each
   * file is given an ID based on its name, size and lastModified so we
   * don't add duplicates.  After adding, we re-render the track list.
   */
  function addFiles(fileList) {
    const files = Array.from(fileList).filter((f) => f.type.startsWith('audio/'));
    if (!files.length) return;
    files.forEach((file) => {
      const id = `${file.name}-${file.size}-${file.lastModified}`;
      // Skip duplicates
      if (STATE.tracks.some((t) => t.id === id)) return;
      const url = URL.createObjectURL(file);
      STATE.tracks.push({ id, file, name: file.name, url, duration: 0 });
    });
    renderTrackList();
    if (STATE.current === -1 && STATE.tracks.length) loadTrack(0, false);
  }

  /**
   * Render the track list in the sidebar.  Highlights the current track.
   */
  function renderTrackList() {
    trackListEl.innerHTML = '';
    STATE.tracks.forEach((t, i) => {
      const li = document.createElement('li');
      li.dataset.idx = i;
      if (i === STATE.current) li.classList.add('active');
      const icon = document.createElement('span');
      icon.textContent = '♪';
      icon.style.opacity = '0.7';
      const meta = document.createElement('div');
      meta.className = 'meta';
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = t.name;
      const sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = t.duration ? fmtTime(t.duration) : '—:—';
      meta.appendChild(title);
      meta.appendChild(sub);
      li.appendChild(icon);
      li.appendChild(meta);
      li.addEventListener('click', () => loadTrack(i, true));
      trackListEl.appendChild(li);
    });
  }

  /**
   * Load a track by index.  If autoplay is true, start playback once the
   * metadata has loaded.  Updates the current state and highlights the
   * selected track in the list.
   */
  function loadTrack(idx, autoplay = false) {
    if (idx < 0 || idx >= STATE.tracks.length) return;
    STATE.current = idx;
    $$('.track-list li').forEach((li, i) => {
      li.classList.toggle('active', i === idx);
    });
    const t = STATE.tracks[idx];
    audioEl.src = t.url;
    audioEl.currentTime = 0;
    // When metadata loads, capture duration and update the UI
    audioEl.onloadedmetadata = () => {
      t.duration = audioEl.duration || 0;
      renderTrackList();
      seekEl.max = 1;
      updateTimeUI();
      if (autoplay) play();
    };
  }

  /**
   * Start playback.  Ensures the AudioContext is created and updates the
   * UI state accordingly.  If the AudioContext fails to resume (due to
   * browser restrictions), logs the error.
   */
  async function play() {
    ensureAudio();
    try {
      await audioCtx.resume();
      await audioEl.play();
      STATE.playing = true;
      playPauseBtn.textContent = 'Pause';
      requestAnimationFrame(loop);
    } catch (e) {
      console.warn('Play failed:', e);
    }
  }

  /**
   * Pause playback.  Cancels the animation frame and updates the UI.
   */
  function pause() {
    audioEl.pause();
    STATE.playing = false;
    playPauseBtn.textContent = 'Play';
  }

  // Toggle play/pause on button click
  playPauseBtn.addEventListener('click', () => {
    STATE.playing ? pause() : play();
  });

  // When a track ends, automatically advance to the next track
  audioEl.addEventListener('ended', () => {
    const next = STATE.current + 1;
    if (next < STATE.tracks.length) {
      loadTrack(next, true);
    } else {
      pause();
      audioEl.currentTime = 0;
    }
  });

  // Volume control
  volEl.addEventListener('input', () => {
    const v = parseFloat(volEl.value);
    audioEl.volume = v;
  });

  // Seek bar
  seekEl.addEventListener('input', () => {
    const t = STATE.tracks[STATE.current];
    if (!t || !isFinite(t.duration) || !t.duration) return;
    const ratio = parseFloat(seekEl.value);
    audioEl.currentTime = ratio * t.duration;
  });

  // Update time UI periodically
  audioEl.addEventListener('timeupdate', updateTimeUI);
  function updateTimeUI() {
    const t = STATE.tracks[STATE.current];
    const cur = audioEl.currentTime || 0;
    const dur = (t && t.duration) || audioEl.duration || 0;
    timeEl.textContent = `${fmtTime(cur)} / ${fmtTime(dur)}`;
    if (dur > 0) seekEl.value = (cur / dur).toFixed(3);
  }

  // Drag & drop handlers for adding files
  ['dragenter', 'dragover'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('drag');
    });
  });
  ['dragleave', 'drop'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('drag');
    });
  });
  dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (dt && dt.files) addFiles(dt.files);
  });

  // Add songs button
  addBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => addFiles(e.target.files));

  // Cinema mode toggles a full‑screen experience.  We simply toggle a
  // class on the body; CSS handles resizing.  When entering, reset
  // scroll position and resize the visualiser; when exiting, show the
  // normal layout again.
  cinemaBtn.addEventListener('click', () => {
    document.body.classList.toggle('cinema');
    // Clear any residual scroll when entering
    if (document.body.classList.contains('cinema')) {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }
    // Resize after a short delay to allow layout to settle
    setTimeout(() => {
      const rect = stage.getBoundingClientRect();
      visualizerManager.resize(rect.width, rect.height);
    }, 50);
  });
  exitCinemaBtn.addEventListener('click', () => {
    if (document.body.classList.contains('cinema')) {
      document.body.classList.remove('cinema');
      setTimeout(() => {
        const rect = stage.getBoundingClientRect();
        visualizerManager.resize(rect.width, rect.height);
      }, 50);
    }
  });

  // Quality selection
  qualitySel.addEventListener('change', () => {
    STATE.quality = qualitySel.value;
    visualizerManager.setQuality(STATE.quality);
  });

  /**
   * Main animation loop.  On each frame we collect frequency and time
   * domain data, compute a time delta, and feed the data to the
   * visualiser manager.  The loop runs only when audio is playing.
   */
  function loop() {
    if (!STATE.playing) return;
    const now = performance.now();
    const dt = Math.max(0.001, (now - STATE.lastFrameTime) / 1000);
    STATE.lastFrameTime = now;
    if (analyser) {
      analyser.getByteFrequencyData(freqData);
      analyser.getByteTimeDomainData(timeData);
      visualizerManager.update(freqData, timeData, dt);
    }
    requestAnimationFrame(loop);
  }

  // Keyboard shortcuts: space toggles play/pause; arrow keys seek; escape exits cinema
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      STATE.playing ? pause() : play();
    }
    if (e.code === 'ArrowRight') {
      audioEl.currentTime = Math.min((audioEl.currentTime || 0) + 5, audioEl.duration || 1e9);
    }
    if (e.code === 'ArrowLeft') {
      audioEl.currentTime = Math.max((audioEl.currentTime || 0) - 5, 0);
    }
    if (e.code === 'Escape' && document.body.classList.contains('cinema')) {
      document.body.classList.remove('cinema');
      setTimeout(() => {
        const rect = stage.getBoundingClientRect();
        visualizerManager.resize(rect.width, rect.height);
      }, 50);
    }
  });

  // Helper to select all items matching a query.  Used for updating active tracks.
  function $$(sel) {
    return Array.from(document.querySelectorAll(sel));
  }
})();
