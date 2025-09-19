// app.js - main entry point for the local visualizer application
// Handles user interactions, sets up audio and visualizer, and manages the render loop.

import { AudioPlayer } from './audio/playback.js';
import { createAnalyser } from './audio/analyser.js';
import BarsVisualizer from './vis/bars.js';
import CircleVisualizer from './vis/circle.js';

// Grab DOM elements
const fileInput = document.getElementById('file-input');
const fileLabel = document.querySelector('.file-label'); // label for file input
const playBtn = document.getElementById('play-btn');
const pauseBtn = document.getElementById('pause-btn');
const visSelect = document.getElementById('visualizer-select');
const canvas = document.getElementById('visualizer');
const ctx = canvas.getContext('2d');

// Resize canvas to fill the window
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Initialize audio player and analyser
const player = new AudioPlayer();
const analyser = createAnalyser();

// Connect the analyser to the destination when audio is loaded
function connectNodes() {
  player.connect(analyser.analyser);
}

// Current visualizer instance
let currentVisualizer = null;

// Create visualizer based on selection
function createVisualizer(name) {
  if (name === 'circle') {
    return CircleVisualizer(canvas, analyser);
  }
  // default to bars
  return BarsVisualizer(canvas, analyser);
}

// Update file label
function updateFileLabel(file) {
  if (fileLabel) {
    fileLabel.textContent = file ? file.name : 'Choose audio file';
  }
}

// Handle file selection
fileInput.addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (file) {
    updateFileLabel(file);
    await player.loadFile(file);
    connectNodes();
    // Start playing automatically
    player.play();
    // Start animation loop
    if (!currentVisualizer) {
      currentVisualizer = createVisualizer(visSelect.value);
    }
    animate();
  }
});

// Play button
playBtn.addEventListener('click', () => {
  player.play();
});

// Pause button
pauseBtn.addEventListener('click', () => {
  player.pause();
});

// Visualizer selection change
visSelect.addEventListener('change', () => {
  currentVisualizer = createVisualizer(visSelect.value);
});

// Animation loop
function animate() {
  requestAnimationFrame(animate);
  if (!currentVisualizer) return;
  // Get analyser data
  const bands = analyser.getBands();
  const waveform = analyser.getWaveform();
  const energy = analyser.getEnergy();
  const frame = {
    time: player.audio ? player.audio.currentTime : 0,
    bands,
    waveform,
    energy,
  };
  currentVisualizer.draw(frame);
}
