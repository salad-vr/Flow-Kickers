/**
 * Global background music player.
 * Loops a single track and persists mute state in localStorage.
 */

const STORAGE_KEY = 'flowkickers_music_muted';

let audio: HTMLAudioElement | null = null;
let muted = localStorage.getItem(STORAGE_KEY) === '1';
let started = false;

/** Create the audio element (call once at startup) */
export function initMusic() {
  audio = new Audio('/audio/bgmusic.m4a');
  audio.loop = true;
  audio.volume = 0.35;
  audio.muted = muted;

  // Browsers block autoplay until user interacts.
  // We try to play immediately, and if it fails we set up a one-shot
  // listener that starts on the first click/keypress.
  tryPlay();

  const startOnInteraction = () => {
    tryPlay();
    if (started) {
      document.removeEventListener('click', startOnInteraction);
      document.removeEventListener('keydown', startOnInteraction);
      document.removeEventListener('pointerdown', startOnInteraction);
    }
  };
  document.addEventListener('click', startOnInteraction);
  document.addEventListener('keydown', startOnInteraction);
  document.addEventListener('pointerdown', startOnInteraction);
}

function tryPlay() {
  if (!audio || started) return;
  const p = audio.play();
  if (p) {
    p.then(() => { started = true; })
     .catch(() => { /* blocked – will retry on interaction */ });
  }
}

/** Toggle mute on/off. Returns the new muted state. */
export function toggleMute(): boolean {
  muted = !muted;
  if (audio) audio.muted = muted;
  localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
  return muted;
}

/** Query current muted state */
export function isMuted(): boolean {
  return muted;
}
