/**
 * circle.js - circular spectrum visualizer
 * Provides a visualizer that draws radial arcs around the center of the canvas
 * using the frequency band energies. The radius and thickness of each arc
 * respond to the magnitude of the band, creating a dynamic circular spectrum.
 */
export default function CircleVisualizer(canvas, analyser) {
  const ctx = canvas.getContext('2d');
  return {
    draw(frame) {
      const bands = frame.bands || [];
      const width = canvas.width;
      const height = canvas.height;
      // Clear the canvas
      ctx.clearRect(0, 0, width, height);

      // Compute center and radius bounds
      const cx = width / 2;
      const cy = height / 2;
      const minDim = Math.min(width, height);
      const baseRadius = minDim * 0.2; // inner radius for the spectrum
      const maxRadius = minDim * 0.45; // maximum radius for strongest bands

      const numBands = bands.length;
      if (numBands === 0) return;

      // Draw each band as a radial arc
      for (let i = 0; i < numBands; i++) {
        const value = bands[i]; // 0..1
        const startAngle = (i / numBands) * Math.PI * 2;
        const endAngle = ((i + 1) / numBands) * Math.PI * 2;
        const radius = baseRadius + value * (maxRadius - baseRadius);
        ctx.beginPath();
        ctx.arc(cx, cy, radius, startAngle, endAngle);
        ctx.lineWidth = 4;
        // Use hue based on band index
        ctx.strokeStyle = `hsl(${(i / numBands) * 360}, 80%, 60%)`;
        ctx.stroke();
      }
    }
  };
}
