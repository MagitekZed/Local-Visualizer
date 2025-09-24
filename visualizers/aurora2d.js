class AuroraOrbit2DVisualizer {
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
    this.settings = { bars: 96, glow: 26, sparkCount: 180 };
    this.bgGradient = null;
    this.radialGradient = null;
    this.lastHue = Math.random();
    for (let i = 0; i < this.sparkSeeds.length; i++) {
      this.sparkSeeds[i] = Math.random();
    }
  }

  setQuality(level) {
    const presets = {
      high: { bars: 96, glow: 28, sparkCount: 220 },
      medium: { bars: 72, glow: 22, sparkCount: 160 },
      low: { bars: 56, glow: 18, sparkCount: 120 }
    };
    if (!presets[level]) return;
    this.quality = level;
    this.settings = presets[level];
    this.barValues = new Float32Array(Math.max(this.settings.bars, this.barValues.length));
    this.sparkSeeds = new Float32Array(Math.max(this.settings.sparkCount, this.sparkSeeds.length));
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

    const r = Math.min(this.width, this.height) * 0.52;
    this.radialGradient = ctx.createRadialGradient(this.width / 2, this.height / 2, r * 0.2, this.width / 2, this.height / 2, r);
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
    let energySum = 0;
    const nyquist = this.sampleRate / 2;
    const binHz = nyquist / freq.length;
    let bassSum = 0, bassCount = 0;
    let midsSum = 0, midsCount = 0;
    let highsSum = 0, highsCount = 0;

    for (let i = 0; i < freq.length; i++) {
      const v = freq[i] / 255;
      energySum += v;
      const hz = i * binHz;
      if (hz <= 200) { bassSum += v; bassCount++; }
      else if (hz <= 2000) { midsSum += v; midsCount++; }
      else if (hz <= 16000) { highsSum += v; highsCount++; }
    }

    let rms = 0;
    for (let i = 0; i < wave.length; i++) {
      const v = (wave[i] - 128) / 128;
      rms += v * v;
    }
    rms = Math.sqrt(rms / wave.length);

    const energy = energySum / freq.length;
    this.audioState.energy = lerp(this.audioState.energy, Math.min(1, (energy + rms) * 0.6), 0.12);
    this.audioState.bass = lerp(this.audioState.bass, bassCount ? bassSum / bassCount : 0, 0.15);
    this.audioState.mids = lerp(this.audioState.mids, midsCount ? midsSum / midsCount : 0, 0.14);
    this.audioState.highs = lerp(this.audioState.highs, highsCount ? highsSum / highsCount : 0, 0.2);

    const bars = this.settings.bars;
    for (let i = 0; i < bars; i++) {
      const [b0, b1] = this.bandMap[i];
      let sum = 0;
      for (let b = b0; b < b1; b++) sum += freq[b];
      const avg = sum / (b1 - b0);
      const target = Math.pow(avg / 255, 0.85);
      this.barValues[i] = lerp(this.barValues[i] || 0, target, 0.25);
    }
  }

  update(freq, wave, dt) {
    if (!this.ctx) return;
    this._updateAudioStats(freq, wave);
    const ctx = this.ctx;
    const W = this.width;
    const H = this.height;

    ctx.save();
    ctx.fillStyle = this.bgGradient || '#05060a';
    ctx.fillRect(0, 0, W, H);
    if (this.radialGradient) {
      ctx.fillStyle = this.radialGradient;
      ctx.fillRect(0, 0, W, H);
    }

    const centerX = W / 2;
    const centerY = H / 2;
    const radius = Math.min(W, H) * 0.38;

    ctx.translate(centerX, centerY);
    ctx.rotate(-Math.PI / 2);

    const bars = this.settings.bars;
    const step = (Math.PI * 1.7) / bars;
    const baseInner = radius * 0.55;
    const glow = this.settings.glow;

    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(114, 196, 255, 0.45)';
    ctx.shadowBlur = glow;

    const hueShift = (this.lastHue += dt * (0.05 + this.audioState.energy * 0.9));
    const hueA = (0.58 + hueShift) % 1;
    const hueB = (0.84 + hueShift * 0.6) % 1;

    for (let i = 0; i < bars; i++) {
      const v = this.barValues[i] || 0;
      const angle = -Math.PI * 0.85 + i * step;
      const thickness = 6 + v * 26;
      const inner = baseInner * (0.82 + v * 0.12);
      const outer = inner + radius * 0.32 * (0.3 + v * 0.9);
      const grad = ctx.createLinearGradient(0, 0, Math.cos(angle), Math.sin(angle));
      grad.addColorStop(0, `hsl(${Math.floor(hueA * 360)}, 85%, ${50 + v * 30}%)`);
      grad.addColorStop(1, `hsl(${Math.floor(hueB * 360)}, 80%, ${55 + v * 28}%)`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = thickness;
      ctx.beginPath();
      ctx.arc(0, 0, (inner + outer) * 0.5, angle - step * 0.42, angle + step * 0.42);
      ctx.stroke();
    }

    ctx.shadowBlur = 0;

    const energy = this.audioState.energy;
    const bass = this.audioState.bass;
    const mids = this.audioState.mids;
    const highs = this.audioState.highs;

    const pulseRadius = baseInner * (0.6 + bass * 0.4);
    const pulseGradient = ctx.createRadialGradient(0, 0, pulseRadius * 0.3, 0, 0, pulseRadius);
    pulseGradient.addColorStop(0, `rgba(255,255,255,${0.3 + energy * 0.4})`);
    pulseGradient.addColorStop(1, 'rgba(20,30,40,0)');
    ctx.fillStyle = pulseGradient;
    ctx.beginPath();
    ctx.arc(0, 0, pulseRadius, 0, Math.PI * 2);
    ctx.fill();

    const sparkCount = Math.min(this.settings.sparkCount, this.sparkSeeds.length);
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    for (let i = 0; i < sparkCount; i++) {
      const seed = this.sparkSeeds[i];
      const angle = seed * Math.PI * 2 + i * 0.1 + this.lastHue * 2.0;
      const length = radius * (0.18 + 0.22 * highs + (seed % 0.3));
      const offset = radius * 0.65 + Math.sin(angle * 3.1 + mids * 4.0) * 12;
      const alpha = 0.15 + highs * 0.5;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * offset, Math.sin(angle) * offset);
      ctx.lineTo(Math.cos(angle) * (offset + length), Math.sin(angle) * (offset + length));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    ctx.restore();

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, W, H);
    const vignette = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.45, W / 2, H / 2, Math.max(W, H) * 0.7);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
  }

  dispose() {
    if (this.canvas && this.ctx) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }
}

export { AuroraOrbit2DVisualizer };

if (typeof window !== 'undefined') {
  window.AuroraOrbit2DVisualizer = AuroraOrbit2DVisualizer;
}
