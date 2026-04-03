// Door Kickers-inspired color palette
// Exported separately so rendering modules can import cleanly

export const PALETTE = {
  // Environment
  bgOuter: '#0d1b1e',
  floor: '#6b5d4a',
  floorAlt: '#5f5340',
  grid: 'rgba(0,0,0,0.12)',

  // Walls
  wall: '#1a1a1a',
  wallEdge: '#0a0a0a',
  wallBevel: '#333',

  // Doors
  doorFrame: '#3a3a2a',
  doorClosed: '#4a4a3a',
  doorOpen: '#5a6a3a',

  // FOV
  fovFill: 'rgba(255, 220, 120, 0.12)',
  fovEdge: 'rgba(255, 220, 120, 0.25)',

  // Fog
  fog: 'rgba(10, 20, 25, 0.7)',

  // Threats
  threatActive: '#cc3333',
  threatGlow: 'rgba(200, 50, 50, 0.3)',
  threatNeutralized: '#555',
  threatNeutralizedGlow: 'rgba(80, 80, 80, 0.2)',

  // Operators
  opBody: '#ccbb88',
  opOutline: '#111',

  // Paths
  pathAlpha: 0.7,

  // UI overlay
  uiOverlayBg: 'rgba(15, 30, 35, 0.85)',
  uiText: '#aaccbb',
  uiTextBright: '#ddeedd',
  uiAccent: '#44bbaa',

  // Status
  cleared: '#44dd66',
  holdMarker: '#ff8844',
  goCodeA: '#44aaff',
  goCodeB: '#ff8844',
  goCodeC: '#44dd66',
} as const;
