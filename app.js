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

  init(container, analyser) {
    if (this.impl) return;
    this.container = container;
    this.analyser = analyser;
    this.fallbackCanvas = container.querySelector('#vis');
    this._create(true);
  }

  _create(preferWebGL) {
    if (!this.container || !this.analyser) return;
    if (this.impl) {
      this.impl.dispose();
      this.impl = null;
    }

    if (preferWebGL && VisualizerManager.supportsWebGL()) {
      try {
        const vis = new AuroraOrbitVisualizer();
        vis.init(this.container, this.analyser);
        if (typeof vis.setQuality === 'function') vis.setQuality(this.quality);
        if (typeof vis.onContextLost === 'function') {
          vis.onContextLost(() => {
            this._switchToFallback();
          });
        }
        this.impl = vis;
        this.activeType = 'webgl';
        if (this.fallbackCanvas) this.fallbackCanvas.style.display = 'none';
      } catch (err) {
        console.warn('AuroraOrbitVisualizer failed, falling back to 2D:', err);
        this.impl = null;
        this._create(false);
        return;
      }
    } else {
      const fallback = new AuroraOrbit2DVisualizer();
      fallback.init(this.container, this.analyser);
      if (typeof fallback.setQuality === 'function') fallback.setQuality(this.quality);
      this.impl = fallback;
      this.activeType = '2d';
      if (this.fallbackCanvas) this.fallbackCanvas.style.display = 'block';
    }

    const width = this.lastWidth || this.container.clientWidth;
    const height = this.lastHeight || this.container.clientHeight;
    this.resize(width, height);
  }

  _switchToFallback() {
    if (this.activeType === '2d') return;
    if (this.impl) {
      this.impl.dispose();
      this.impl = null;
    }
    this._create(false);
  }

  resize(width, height) {
    if (!width || !height) return;
    this.lastWidth = width;
    this.lastHeight = height;
    if (this.impl && typeof this.impl.resize === 'function') {
      this.impl.resize(width, height);
    }
  }

  update(freq, wave, dt) {
    if (this.impl && typeof this.impl.update === 'function') {
      this.impl.update(freq, wave, dt);
    }
  }

  setQuality(level) {
    this.quality = level;
    if (this.impl && typeof this.impl.setQuality === 'function') {
      this.impl.setQuality(level);
    }
  }

  dispose() {
    if (this.impl) {
      this.impl.dispose();
      this.impl = null;
    }
    this.activeType = null;
    if (this.fallbackCanvas) this.fallbackCanvas.style.display = 'block';
  }
}

(() => {
  const $ = (sel) => document.querySelector(sel);

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

  const visualizerManager = new VisualizerManager();
  qualitySel.value = visualizerManager.quality;

  const STATE = {
    tracks: [],
    current: -1,
    playing: false,
    rafId: null,
    quality: qualitySel.value,
    lastFrameTime: performance.now()
  };

  let audioCtx = null;
  let analyser = null;
  let srcNode = null;
  let freqData = null;
  let timeData = null;

  const stageResizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const { width, height } = entry.contentRect;
      visualizerManager.resize(width, height);
    }
  });
  stageResizeObserver.observe(stage);

  function scheduleResize() {
    const rect = stage.getBoundingClientRect();
    visualizerManager.resize(rect.width, rect.height);
  }

  const fmtTime = (sec) => {
    if (!isFinite(sec)) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

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

    visualizerManager.init(stage, analyser);
    visualizerManager.setQuality(STATE.quality);
    if (freqData && timeData) {
      freqData.fill(0);
      timeData.fill(128);
      visualizerManager.update(freqData, timeData, 0);
    }
    scheduleResize();
  }

  function addFiles(fileList) {
    const files = Array.from(fileList).filter((f) => f.type.startsWith('audio/'));
    if (!files.length) return;
    files.forEach((file) => {
      const id = `${file.name}-${file.size}-${file.lastModified}`;
      const url = URL.createObjectURL(file);
      STATE.tracks.push({ id, file, name: file.name, url, duration: 0 });
    });
    renderTrackList();
    if (STATE.current === -1) loadTrack(0);
  }

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

  function loadTrack(idx, autoplay = false) {
    if (idx < 0 || idx >= STATE.tracks.length) return;
    STATE.current = idx;
    Array.from(document.querySelectorAll('.track-list li')).forEach((li, i) => {
      li.classList.toggle('active', i === idx);
    });

    const t = STATE.tracks[idx];
    audioEl.src = t.url;
    audioEl.currentTime = 0;

    audioEl.onloadedmetadata = () => {
      t.duration = audioEl.duration || 0;
      renderTrackList();
      seekEl.max = 1;
      updateTimeUI();
      if (autoplay) play();
    };
  }

  async function play() {
    ensureAudio();
    try {
      await audioCtx.resume();
      await audioEl.play();
      STATE.playing = true;
      playPauseBtn.textContent = 'Pause';
      STATE.lastFrameTime = performance.now();
      if (!STATE.rafId) STATE.rafId = requestAnimationFrame(loop);
    } catch (e) {
      console.warn('Play failed:', e);
    }
  }

  function pause() {
    audioEl.pause();
    STATE.playing = false;
    playPauseBtn.textContent = 'Play';
    if (STATE.rafId) cancelAnimationFrame(STATE.rafId);
    STATE.rafId = null;
  }

  function loop(now) {
    STATE.rafId = requestAnimationFrame(loop);
    if (!analyser) return;
    analyser.getByteFrequencyData(freqData);
    analyser.getByteTimeDomainData(timeData);
    const dt = Math.min(0.12, Math.max(0.001, (now - STATE.lastFrameTime) / 1000 || 0.016));
    STATE.lastFrameTime = now;
    visualizerManager.update(freqData, timeData, dt);
  }

  playPauseBtn.addEventListener('click', () => {
    STATE.playing ? pause() : play();
  });

  audioEl.addEventListener('ended', () => {
    const next = STATE.current + 1;
    if (next < STATE.tracks.length) {
      loadTrack(next, true);
    } else {
      pause();
      audioEl.currentTime = 0;
    }
  });

  volEl.addEventListener('input', () => {
    ensureAudio();
    audioEl.volume = parseFloat(volEl.value);
  });

  seekEl.addEventListener('input', () => {
    const t = STATE.tracks[STATE.current];
    if (!t || !isFinite(t.duration) || !t.duration) return;
    const ratio = parseFloat(seekEl.value);
    audioEl.currentTime = ratio * t.duration;
  });

  audioEl.addEventListener('timeupdate', updateTimeUI);
  function updateTimeUI() {
    const t = STATE.tracks[STATE.current];
    const cur = audioEl.currentTime || 0;
    const dur = (t && t.duration) || audioEl.duration || 0;
    timeEl.textContent = `${fmtTime(cur)} / ${fmtTime(dur)}`;
    if (dur > 0) seekEl.value = (cur / dur).toFixed(3);
  }

  ['dragenter', 'dragover'].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('drag');
    })
  );
  ['dragleave', 'drop'].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('drag');
    })
  );
  dropzone.addEventListener('drop', (e) => {
    addFiles(e.dataTransfer.files);
  });

  addBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => addFiles(e.target.files));

  cinemaBtn.addEventListener('click', () => {
    document.body.classList.toggle('cinema');
    if (document.body.classList.contains('cinema')) {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }
    setTimeout(scheduleResize, 60);
  });

  exitCinemaBtn.addEventListener('click', () => {
    if (document.body.classList.contains('cinema')) {
      document.body.classList.remove('cinema');
      setTimeout(scheduleResize, 60);
    }
  });

  qualitySel.addEventListener('change', () => {
    STATE.quality = qualitySel.value;
    visualizerManager.setQuality(STATE.quality);
    scheduleResize();
  });

  window.addEventListener('resize', () => {
    scheduleResize();
  });

  window.addEventListener('load', () => {
    scheduleResize();
  });

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
      setTimeout(scheduleResize, 60);
    }
  });
})();
