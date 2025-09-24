/* app.js */
(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // Elements
  const audioEl = $("#audio");
  const canvas = $("#vis");
  const ctx2d = canvas.getContext("2d", { alpha: false, desynchronized: true });
  const playPauseBtn = $("#playPause");
  const addBtn = $("#btn-add");
  const fileInput = $("#fileInput");
  const trackListEl = $("#trackList");
  const dropzone = $("#dropzone");
  const timeEl = $("#time");
  const seekEl = $("#seek");
  const volEl = $("#volume");
  const cinemaBtn = $("#btn-cinema");
  const exitCinemaBtn = $("#btn-exit-cinema");
  const qualitySel = $("#quality");

  // Resize canvas
  function fitCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { clientWidth: w, clientHeight: h } = canvas;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2d.fillStyle = "#07090c";
    ctx2d.fillRect(0, 0, w, h);
  }
  new ResizeObserver(fitCanvas).observe(canvas);

  // Audio & analysis
  let audioCtx = null;
  let analyser = null;
  let srcNode = null;
  let freqData = null;
  let timeData = null;

  const STATE = {
    tracks: [],
    current: -1,
    playing: false,
    rafId: null,
    quality: "high",
    bars: 48,
    smoothing: 0.82,
    peakHold: [],
    peakDecay: 0.01,
  };

  const fmtTime = (sec) => {
    if (!isFinite(sec)) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  function ensureAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = STATE.smoothing;
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
  }

  function addFiles(fileList) {
    const files = Array.from(fileList).filter(f => f.type.startsWith("audio/"));
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
    trackListEl.innerHTML = "";
    STATE.tracks.forEach((t, i) => {
      const li = document.createElement("li");
      li.dataset.idx = i;
      if (i === STATE.current) li.classList.add("active");
      const icon = document.createElement("span");
      icon.textContent = "♪";
      icon.style.opacity = "0.7";
      const meta = document.createElement("div");
      meta.className = "meta";
      const title = document.createElement("div");
      title.className = "title";
      title.textContent = t.name;
      const sub = document.createElement("div");
      sub.className = "sub";
      sub.textContent = t.duration ? fmtTime(t.duration) : "—:—";
      meta.appendChild(title); meta.appendChild(sub);
      li.appendChild(icon); li.appendChild(meta);
      li.addEventListener("click", () => loadTrack(i, true));
      trackListEl.appendChild(li);
    });
  }

  function loadTrack(idx, autoplay=false) {
    if (idx < 0 || idx >= STATE.tracks.length) return;
    STATE.current = idx;
    $$(".track-list li").forEach((li, i) => {
      li.classList.toggle("active", i === idx);
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
      playPauseBtn.textContent = "Pause";
      loop();
    } catch (e) {
      console.warn("Play failed:", e);
    }
  }

  function pause() {
    audioEl.pause();
    STATE.playing = false;
    playPauseBtn.textContent = "Play";
    cancelAnimationFrame(STATE.rafId);
    STATE.rafId = null;
  }

  playPauseBtn.addEventListener("click", () => {
    STATE.playing ? pause() : play();
  });

  audioEl.addEventListener("ended", () => {
    const next = STATE.current + 1;
    if (next < STATE.tracks.length) {
      loadTrack(next, true);
    } else {
      pause();
      audioEl.currentTime = 0;
    }
  });

  volEl.addEventListener("input", () => {
    ensureAudio();
    audioEl.volume = parseFloat(volEl.value);
  });

  seekEl.addEventListener("input", () => {
    const t = STATE.tracks[STATE.current];
    if (!t || !isFinite(t.duration) || !t.duration) return;
    const ratio = parseFloat(seekEl.value);
    audioEl.currentTime = ratio * t.duration;
  });

  audioEl.addEventListener("timeupdate", updateTimeUI);
  function updateTimeUI() {
    const t = STATE.tracks[STATE.current];
    const cur = audioEl.currentTime || 0;
    const dur = (t && t.duration) || audioEl.duration || 0;
    timeEl.textContent = `${fmtTime(cur)} / ${fmtTime(dur)}`;
    if (dur > 0) seekEl.value = (cur / dur).toFixed(3);
  }

  ["dragenter", "dragover"].forEach(evt =>
    dropzone.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); dropzone.classList.add("drag"); })
  );
  ["dragleave", "drop"].forEach(evt =>
    dropzone.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); dropzone.classList.remove("drag"); })
  );
  dropzone.addEventListener("drop", (e) => {
    addFiles(e.dataTransfer.files);
  });

  addBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => addFiles(e.target.files));

  cinemaBtn.addEventListener("click", () => {
    document.body.classList.toggle("cinema");
    setTimeout(fitCanvas, 50);
  });

  exitCinemaBtn.addEventListener("click", () => {
    if (document.body.classList.contains("cinema")) {
      document.body.classList.remove("cinema");
      setTimeout(fitCanvas, 50);
    }
  });

  qualitySel.addEventListener("change", () => {
    STATE.quality = qualitySel.value;
    if (STATE.quality === "high") {
      STATE.bars = 64;
      STATE.peakDecay = 0.012;
    } else if (STATE.quality === "medium") {
      STATE.bars = 48;
      STATE.peakDecay = 0.016;
    } else {
      STATE.bars = 32;
      STATE.peakDecay = 0.02;
    }
    STATE.peakHold = new Array(STATE.bars).fill(0);
  });

  function makeLogBandMap(nFftBins, nBars, sampleRate = 44100) {
    const nyquist = sampleRate / 2;
    const fMin = 32, fMax = Math.min(16000, nyquist);
    const binsPerBar = [];
    for (let i = 0; i < nBars; i++) {
      const t0 = i / nBars, t1 = (i + 1) / nBars;
      const f0 = fMin * Math.pow(fMax / fMin, t0);
      const f1 = fMin * Math.pow(fMax / fMin, t1);
      const b0 = Math.max(0, Math.floor((f0 / nyquist) * nFftBins));
      const b1 = Math.min(nFftBins - 1, Math.ceil((f1 / nyquist) * nFftBins));
      binsPerBar.push([b0, Math.max(b0 + 1, b1)]);
    }
    return binsPerBar;
  }

  let bandMap = null;
  function loop() {
    STATE.rafId = requestAnimationFrame(loop);
    if (!analyser) return;
    analyser.getByteFrequencyData(freqData);
    analyser.getByteTimeDomainData(timeData);
    drawFrame(freqData, timeData);
  }

  function drawFrame(freq, wave) {
    const W = canvas.clientWidth, H = canvas.clientHeight;

    if (!bandMap || bandMap.length !== STATE.bars) {
      bandMap = makeLogBandMap(freq.length, STATE.bars, audioCtx?.sampleRate || 44100);
      STATE.peakHold = new Array(STATE.bars).fill(0);
    }

    ctx2d.fillStyle = "#07090c";
    ctx2d.fillRect(0, 0, W, H);

    const grad = ctx2d.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0.0, "#b8d9ff");
    grad.addColorStop(0.5, "#6ad1ff");
    grad.addColorStop(1.0, "#b072ff");

    const margin = 24;
    const visH = H * 0.62;
    const visY = (H - visH) * 0.5;
    const gap = 3;
    const barW = (W - margin * 2 - gap * (STATE.bars - 1)) / STATE.bars;

    const bars = new Array(STATE.bars).fill(0);
    for (let i = 0; i < STATE.bars; i++) {
      const [b0, b1] = bandMap[i];
      let sum = 0;
      for (let b = b0; b < b1; b++) sum += freq[b];
      const avg = sum / (b1 - b0);
      const tilt = Math.pow(i / STATE.bars, 0.7) * 0.15;
      bars[i] = Math.min(1, Math.max(0, (avg / 255) * (1 - tilt)));
    }

    ctx2d.save();
    ctx2d.translate(margin, visY + visH);
    ctx2d.fillStyle = grad;
    ctx2d.strokeStyle = "rgba(255,255,255,0.08)";
    for (let i = 0; i < STATE.bars; i++) {
      const x = i * (barW + gap);
      const h = Math.max(2, bars[i] * visH);
      STATE.peakHold[i] = Math.max(STATE.peakHold[i] - STATE.peakDecay * visH, h);
      ctx2d.fillRect(x, -h, barW, h);
      ctx2d.strokeRect(x + 0.5, -h + 0.5, barW - 1, h - 1);
      ctx2d.fillStyle = "rgba(255,255,255,0.6)";
      ctx2d.fillRect(x, -STATE.peakHold[i] - 2, barW, 2);
      ctx2d.fillStyle = grad;
    }
    ctx2d.restore();

    const waveH = Math.min(H * 0.22, 140);
    const waveY = H - waveH - 18;
    ctx2d.save();
    ctx2d.translate(0, waveY + waveH / 2);

    ctx2d.lineWidth = 2;
    ctx2d.strokeStyle = "rgba(255,255,255,0.85)";
    ctx2d.beginPath();
    const step = Math.max(1, Math.floor(wave.length / W));
    for (let x = 0, i = 0; i < wave.length; i += step, x++) {
      const v = (wave[i] - 128) / 128;
      const y = v * (waveH * 0.48);
      if (x === 0) ctx2d.moveTo(x, y);
      else ctx2d.lineTo(x, y);
    }
    ctx2d.stroke();

    ctx2d.globalAlpha = 0.35;
    ctx2d.lineWidth = 8;
    ctx2d.strokeStyle = "#6ad1ff";
    ctx2d.stroke();
    ctx2d.globalAlpha = 1;
    ctx2d.restore();

    const vignette = ctx2d.createRadialGradient(W/2, H/2, Math.min(W,H)*0.2, W/2, H/2, Math.max(W,H)*0.7);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx2d.fillStyle = vignette;
    ctx2d.fillRect(0,0,W,H);
  }

  window.addEventListener("load", () => {
    fitCanvas();
    window.addEventListener("resize", fitCanvas);
  });

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") { e.preventDefault(); STATE.playing ? pause() : play(); }
    if (e.code === "ArrowRight") { audioEl.currentTime = Math.min((audioEl.currentTime||0)+5, audioEl.duration||1e9); }
    if (e.code === "ArrowLeft") { audioEl.currentTime = Math.max((audioEl.currentTime||0)-5, 0); }
  });
})();
