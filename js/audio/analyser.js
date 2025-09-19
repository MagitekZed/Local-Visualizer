// Analyser module for audio visualization
// Creates an AnalyserNode and exposes helper functions to
// retrieve frequency bands, waveform data, and grouped energy.

export function createAnalyser(audioContext, fftSize = 2048) {
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = fftSize;
  analyser.smoothingTimeConstant = 0.82;
  analyser.minDecibels = -85;
  analyser.maxDecibels = -15;

  const bufferLength = analyser.frequencyBinCount;
  const freqData = new Uint8Array(bufferLength);
  const waveformData = new Uint8Array(analyser.fftSize);

  // Precompute logarithmic band boundaries for approx 24 bands
  const bandCount = 24;
  const bandIndices = new Array(bandCount + 1);
  for (let i = 0; i <= bandCount; i++) {
    // Quadratic scaling to approximate log spacing
    bandIndices[i] = Math.floor(Math.pow(i / bandCount, 2) * bufferLength);
  }
  const bands = new Float32Array(bandCount);

  // Get raw byte frequency data (0-255)
  function getFrequencyData() {
    analyser.getByteFrequencyData(freqData);
    return freqData;
  }

  // Get waveform time domain data (0-255)
  function getWaveformData() {
    analyser.getByteTimeDomainData(waveformData);
    return waveformData;
  }

  // Compute normalized band energies (0..1) for each log-spaced band
  function getBands() {
    analyser.getByteFrequencyData(freqData);
    for (let i = 0; i < bandCount; i++) {
      let sum = 0;
      const start = bandIndices[i];
      const end = bandIndices[i + 1];
      const count = end - start || 1;
      for (let j = start; j < end; j++) {
        sum += freqData[j];
      }
      bands[i] = (sum / count) / 255;
    }
    return bands;
  }

  // Compute grouped low/mid/high energies (0..1)
  function getEnergy() {
    analyser.getByteFrequencyData(freqData);
    let low = 0, mid = 0, high = 0;
    const lowEnd = Math.floor(bufferLength * 0.1);
    const midEnd = Math.floor(bufferLength * 0.4);
    for (let i = 0; i < bufferLength; i++) {
      const v = freqData[i];
      if (i < lowEnd) {
        low += v;
      } else if (i < midEnd) {
        mid += v;
      } else {
        high += v;
      }
    }
    return {
      low: low / (lowEnd * 255),
      mid: mid / ((midEnd - lowEnd) * 255),
      high: high / ((bufferLength - midEnd) * 255)
    };
  }

  return {
    analyser,
    node: analyser,
    getFrequencyData,
    getWaveformData,
    getBands,
    getEnergy
  };
}

