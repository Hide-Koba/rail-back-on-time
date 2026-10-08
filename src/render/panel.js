// 詳細パネル（下部に固定）。列車を選んでいるときだけ表示する。SPEC.md §6.5。
// M4: 指令カード（運休・折返し短縮）のボタンと、車両点検の注記を足した。
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

const ARM_MS = 4000; // 運休は取り消せないので、1回目のタップから、この時間のうちに2回目を押したときだけ実行する

export function createPanel(root, { onHold, onRelease, onClose, onCancel, onShorten }) {
  root.innerHTML = `
    <div class="panel-head">
      <span class="panel-chip"></span>
      <span class="panel-pax"></span>
      <span class="panel-delay"></span>
    </div>
    <div class="panel-next"></div>
    <div class="panel-event" hidden></div>
    <div class="panel-actions">
      <button type="button" class="btn-panel panel-hold"></button>
      <button type="button" class="btn-panel panel-close">閉じる</button>
    </div>
    <div class="panel-cards" hidden>
      <button type="button" class="btn-card card-cancel"></button>
      <button type="button" class="btn-card card-shorten"></button>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const chip = $('.panel-chip');
  const pax = $('.panel-pax');
  const delay = $('.panel-delay');
  const next = $('.panel-next');
  const eventNote = $('.panel-event');
  const holdBtn = $('.panel-hold');
  const cardsRow = $('.panel-cards');
  const cancelBtn = $('.card-cancel');
  const shortenBtn = $('.card-shorten');
  let current = null; // 表示中の列車ID
  let action = 'none';
  let armedFor = null; // 運休の確認待ちの列車ID
  let armTimer = 0;

  const shown = {};
  const setText = (key, node, text) => {
    if (shown[key] !== text) { node.textContent = text; shown[key] = text; }
  };
  // 確認待ちをやめる。ボタンの文言は update が元に戻せるよう、表示キャッシュも捨てる
  const disarm = () => { armedFor = null; clearTimeout(armTimer); cancelBtn.classList.remove('armed'); shown.cancel = null; };

  holdBtn.addEventListener('click', () => {
    if (!current) return;
    if (action === 'release') onRelease(current);
    else if (action === 'hold' || action === 'holdNext') onHold(current);
  });
  $('.panel-close').addEventListener('click', onClose);
  cancelBtn.addEventListener('click', () => {
    if (!current) return;
    if (armedFor === current) {
      disarm();
      onCancel(current);
      return;
    }
    armedFor = current;
    cancelBtn.classList.add('armed');
    cancelBtn.textContent = 'もう一度タップで運休';
    clearTimeout(armTimer);
    armTimer = setTimeout(disarm, ARM_MS);
  });
  shortenBtn.addEventListener('click', () => { if (current) onShorten(current); });

  const inService = (t) => t.status === 'running' || t.status === 'signal' || t.status === 'dwelling';

  return {
    /** train が null なら閉じる。 */
    update(state, train) {
      const visible = !!train && train.status !== 'done' && train.status !== 'queued';
      root.hidden = !visible;
      root.parentElement.classList.toggle('has-panel', visible);
      if (current !== (visible ? train.id : null)) disarm(); // 別の列車を選んだら、運休の確認は取り消す
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
        setText('next', next, train.cancelled ? '運休しました' : '終点に到着しました');
      } else {
        const station = state.layout.stations[ni];
        const track = state.layout.resources[train.routes[station.id] ?? plannedTrack(state, train, station)];
        const locked = train.routeLocked[station.id];
        setText('next', next, `次の駅: ${station.name} ／ 進路: ${track.label}${locked ? ' 🔒' : ''}`);
      }

      // 車両点検の注記
      const ins = train.inspection;
      let note = '';
      if (ins && !ins.started) {
        const st = state.layout.stations.find((s) => s.id === ins.stationId);
        note = `車両点検のため${st.name}で約${Math.round(ins.durationSec / 60)}分、臨時停車します`;
      } else if (ins && (train.inspectionUntil ?? 0) > state.timeSec) {
        note = `車両点検中（あと${Math.ceil((train.inspectionUntil - state.timeSec) / 60)}分）`;
      } else if (train.cancelPending) {
        note = '運休を予約済み: 次に停車する駅で打ち切ります';
      }
      eventNote.hidden = !note;
      setText('event', eventNote, note);

      action = holdAction(state, train);
      setText('hold', holdBtn, BUTTON[action].label);
      holdBtn.disabled = !BUTTON[action].enabled;
      holdBtn.classList.toggle('releasing', action === 'release');

      // 指令カード（ステージにカードがあるときだけ表示）
      const cards = state.stage.cards;
      cardsRow.hidden = !cards || !(cards.cancel > 0 || cards.shorten > 0);
      if (!cardsRow.hidden) {
        cancelBtn.hidden = !(cards.cancel > 0);
        shortenBtn.hidden = !(cards.shorten > 0);
        const canCancel = state.cards.cancel > 0 && inService(train) && !train.cancelPending;
        cancelBtn.disabled = !canCancel;
        if (armedFor !== train.id) {
          setText('cancel', cancelBtn, train.cancelPending ? '運休を予約済み' : `運休（残り${state.cards.cancel}）`);
        }
        const canShorten = state.cards.shorten > 0 && train.status === 'turnaround' && !train.turnaroundShortened;
        shortenBtn.disabled = !canShorten;
        setText('shorten', shortenBtn, train.turnaroundShortened ? '折返し短縮済み' : `折返し短縮（残り${state.cards.shorten}）`);
      }
    },
  };
}
