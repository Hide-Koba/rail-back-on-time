// 画面上部の HUD: ステージ名、時刻、一時停止・倍速、総遅延。SPEC.md §6.1。
import { SPEED_MULTIPLIERS } from '../config.js';

export const formatClock = (sec) => {
  const h = Math.floor(sec / 3600) % 24;
  const m = Math.floor(sec / 60) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

export function createHud(root, { title, onTogglePause, onSpeed }) {
  root.innerHTML = `
    <div class="hud-row">
      <div class="hud-title"></div>
      <div class="hud-clock" aria-label="現在時刻"></div>
      <div class="hud-delay" aria-label="総遅延"><span class="hud-delay-label">総遅延</span> <b></b><span class="hud-delay-unit">分</span></div>
    </div>
    <div class="hud-row hud-controls">
      <button type="button" class="btn btn-pause"></button>
      ${SPEED_MULTIPLIERS.map((m, i) => `<button type="button" class="btn btn-speed" data-speed="${i}">${m}x</button>`).join('')}
    </div>`;
  const $ = (sel) => root.querySelector(sel);
  const titleEl = $('.hud-title');
  const clockEl = $('.hud-clock');
  const delayEl = $('.hud-delay b');
  const pauseBtn = $('.btn-pause');
  const speedBtns = [...root.querySelectorAll('.btn-speed')];
  titleEl.textContent = title;

  pauseBtn.addEventListener('click', onTogglePause);
  speedBtns.forEach((b) => b.addEventListener('click', () => onSpeed(Number(b.dataset.speed))));

  const shown = {};
  const setText = (key, node, text) => {
    if (shown[key] !== text) { node.textContent = text; shown[key] = text; }
  };

  return {
    update({ clockSec, totalDelayMin, paused, speedIndex, finished }) {
      setText('clock', clockEl, formatClock(clockSec));
      setText('delay', delayEl, String(totalDelayMin));
      setText('pause', pauseBtn, finished ? '終了' : paused ? '▶ 再開' : '⏸ 一時停止');
      pauseBtn.disabled = finished;
      pauseBtn.classList.toggle('on', paused && !finished);
      speedBtns.forEach((b, i) => b.classList.toggle('on', i === speedIndex));
    },
  };
}
