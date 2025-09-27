/*
 * Aurora Orbit 2D Visualiser
 *
 * This fallback implementation displays a radial gradient backdrop,
 * circular spectrum arcs and a central pulse.  It exposes the same
 * Visualizer API as the WebGL version but does not depend on
 * external libraries.  When WebGL is unavailable or fails to
 * initialise, app.js automatically creates this visualiser instead.
 */

export class AuroraOrbit2DVisualizer {
  constructor() {
    this.container = null;
    this.canvas = null;
    this.ctx = null;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.analyser = null;
    this.sampleRate = 44100;
    this.bandMap = null;
    this.barValues = new Float32Array(128);
    this.sparkSeeds = new Float32Array(128);
    this.audioState = {
      energy: 0,
      bass: 0,
      mids: 0,
      highs: 0
    };
    this.quality = 'high';
    this.settings = { bars: 48, glow: 26, sparkCount: 180 };
    this.bgGradient = null;
    this.radialGradient = null;
    this.lastHue = Math.random();
    for (let i = 0; i < this.sparkSeeds.length; i++) {
      this.sparkSeeds[i] = Math.random();
    }
  }
  setQuality(level) {
    const presets = {
      high: { bars: 48, glow: 28, sparkCount: 220 },
      medium: { bars: 48, glow: 22, sparkCount: 160 },
      low: { bars: 40, glow: 18, sparkCount: 110 }
    };
    if (!presets[level]) return;
    this.quality = level;
    this.settings = presets[level];
    this.barValues = new Float32Array(this.settings.bars);
    this.sparkSeeds = new Float32Array(this.settings.sparkCount);
    for (let i = 0; i < this.sparkSeeds.length; i++) {
      this.sparkSeeds[i] = Math.random();
    }
    this.bandMap = null;
  }
  init(container, analyser) {
    this.container = container;
    this.analyser = analyser;
    this.sampleRate = analyser.context.sampleRate || 44100;
    let canvas = container.querySelector('#vis');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'vis';
      container.insertBefore(canvas, container.firstChild);
    }
    this.canvas = canvas;
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.zIndex = '0';
    canvas.style.display = 'block';
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.ctx.fillStyle = '#05060a';
    this.ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  resize(width, height) {
    if (!this.canvas) return;
    this.width = width;
    this.height = height;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(width * this.dpr);
    this.canvas.height = Math.floor(height * this.dpr);
    this.canvas.style.width = width + 'px';
    this.canvas.style.height = height + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this._buildGradients();
  }
  _buildGradients() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    this.bgGradient = ctx.createLinearGradient(0, 0, 0, this.height);
    this.bgGradient.addColorStop(0, '#041021');
    this.bgGradient.addColorStop(0.6, '#09192e');
    this.bgGradient.addColorStop(1, '#120920');
    // Position the radial gradient slightly below centre.  Placing
    // both the radial glow and the circular spectrum lower in the
    // canvas helps to frame the visualiser closer to the player bar.
    // Build the radial glow centred vertically.  Use 0.5 of the
    // container height so the glow appears in the middle between
    // header and player bar.  Reduce the radius slightly to keep
    // the ring comfortably within the viewport.
    const r = Math.min(this.width, this.height) * 0.48;
    const cy = this.height * 0.5;
    this.radialGradient = ctx.createRadialGradient(
      this.width / 2,
      cy,
      r * 0.2,
      this.width / 2,
      cy,
      r
    );
    this.radialGradient.addColorStop(0, 'rgba(34,68,120,0.6)');
    this.radialGradient.addColorStop(1, 'rgba(5,8,12,0.05)');
  }
  _makeLogBandMap(binCount, bandCount) {
    const nyquist = this.sampleRate / 2;
    const fMin = 32;
    const fMax = Math.min(16000, nyquist);
    const bands = [];
    for (let i = 0; i < bandCount; i++) {
      const t0 = i / bandCount;
      const t1 = (i + 1) / bandCount;
      const f0 = fMin * Math.pow(fMax / fMin, t0);
      const f1 = fMin * Math.pow(fMax / fMin, t1);
      const b0 = Math.max(0, Math.floor((f0 / nyquist) * binCount));
      const b1 = Math.min(binCount - 1, Math.ceil((f1 / nyquist) * binCount));
      bands.push([b0, Math.max(b0 + 1, b1)]);
    }
    return bands;
  }
  _updateAudioStats(freq, wave) {
    if (!this.bandMap || this.bandMap.length !== this.settings.bars || this.bandMap[0][1] > freq.length) {
      this.bandMap = this._makeLogBandMap(freq.length, this.settings.bars);
    }
    const lerp = (a, b, t) => a + (b - a) * t;
    const nyquist = this.sampleRate / 2;
    const binHz = nyquist / freq.length;
    let bassSum = 0,
      bassCount = 0;
    let midsSum = 0,
      midsCount = 0;
    let highsSum = 0,
      highsCount = 0;
    for (let i = 0; i < freq.length; i++) {
      const v = freq[i] / 255;
      const hz = i * binHz;
      if (hz <= 200) {
        bassSum += v;
        bassCount++;
      } else if (hz <= 2000) {
        midsSum += v;
        midsCount++;
      } else if (hz <= 16000) {
        highsSum += v;
        highsCount++;
      }
    }
    let rms = 0;
    for (let i = 0; i < wave.length; i++) {
      const v = (wave[i] - 128) / 128;
      rms += v * v;
    }
    rms = Math.sqrt(rms / wave.length);
    const smooth = 0.2;
    const energy = Math.min(1, rms);
    this.audioState.energy = lerp(this.audioState.energy, energy, smooth);
    this.audioState.bass = lerp(this.audioState.bass, bassCount ? bassSum / bassCount : 0, smooth);
    this.audioState.mids = lerp(this.audioState.mids, midsCount ? midsSum / midsCount : 0, smooth);
    this.audioState.highs = lerp(this.audioState.highs, highsCount ? highsSum / highsCount : 0, smooth);
    const bars = this.settings.bars;
    for (let i = 0; i < bars; i++) {
      const [b0, b1] = this.bandMap[i];
      let sum = 0;
      for (let b = b0; b < b1; b++) sum += freq[b];
      const avg = sum / (b1 - b0);
      // emphasise lower frequencies slightly
      const tilt = Math.pow(i / bars, 0.6) * 0.15;
      this.barValues[i] = Math.min(1, Math.max(0, avg / 255 * (1 - tilt)));
    }
  }
  update(freq, wave, dt) {
    if (!this.ctx) return;
    this._updateAudioStats(freq, wave);
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    // Clear background
    ctx.fillStyle = this.bgGradient;
    ctx.fillRect(0, 0, w, h);
    // Radial glow
    ctx.fillStyle = this.radialGradient;
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2;
    // Centre the circle vertically so it sits mid‑way between the
    // header and player bar.  Using half the height yields a more
    // balanced composition for the 2D visualiser.
    const cy = h * 0.5;
    // Reduce the maximum radius slightly to maintain margins on all
    // sides.  This keeps the spectrum fully visible within the stage.
    const maxR = Math.min(w, h) * 0.42;
    // Draw circular spectrum
    ctx.save();
    ctx.translate(cx, cy);
    const bars = this.settings.bars;
    const glow = this.settings.glow;
    const sparkCount = this.settings.sparkCount;
    const angleStep = (Math.PI * 2) / bars;
    // Draw arcs with gradient and glow
    for (let i = 0; i < bars; i++) {
      const v = this.barValues[i];
      const a0 = i * angleStep;
      const a1 = a0 + angleStep * 0.9;
      const r0 = maxR * 0.5;
      const r1 = maxR * (0.55 + v * 0.45);
      ctx.beginPath();
      ctx.arc(0, 0, r1, a0, a1, false);
      ctx.arc(0, 0, r0, a1, a0, true);
      ctx.closePath();
      // Hue rotates slowly with energy
      this.lastHue = (this.lastHue + this.audioState.energy * 0.03 * dt) % 1.0;
      const hue = ((i / bars) + this.lastHue) % 1.0;
      const saturation = 0.7 + 0.25 * this.audioState.bass;
      const lightness = 0.5 + 0.2 * this.audioState.mids;
      ctx.fillStyle = `hsl(${hue * 360}, ${saturation * 100}%, ${lightness * 50 + 25}%)`;
      ctx.fill();
      // Glow
      ctx.shadowBlur = glow;
      ctx.shadowColor = `hsl(${hue * 360}, 80%, 60%)`;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
    // Draw dynamic sparkles orbiting the circle.  Each seed advances
    // over time at a rate influenced by the high-frequency energy.
    // Instead of placing static dots we animate them smoothly around
    // the ring.  This creates a lively accent that responds to
    // hi-hats and sibilants.
    // Draw dynamic sparkles orbiting the circle.  Each seed advances
    // over time at a rate influenced by the high‑frequency energy.
    // We render larger spark pulses whose size and brightness scale
    // with the highs.  The sparks orbit at an angle determined by
    // their seed and a global rotation.  A wider radius emphasises
    // their separation from the main ring.
    const sparkRadius = maxR * 0.85;
    // Precompute size and alpha based on highs.  A small base size
    // ensures sparks are always visible; highs boost both size and
    // brightness.
    // Base size slightly larger and allow highs to boost size more
    const sparkSize = 2.0 + this.audioState.highs * 4.0;
    // Make sparkles more luminous at high energy while retaining a
    // visible base alpha when quiet
    const sparkleAlpha = 0.4 + this.audioState.highs * 0.8;
    for (let i = 0; i < this.sparkSeeds.length; i++) {
      // Advance each seed by a base speed plus a component from highs.
      const speed = 0.05 + this.audioState.highs * 0.6;
      this.sparkSeeds[i] = (this.sparkSeeds[i] + dt * speed) % 1.0;
      const tSpark = this.sparkSeeds[i];
      const angle = tSpark * Math.PI * 2;
      const x = cx + Math.cos(angle) * sparkRadius;
      const y = cy + Math.sin(angle) * sparkRadius;
      ctx.beginPath();
      ctx.arc(x, y, sparkSize, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${sparkleAlpha.toFixed(2)})`;
      ctx.fill();
    }
  }
  dispose() {
    // Nothing to dispose for 2D visualiser since canvas is managed by app.js
  }
}