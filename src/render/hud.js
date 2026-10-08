// 画面上部の HUD: ステージ名、時刻、一時停止・倍速、総遅延。SPEC.md §6.1。
import { SPEED_MULTIPLIERS } from '../config.js';

export const formatClock = (sec) => {
  const h = Math.floor(sec / 3600) % 24;
  const m = Math.floor(sec / 60) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

export function createHud(root, { title, onTogglePause, onSpeed, onBack }) {
  root.innerHTML = `
    <div class="hud-row">
      <button type="button" class="hud-back" aria-label="ステージ選択へ戻る">‹</button>
      <div class="hud-title"></div>
      <div class="hud-clock" aria-label="現在時刻"></div>
      <div class="hud-delay" aria-label="総遅延"><span class="hud-delay-label">総遅延</span> <b></b><span class="hud-delay-unit">分</span></div>
    </div>
    <div class="hud-row hud-controls">
      <button type="button" class="btn btn-pause"></button>
      ${SPEED_MULTIPLIERS.map((m, i) => `<button type="button" class="btn btn-speed" data-speed="${i}">${m}x</button>`).join('')}
    </div>
    <div class="hud-cards" hidden></div>`;
  const $ = (sel) => root.querySelector(sel);
  const titleEl = $('.hud-title');
  const clockEl = $('.hud-clock');
  const delayEl = $('.hud-delay b');
  const pauseBtn = $('.btn-pause');
  const speedBtns = [...root.querySelectorAll('.btn-speed')];
  const cardsEl = $('.hud-cards');
  titleEl.textContent = title;

  $('.hud-back').addEventListener('click', onBack);
  pauseBtn.addEventListener('click', onTogglePause);
  speedBtns.forEach((b) => b.addEventListener('click', () => onSpeed(Number(b.dataset.speed))));

  const shown = {};
  const setText = (key, node, text) => {
    if (shown[key] !== text) { node.textContent = text; shown[key] = text; }
  };

  return {
    /** blocked: チュートリアルの案内で自動的に止まっている */
    update({ clockSec, totalDelayMin, paused, speedIndex, finished, blocked, cards }) {
      setText('clock', clockEl, formatClock(clockSec));
      setText('delay', delayEl, String(totalDelayMin));
      setText('pause', pauseBtn, finished ? '終了' : blocked ? '案内を確認' : paused ? '▶ 再開' : '⏸ 一時停止');
      pauseBtn.disabled = finished || blocked;
      pauseBtn.classList.toggle('on', (paused || blocked) && !finished);
      speedBtns.forEach((b, i) => b.classList.toggle('on', i === speedIndex));
      // 指令カードの残り（ステージにカードがあるときだけ）
      cardsEl.hidden = !cards;
      if (cards) setText('cards', cardsEl, `指令カード　運休 ${cards.cancel}　折返し短縮 ${cards.shorten}`);
    },
  };
}
