/**
 * Lightweight tactile UI sound effects using Web Audio API.
 * All sounds are synthesised -- no files required.
 * Respects the global mute state from musicPlayer.
 */

import { isMuted } from './musicPlayer';

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (isMuted()) return null;
  if (!ctx) {
    try { ctx = new AudioContext(); } catch { return null; }
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Soft click -- the default button press sound.  Very short, quiet tap. */
export function sfxClick() {
  const c = getCtx(); if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(800, c.currentTime);
  o.frequency.exponentialRampToValueAtTime(500, c.currentTime + 0.06);
  g.gain.setValueAtTime(0.08, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.06);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime);
  o.stop(c.currentTime + 0.06);
}

/** Slightly brighter tick for selecting / toggling items (room cards, tools). */
export function sfxSelect() {
  const c = getCtx(); if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(1100, c.currentTime);
  o.frequency.exponentialRampToValueAtTime(700, c.currentTime + 0.05);
  g.gain.setValueAtTime(0.07, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.05);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime);
  o.stop(c.currentTime + 0.05);
}

/** Positive confirm -- short rising two-tone (start mission, save, GO). */
export function sfxConfirm() {
  const c = getCtx(); if (!c) return;
  const t = c.currentTime;
  // tone 1
  const o1 = c.createOscillator();
  const g1 = c.createGain();
  o1.type = 'sine';
  o1.frequency.setValueAtTime(600, t);
  g1.gain.setValueAtTime(0.09, t);
  g1.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
  o1.connect(g1).connect(c.destination);
  o1.start(t); o1.stop(t + 0.07);
  // tone 2 (higher, slightly delayed)
  const o2 = c.createOscillator();
  const g2 = c.createGain();
  o2.type = 'sine';
  o2.frequency.setValueAtTime(900, t + 0.06);
  g2.gain.setValueAtTime(0.09, t + 0.06);
  g2.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
  o2.connect(g2).connect(c.destination);
  o2.start(t + 0.06); o2.stop(t + 0.13);
}

/** Soft back / cancel -- short falling tone. */
export function sfxBack() {
  const c = getCtx(); if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(500, c.currentTime);
  o.frequency.exponentialRampToValueAtTime(300, c.currentTime + 0.08);
  g.gain.setValueAtTime(0.07, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.08);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime);
  o.stop(c.currentTime + 0.08);
}

/** Tiny subtle hover-like tick for navigation (tutorial prev/next, slide dots). */
export function sfxTick() {
  const c = getCtx(); if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(1000, c.currentTime);
  g.gain.setValueAtTime(0.04, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.03);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime);
  o.stop(c.currentTime + 0.03);
}

/** Soft delete / destructive action -- low thud. */
export function sfxDelete() {
  const c = getCtx(); if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(250, c.currentTime);
  o.frequency.exponentialRampToValueAtTime(120, c.currentTime + 0.1);
  g.gain.setValueAtTime(0.08, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.1);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime);
  o.stop(c.currentTime + 0.1);
}
