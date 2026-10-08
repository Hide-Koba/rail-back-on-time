// 画面に知らせる出来事（state.notices）の文面と、画面上部の通知（トースト）。
import { TYPE_NAMES } from '../config.js';
import { formatClock } from './hud.js';

const trainName = (state, id) => {
  const t = state.trainById[id];
  return `${TYPE_NAMES[t.type]} ${t.number}`;
};
const stationName = (state, id) => state.layout.stations.find((s) => s.id === id).name;

/** 通知1件の文面。 */
export function noticeText(state, n) {
  const events = state.stage.events ?? [];
  switch (n.kind) {
    case 'limitStart': {
      const ev = events[n.event];
      return `${ev.label}のため速度規制 ${ev.kmh}km/h（${formatClock(ev.fromSec)}〜${formatClock(ev.toSec)}）`;
    }
    case 'limitEnd':
      return `${events[n.event].label}の速度規制を解除しました`;
    case 'inspection': {
      const t = state.trainById[n.trainId];
      return `${trainName(state, n.trainId)}が${stationName(state, n.stationId)}で車両点検のため臨時停車します（約${Math.round(t.inspection.durationSec / 60)}分）`;
    }
    case 'cancelled':
      return `${trainName(state, n.trainId)}を${stationName(state, n.stationId)}で運休にしました`;
    case 'shortened':
      return `${trainName(state, n.trainId)}の折り返しを短縮しました（${stationName(state, n.stationId)}）`;
    default:
      return '';
  }
}

/** 画面上部に、一時的に出す通知。最大3件まで重ねる。 */
export function createToasts(root, { durationMs = 6000 } = {}) {
  return {
    push(text) {
      if (!text) return;
      const el = document.createElement('div');
      el.className = 'toast';
      el.textContent = text;
      root.appendChild(el);
      while (root.children.length > 3) root.firstChild.remove();
      setTimeout(() => el.remove(), durationMs);
    },
    clear() { root.replaceChildren(); },
  };
}
