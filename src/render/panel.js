// 詳細パネル（下部に固定）。列車を選んでいるときだけ表示する。SPEC.md §6.5。
import { TYPE_NAMES } from '../config.js';
import { holdAction } from '../sim/commands.js';
import { nextStationIndex, plannedTrack } from '../sim/dispatch.js';
import { delayMinutes } from './board.js';

const BUTTON = {
  hold: { label: '抑止', enabled: true },
  holdNext: { label: '次駅で抑止', enabled: true },
  release: { label: '抑止解除', enabled: true },
  none: { label: '抑止できません', enabled: false },
};

export function createPanel(root, { onHold, onRelease, onClose }) {
  root.innerHTML = `
    <div class="panel-head">
      <span class="panel-chip"></span>
      <span class="panel-pax"></span>
      <span class="panel-delay"></span>
    </div>
    <div class="panel-next"></div>
    <div class="panel-actions">
      <button type="button" class="btn-panel panel-hold"></button>
      <button type="button" class="btn-panel panel-close">閉じる</button>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const chip = $('.panel-chip');
  const pax = $('.panel-pax');
  const delay = $('.panel-delay');
  const next = $('.panel-next');
  const holdBtn = $('.panel-hold');
  let current = null; // 表示中の列車ID
  let action = 'none';

  holdBtn.addEventListener('click', () => {
    if (!current) return;
    if (action === 'release') onRelease(current);
    else if (action === 'hold' || action === 'holdNext') onHold(current);
  });
  $('.panel-close').addEventListener('click', onClose);

  const shown = {};
  const setText = (key, node, text) => {
    if (shown[key] !== text) { node.textContent = text; shown[key] = text; }
  };

  return {
    /** train が null なら閉じる。 */
    update(state, train) {
      const visible = !!train && train.status !== 'done' && train.status !== 'queued';
      root.hidden = !visible;
      root.parentElement.classList.toggle('has-panel', visible);
      current = visible ? train.id : null;
      if (!visible) return;
      const h = `${root.offsetHeight}px`; // チュートリアルの吹き出しを、パネルの上に置くために高さを渡す
      if (root.parentElement.style.getPropertyValue('--panel-h') !== h) root.parentElement.style.setProperty('--panel-h', h);

      chip.className = `panel-chip t-${train.type}`;
      setText('chip', chip, `${TYPE_NAMES[train.type]} ${train.number}`);
      setText('pax', pax, `${train.pax}人`);
      const min = delayMinutes(state, train);
      delay.className = `panel-delay${min >= 1 ? ' late' : ''}`;
      setText('delay', delay, min >= 1 ? `+${min}分` : '定刻');

      const ni = nextStationIndex(state, train);
      if (ni === null) {
        setText('next', next, '終点に到着しました');
      } else {
        const station = state.layout.stations[ni];
        const track = state.layout.resources[train.routes[station.id] ?? plannedTrack(state, train, station)];
        const locked = train.routeLocked[station.id];
        setText('next', next, `次の駅: ${station.name} ／ 進路: ${track.label}${locked ? ' 🔒' : ''}`);
      }

      action = holdAction(state, train);
      setText('hold', holdBtn, BUTTON[action].label);
      holdBtn.disabled = !BUTTON[action].enabled;
      holdBtn.classList.toggle('releasing', action === 'release');
    },
  };
}
