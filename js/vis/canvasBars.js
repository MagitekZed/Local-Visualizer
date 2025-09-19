
export default function BarsVisualizer(canvas, analyser) {
  const ctx = canvas.getContext('2d');
  return {
    draw(frame) {
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);
      // Draw frequency bars
      const bands = frame.bands || [];
      const barWidth = width / bands.length;
      for (let i = 0; i < bands.length; i++) {
        const value = bands[i];
        const barHeight = value * height * 0.8;
        const x = i * barWidth;
        const y = height - barHeight;
        // Color: hue varies across spectrum
        ctx.fillStyle = `hsl(${(i / bands.length) * 360}, 70%, 50%)`;
        ctx.fillRect(x + barWidth * 0.1, y, barWidth * 0.8, barHeight);
      }
      // Draw waveform overlay
      const waveform = frame.waveform || [];
      if (waveform.length) {
        ctx.beginPath();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        const step = waveform.length / width;
        for (let x = 0; x < width; x++) {
          const idx = Math.floor(x * step);
          const v = waveform[idx] || 0; // range -1..1
          const y = height / 2 + v * height * 0.3;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    },
  };
}
