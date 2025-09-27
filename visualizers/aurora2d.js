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
    // Seeds controlling the phase of each radial ray.  The number of
    // rays will be set in setQuality().  For now initialise with
    // default sparkCount from settings.
    this.raySeeds = new Float32Array(this.settings.sparkCount);
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
    // Default palette colours used when no album art palette is provided.
    // Each entry is an sRGB triplet (0..1).  These roughly match the
    // turquoise, purple and magenta hues used in the 3D visualiser.
    this.paletteColors = [
      [0.0, 0.7, 0.9], // turquoise-ish
      [0.6, 0.2, 0.8], // purple-ish
      [1.0, 0.2, 0.5]  // magenta-ish
    ];
    for (let i = 0; i < this.raySeeds.length; i++) {
      this.raySeeds[i] = Math.random();
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
    // Resize the raySeeds array based on the desired sparkCount.  Each
    // seed controls a radial ray for the high-frequency effect.
    this.raySeeds = new Float32Array(this.settings.sparkCount);
    for (let i = 0; i < this.raySeeds.length; i++) {
      this.raySeeds[i] = Math.random();
    }
    this.bandMap = null;
  }

  /**
   * Update the colour palette used for the circular spectrum.  Accepts an
   * array of three sRGB colours (range 0..1).  These colours are
   * interpolated across the bars.  If fewer than three colours are
   * provided, the last colour is repeated.
   *
   * @param {Array<Array<number>>} palette Array of colours
   */
  setPalette(palette) {
    if (!palette || !palette.length) return;
    // Ensure at least three colours
    const cols = [];
    for (let i = 0; i < 3; i++) {
      const col = palette[i] || palette[palette.length - 1];
      cols.push([
        Math.min(1, Math.max(0, col[0])),
        Math.min(1, Math.max(0, col[1])),
        Math.min(1, Math.max(0, col[2]))
      ]);
    }
    this.paletteColors = cols;
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
    // Draw circular spectrum using palette-based colours.  We
    // interpolate between the three palette colours across the
    // spectrum.  Bars are drawn as thick arcs with a subtle glow.
    ctx.save();
    ctx.translate(cx, cy);
    const bars = this.settings.bars;
    const glow = this.settings.glow;
    const angleStep = (Math.PI * 2) / bars;
    for (let i = 0; i < bars; i++) {
      const v = this.barValues[i];
      // Compute colour by interpolating between palette colours.  t
      // ranges from 0..1 across bars.  There are two segments: 0..0.5
      // maps palette[0]→palette[1], 0.5..1 maps palette[1]→palette[2].
      const t = i / (bars - 1);
      const seg = t < 0.5 ? 0 : 1;
      const segT = seg === 0 ? (t / 0.5) : ((t - 0.5) / 0.5);
      const c0 = this.paletteColors[seg];
      const c1 = this.paletteColors[seg + 1];
      const r = c0[0] + (c1[0] - c0[0]) * segT;
      const g = c0[1] + (c1[1] - c0[1]) * segT;
      const b = c0[2] + (c1[2] - c0[2]) * segT;
      // Apply brightness based on overall energy; clamp to [0,1]
      const brightness = 0.7 + 0.3 * this.audioState.energy;
      const fr = Math.min(1, r * brightness);
      const fg = Math.min(1, g * brightness);
      const fb = Math.min(1, b * brightness);
      const fillStyle = `rgb(${Math.round(fr * 255)},${Math.round(fg * 255)},${Math.round(fb * 255)})`;
      const glowStyle = `rgba(${Math.round(fr * 255)},${Math.round(fg * 255)},${Math.round(fb * 255)},0.7)`;
      const a0 = i * angleStep;
      const a1 = a0 + angleStep * 0.9;
      const r0 = maxR * 0.5;
      const r1 = maxR * (0.55 + v * 0.45);
      ctx.beginPath();
      ctx.arc(0, 0, r1, a0, a1, false);
      ctx.arc(0, 0, r0, a1, a0, true);
      ctx.closePath();
      ctx.fillStyle = fillStyle;
      ctx.shadowBlur = glow;
      ctx.shadowColor = glowStyle;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
    // Draw dynamic rays orbiting the circle.  Each seed advances
    // over time at a rate influenced by the high-frequency energy.
    // We render radial strokes whose length and brightness scale
    // with the highs.  The rays orbit at an angle determined by
    // their seed value.
    const rayRadius = maxR * 0.72;
    const baseLength = maxR * 0.08;
    const high = this.audioState.highs;
    for (let i = 0; i < this.raySeeds.length; i++) {
      // Advance each seed by a base speed plus a component from highs.
      const speed = 0.05 + high * 0.6;
      this.raySeeds[i] = (this.raySeeds[i] + dt * speed) % 1.0;
      const tRay = this.raySeeds[i];
      const angle = tRay * Math.PI * 2;
      const length = baseLength + high * maxR * 0.12;
      const x0 = cx + Math.cos(angle) * rayRadius;
      const y0 = cy + Math.sin(angle) * rayRadius;
      const x1 = cx + Math.cos(angle) * (rayRadius + length);
      const y1 = cy + Math.sin(angle) * (rayRadius + length);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      const alpha = 0.3 + high * 0.7;
      ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(2)})`;
      ctx.lineWidth = 1.0 + high * 2.5;
      ctx.stroke();
    }
  }
  dispose() {
    // Nothing to dispose for 2D visualiser since canvas is managed by app.js
  }
}