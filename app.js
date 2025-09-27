// Entry point for the local jukebox + visualiser.  This script builds the
// audio player UI, manages the track library, and interfaces with the
// visualiser through a simple manager.  The WebGL visualiser (AuroraOrbit)
// will be used when available; otherwise we fall back to a 2D canvas.

import { AuroraOrbitVisualizer } from './visualizers/aurora.js';
import { AuroraOrbit2DVisualizer } from './visualizers/aurora2d.js';

// -----------------------------------------------------------------------------
// Genre‑based colour palettes and fallbacks
//
// When no album art is embedded in a track, we still want the visualiser to
// reflect the mood of the music.  The following map associates common
// musical genres with three sRGB colours (0..1 range).  These palettes are
// inspired by basic colour theory (triads, complementary and analogous
// schemes) and typical emotions expressed in each genre.  If a track’s genre
// matches a key (case insensitive substring match), the corresponding
// palette will be used.  When no genre match is found we fall back to a
// randomly chosen palette from DEFAULT_PALETTES.  Feel free to extend this
// map with additional genres or tweak the colours to suit your taste.
const GENRE_PALETTES = {
  // Heavy metal and hard rock: dark, aggressive tones with a red accent
  metal:      [[0.05, 0.05, 0.05], [0.6, 0.0, 0.0], [0.2, 0.2, 0.2]],
  rock:       [[0.05, 0.1, 0.25], [0.55, 0.0, 0.2], [0.4, 0.4, 0.45]],
  // Indie and alternative: muted, earthy tones with a hint of warmth
  indie:      [[0.79, 0.65, 0.63], [0.38, 0.48, 0.53], [0.74, 0.69, 0.38]],
  alternative:[[0.79, 0.65, 0.63], [0.38, 0.48, 0.53], [0.74, 0.69, 0.38]],
  // Pop: bright, upbeat colours
  pop:        [[0.93, 0.24, 0.62], [0.0, 0.74, 0.83], [1.0, 0.92, 0.29]],
  // Hip‑hop / rap: dark with gold and purple accents
  hiphop:     [[0.0, 0.0, 0.0], [0.75, 0.64, 0.0], [0.29, 0.0, 0.51]],
  rap:        [[0.0, 0.0, 0.0], [0.75, 0.64, 0.0], [0.29, 0.0, 0.51]],
  // Classical: elegant neutrals with gold highlights
  classical:  [[0.84, 0.78, 0.65], [0.06, 0.16, 0.33], [0.77, 0.65, 0.32]],
  // Jazz: deep night tones with warm highlights
  jazz:       [[0.17, 0.23, 0.4], [0.47, 0.15, 0.22], [0.42, 0.36, 0.29]],
  // Electronic / EDM: neon brights with dark background
  electronic: [[0.0, 1.0, 0.83], [1.0, 0.18, 0.58], [0.48, 0.0, 1.0]],
  edm:        [[0.0, 1.0, 0.83], [1.0, 0.18, 0.58], [0.48, 0.0, 1.0]],
  // Country: natural earth tones
  country:    [[0.42, 0.31, 0.31], [0.55, 0.66, 0.53], [0.85, 0.37, 0.22]],
  // Folk: rustic, outdoorsy hues
  folk:       [[0.12, 0.37, 0.2], [0.85, 0.49, 0.05], [0.36, 0.66, 0.77]],
  // Soul / R&B: rich, soulful hues
  soul:       [[0.14, 0.05, 0.33], [0.75, 0.25, 0.48], [0.58, 0.36, 0.15]],
  rnb:        [[0.14, 0.05, 0.33], [0.75, 0.25, 0.48], [0.58, 0.36, 0.15]],
  // Reggae: Rastafarian colours
  reggae:     [[0.9, 0.07, 0.29], [0.95, 0.82, 0.07], [0.0, 0.54, 0.27]],
  // Blues: somber yet hopeful tones
  blues:      [[0.16, 0.22, 0.52], [0.0, 0.51, 0.56], [0.99, 0.85, 0.21]],
  // Dance / House: energetic, club‑inspired hues
  dance:      [[0.0, 0.77, 0.8], [0.71, 0.88, 0.0], [0.63, 0.28, 0.89]],
  house:      [[0.0, 0.77, 0.8], [0.71, 0.88, 0.0], [0.63, 0.28, 0.89]]
};

// Fallback palettes used when no genre match is found.  Each entry is an
// array of three sRGB colours chosen to contrast nicely and evoke a general
// mood.  These can be cycled randomly to keep the visuals fresh.
const DEFAULT_PALETTES = [
  [[0.89, 0.27, 0.58], [0.0, 0.62, 0.8], [0.5, 0.8, 0.2]],
  [[0.91, 0.45, 0.08], [0.18, 0.69, 0.27], [0.04, 0.26, 0.5]],
  [[0.56, 0.23, 0.68], [0.9, 0.3, 0.24], [0.98, 0.83, 0.0]],
  [[0.14, 0.57, 0.82], [0.89, 0.23, 0.34], [0.5, 0.4, 0.8]]
];

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
        // Apply current track palette to the new visualiser if available
        try {
          if (typeof vis.setPalette === 'function' && typeof STATE !== 'undefined' &&
              STATE.current !== undefined && STATE.tracks && STATE.tracks[STATE.current] &&
              STATE.tracks[STATE.current].palette) {
            vis.setPalette(STATE.tracks[STATE.current].palette);
          }
        } catch (err) {
          console.warn('Failed to set palette on WebGL visualiser:', err);
        }
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
      // Apply current track palette to the 2D visualiser if available
      try {
        if (typeof fallback.setPalette === 'function' && typeof STATE !== 'undefined' &&
            STATE.current !== undefined && STATE.tracks && STATE.tracks[STATE.current] &&
            STATE.tracks[STATE.current].palette) {
          fallback.setPalette(STATE.tracks[STATE.current].palette);
        }
      } catch (err) {
        console.warn('Failed to set palette on 2D visualiser:', err);
      }
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
   * Toggle between the WebGL and 2D visualisers.  If the current
   * active type is WebGL we switch to the 2D fallback; otherwise we
   * attempt to initialise the WebGL visualiser.  The caller should
   * update any UI labels after calling this method.
   */
  toggle() {
    const preferWebGL = this.activeType !== 'webgl';
    this._create(preferWebGL);
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
  // There is no longer a top-level "Add Songs" button.  Instead we
  // provide a clickable link inside the dropzone.  Grab a reference
  // to that element so we can trigger the hidden file input.
  const addSongsLink = document.getElementById('addSongsLink');
  const fileInput = $('#fileInput');
  const trackListEl = $('#trackList');
  const dropzone = $('#dropzone');
  const timeEl = $('#time');
  const seekEl = $('#seek');
  const volEl = $('#volume');
  const cinemaBtn = $('#btn-cinema');
  const exitCinemaBtn = $('#btn-exit-cinema');
  const qualitySel = $('#quality');
  const prevBtn = document.getElementById('btn-prev');
  const nextBtn = document.getElementById('btn-next');

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
    // Set the toggle button label to indicate the mode that will be
    // activated when clicked.  If WebGL is active, show "2D", else
    // show "3D".  This ensures the button label is correct on
    // first initialisation.
    const toggleBtn = document.getElementById('btn-toggle-vis');
    if (toggleBtn) {
      toggleBtn.textContent = visualizerManager.activeType === 'webgl' ? '2D' : '3D';
    }
  }

  /**
   * Add multiple files to the library.  Filters out non‑audio files.  Each
   * file is given an ID based on its name, size and lastModified so we
   * don't add duplicates.  After adding, we re-render the track list.
   */
  async function addFiles(fileList) {
    const files = Array.from(fileList).filter((f) => f.type.startsWith('audio/'));
    if (!files.length) return;
    // Process each file sequentially so metadata extraction can run in
    // order.  Using await ensures asynchronous parsing completes
    // before rendering the list.
    for (const file of files) {
      const id = `${file.name}-${file.size}-${file.lastModified}`;
      // Skip duplicates based on ID
      if (STATE.tracks.some((t) => t.id === id)) continue;
      const url = URL.createObjectURL(file);
      const defaultTitle = file.name.replace(/\.[^/.]+$/, '');
      const track = {
        id,
        file,
        url,
        duration: 0,
        title: defaultTitle,
        artist: '',
        album: '',
        // genre and palette will be populated during metadata extraction
        genre: '',
        palette: undefined
      };
      // Extract metadata asynchronously
      await extractMetadata(file, track);
      STATE.tracks.push(track);
    }
    // After all tracks have been processed, render the list and
    // ensure the first track is loaded if none is selected.
    renderTrackList();
    if (STATE.current === -1 && STATE.tracks.length) loadTrack(0, false);
  }

  /**
   * Attempt to extract metadata (title, artist, album) from a file.  This
   * function tries several methods in sequence: music-metadata-browser,
   * jsmediatags, and a custom ID3v1 parser.  Only missing fields on
   * the track object will be updated.
   *
   * @param {File} file The audio file to parse
   * @param {Object} track Object to write metadata into
   */
  async function extractMetadata(file, track) {
    // Try music-metadata-browser if available.  The library can be attached
    // as musicMetadata, mm, or musicMetadataBrowser.  We choose the first
    // defined and call its parseBlob method.
    {
      const mmObject = window.musicMetadata || window.mm || window.musicMetadataBrowser;
      if (mmObject && typeof mmObject.parseBlob === 'function') {
        try {
          const metadata = await mmObject.parseBlob(file);
          const common = (metadata && metadata.common) ? metadata.common : {};
          if (common.title && !track.title) track.title = common.title;
          if (common.artist && !track.artist) track.artist = common.artist;
          if (common.album && !track.album) track.album = common.album;
          if (!track.artist && Array.isArray(common.artists) && common.artists.length) {
            track.artist = common.artists.join(', ');
          }
          // Capture genre if available.  music-metadata may provide an array
          // or a single string.  We store a lowercase string for matching.
          if (!track.genre && common.genre) {
            if (Array.isArray(common.genre)) {
              track.genre = common.genre.join(', ');
            } else {
              track.genre = common.genre;
            }
          }
        } catch (err) {
          console.warn('music-metadata error:', err);
        }
      }
    }
    // If the metadata returned a title that is just the file name (without
    // extension), clear it out so that we can fall back to other methods.
    if (track.title) {
      const stem = file.name.replace(/\.[^/.]+$/, '');
      const normStem = stem.replace(/[^a-z0-9]/gi, '').toLowerCase();
      const normTitle = track.title.replace(/[^a-z0-9]/gi, '').toLowerCase();
      if (normTitle === normStem || normTitle.endsWith(normStem)) {
        track.title = '';
      }
    }
    // Try jsmediatags if still missing
    if ((!track.title || !track.artist || !track.album) && window.jsmediatags) {
      try {
        await new Promise((resolve) => {
          window.jsmediatags.read(file, {
            onSuccess: function(tag) {
              const tags = tag.tags || {};
              if (tags.title && !track.title) track.title = tags.title;
              if (tags.artist && !track.artist) track.artist = tags.artist;
              if (tags.album && !track.album) track.album = tags.album;
              // jsmediatags exposes genre as a string.  Capture it for
              // fallback palette selection.
              if (!track.genre && tags.genre) track.genre = tags.genre;
              resolve();
            },
            onError: function(error) {
              console.warn('jsmediatags error:', error.type, error.info);
              resolve();
            }
          });
        });
      } catch (e) {
        // ignore errors
      }
      // If jsmediatags produced a title that matches the filename, clear it
      if (track.title) {
        const stem = file.name.replace(/\.[^/.]+$/, '');
        const normStem = stem.replace(/[^a-z0-9]/gi, '').toLowerCase();
        const normTitle = track.title.replace(/[^a-z0-9]/gi, '').toLowerCase();
        if (normTitle === normStem || normTitle.endsWith(normStem)) {
          track.title = '';
        }
      }
    }
    // Finally, parse ID3v1 tag manually if still missing.  Many
    // older MP3 files include only ID3v1 tags at the end of the file.
    if ((!track.title || !track.artist || !track.album) && file.size >= 128) {
      await new Promise((resolve) => {
        const reader = new FileReader();
        const blob = file.slice(file.size - 128, file.size);
        reader.onload = function(e) {
          const data = new Uint8Array(e.target.result);
          if (data[0] === 0x54 && data[1] === 0x41 && data[2] === 0x47) {
            const decoder = new TextDecoder('iso-8859-1');
            function decodeField(offset, length) {
              const arr = data.slice(offset, offset + length);
              let str = decoder.decode(arr);
              return str.replace(/\u0000+$/g, '').trim();
            }
            const v1Title = decodeField(3, 30);
            const v1Artist = decodeField(33, 30);
            const v1Album = decodeField(63, 30);
            if (v1Title && !track.title) track.title = v1Title;
            if (v1Artist && !track.artist) track.artist = v1Artist;
            if (v1Album && !track.album) track.album = v1Album;
          }
          resolve();
        };
        reader.onloadend = reader.onerror = () => resolve();
        reader.readAsArrayBuffer(blob);
      });
    }

    // Attempt to extract an album art palette.  Some parsers expose a
    // `picture` array or object containing image data.  We only
    // extract the first image.  The palette is stored on track.palette
    // as an array of sRGB colours (0..1).  If extraction fails or no
    // picture exists, palette remains undefined and default colours
    // will be used.
    async function extractPaletteFromPicture(picture) {
      if (!picture || !picture.data) return null;
      try {
        const byteArray = picture.data instanceof Uint8Array ? picture.data : new Uint8Array(picture.data);
        const format = picture.format || 'image/jpeg';
        const blob = new Blob([byteArray], { type: format });
        return await new Promise((resolve) => {
          const img = new Image();
          img.crossOrigin = 'Anonymous';
          img.onload = function() {
            const size = 32;
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, size, size);
            const data = ctx.getImageData(0, 0, size, size).data;
            const hist = {};
            for (let i = 0; i < data.length; i += 4) {
              const r = data[i];
              const g = data[i + 1];
              const b = data[i + 2];
              // Quantise to 5 bits per channel
              const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
              hist[key] = (hist[key] || 0) + 1;
            }
            const keys = Object.keys(hist).sort((a, b) => hist[b] - hist[a]);
            const palette = [];
            for (let k = 0; k < 3 && k < keys.length; k++) {
              const key = parseInt(keys[k]);
              const r = ((key >> 10) & 0x1f) << 3;
              const g = ((key >> 5) & 0x1f) << 3;
              const b = (key & 0x1f) << 3;
              palette.push([r / 255, g / 255, b / 255]);
            }
            resolve(palette);
          };
          img.onerror = function() {
            resolve(null);
          };
          img.src = URL.createObjectURL(blob);
        });
      } catch (err) {
        console.warn('Palette extraction error:', err);
        return null;
      }
    }
    // Extract palette from music-metadata-browser picture (if available)
    // The library may expose picture data in metadata.common.picture
    if (!track.palette) {
      try {
        const mmObject = window.musicMetadata || window.mm || window.musicMetadataBrowser;
        if (mmObject && typeof mmObject.parseBlob === 'function') {
          // Already parsed in first step; metadata variable still scoped?  We cannot access it here.
        }
        // Instead, attempt to call parseBlob again to extract picture.  This is
        // inefficient but ensures we can access picture fields.
        const mmObj = window.musicMetadata || window.mm || window.musicMetadataBrowser;
        if (mmObj && typeof mmObj.parseBlob === 'function') {
          const meta = await mmObj.parseBlob(file);
          const pictures = (meta && meta.common && meta.common.picture) ? meta.common.picture : [];
          if (pictures && pictures.length) {
            const palette = await extractPaletteFromPicture(pictures[0]);
            if (palette && palette.length) track.palette = palette;
          }
        }
      } catch (e) {
        // ignore
      }
    }
    // Extract palette from jsmediatags picture
    if (!track.palette && window.jsmediatags) {
      try {
        await new Promise((resolve) => {
          window.jsmediatags.read(file, {
            onSuccess: async (tag) => {
              const pic = tag.tags.picture;
              if (pic) {
                const palette = await extractPaletteFromPicture(pic);
                if (palette && palette.length) {
                  track.palette = palette;
                }
              }
              resolve();
            },
            onError: () => resolve()
          });
        });
      } catch (e) {
        // ignore
      }
    }

    // If still no palette, derive one based on genre or choose a random
    // fallback.  We perform a substring match on the genre string to
    // select a palette from GENRE_PALETTES.  If no match, a random
    // entry from DEFAULT_PALETTES is chosen.  This ensures every
    // track has a colour scheme even without embedded artwork.
    if (!track.palette) {
      let genreStr = '';
      if (track.genre && typeof track.genre === 'string') {
        genreStr = track.genre.toLowerCase();
      }
      let matchedPalette = null;
      if (genreStr) {
        for (const key in GENRE_PALETTES) {
          if (genreStr.includes(key)) {
            matchedPalette = GENRE_PALETTES[key];
            break;
          }
        }
      }
      if (matchedPalette) {
        track.palette = matchedPalette;
      } else {
        const idx = Math.floor(Math.random() * DEFAULT_PALETTES.length);
        track.palette = DEFAULT_PALETTES[idx];
      }
    }
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
      // Metadata container holds title and artist/album
      const meta = document.createElement('div');
      meta.className = 'meta';
      // Title: use track.title if available, otherwise fallback to name
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = t.title || t.name;
      // Artist/album line.  Show both if available; if no metadata,
      // leave blank so the time can be shown instead.
      const sub = document.createElement('div');
      sub.className = 'sub';
      if (t.artist || t.album) {
        const artist = t.artist || '';
        const album = t.album || '';
        sub.textContent = `${artist}${artist && album ? ' – ' : ''}${album}`;
      } else {
        sub.textContent = '';
      }
      meta.appendChild(title);
      meta.appendChild(sub);
      li.appendChild(icon);
      li.appendChild(meta);
      // Duration/time indicator on the right.  Only show if we know the
      // duration (i.e. metadata loaded).  If not loaded yet, leave empty.
      const timeSpan = document.createElement('div');
      timeSpan.className = 'time';
      timeSpan.textContent = t.duration ? fmtTime(t.duration) : '';
      li.appendChild(timeSpan);
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
      // Apply the colour palette from metadata to the visualiser if available
      if (t.palette && visualizerManager.impl && typeof visualizerManager.impl.setPalette === 'function') {
        visualizerManager.impl.setPalette(t.palette);
      }
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

  // Navigate to the previous track in the list.  If we're at the first
  // track, wrap around to the last.  We respect the current track
  // order stored in STATE.tracks.
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (!STATE.tracks.length) return;
      const prevIndex = STATE.current > 0 ? STATE.current - 1 : STATE.tracks.length - 1;
      loadTrack(prevIndex, true);
    });
  }
  // Navigate to the next track in the list.  If we're at the last
  // track, wrap around to the first.
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (!STATE.tracks.length) return;
      const nextIndex = (STATE.current + 1) % STATE.tracks.length;
      loadTrack(nextIndex, true);
    });
  }

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

  // Clicking the "Add Songs" link (inside the dropzone) triggers
  // the hidden file input.  When files are selected, we add them
  // to the library.  The file input remains hidden in the DOM.
  if (addSongsLink) {
    addSongsLink.addEventListener('click', () => {
      fileInput.click();
    });
  }
  fileInput.addEventListener('change', (e) => {
    addFiles(e.target.files);
    // Reset the value so the same file can be re‑added if needed
    fileInput.value = '';
  });

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

  // Toggle between 3D (WebGL) and 2D (Canvas) visualisers.  When the
  // user clicks the toggle button we swap the implementation and
  // update the button label to reflect the next mode.  After
  // switching we explicitly resize the visualiser to fit the stage.
  const toggleBtn = document.getElementById('btn-toggle-vis');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      // Flip the active visualiser type
      visualizerManager.toggle();
      // Update the button text: if WebGL is now active, show "2D"; else "3D"
      if (visualizerManager.activeType === 'webgl') {
        toggleBtn.textContent = '2D';
      } else {
        toggleBtn.textContent = '3D';
      }
      // Resize after toggling to ensure canvas fits
      const rect = stage.getBoundingClientRect();
      visualizerManager.resize(rect.width, rect.height);
    });
  }

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