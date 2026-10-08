// 指令カード（M4）: 運休、折返し短縮。回数はステージごとに state.cards に持つ。
// 乱数は使わない。同じ操作の予定からは必ず同じ結果になる。
import { CANCEL_DELAY_SEC, SHORTEN_TURNAROUND_RATIO } from '../config.js';

/**
 * 運休の列車を盤面から消す。遅延損失は「乗客数 × 60分」になるよう、終点到着遅延を CANCEL_DELAY_SEC とする。
 * 番線を占有していれば解放する（終点なら折り返し時間を待たずに空く）。
 */
export function finalizeCancel(state, train) {
  const res = state.layout.resources[train.resId];
  state.occ[train.resId] = null;
  train.resId = null;
  train.status = 'done';
  train.cancelled = true;
  train.cancelPending = false;
  train.held = false;
  train.holdAt = null;
  train.finalDelaySec = CANCEL_DELAY_SEC;
  state.notices.push({ t: state.timeSec, kind: 'cancelled', trainId: train.id, stationId: res.stationId });
}

/** 運休カード: 次の停車駅で打ち切る。いま停車中ならその場で打ち切る。使えなければ false（カードは減らない）。 */
export function cancelTrain(state, train) {
  if (state.cards.cancel <= 0) return false;
  if (train.status !== 'running' && train.status !== 'signal' && train.status !== 'dwelling') return false;
  if (train.cancelPending) return false;
  state.cards.cancel--;
  if (train.status === 'dwelling') finalizeCancel(state, train);
  else train.cancelPending = true; // 次に停車する駅（定期停車・運転停車・終点）の駅中心に着いたら消える
  return true;
}

/** 折返し短縮カード: 終点で折り返し中の列車の折り返し時間を半分にする（1本につき1回）。 */
export function shortenTurnaround(state, train) {
  if (state.cards.shorten <= 0) return false;
  if (train.status !== 'turnaround' || train.turnaroundShortened) return false;
  const station = state.layout.stations[state.layout.resources[train.resId].stationIndex];
  // 到着から折り返し時間の半分がたった時刻。すでに過ぎていれば、いますぐ折り返し終了
  train.turnaroundEndSec = Math.max(state.timeSec, train.arrivedSec + station.turnaroundSec * SHORTEN_TURNAROUND_RATIO);
  train.turnaroundShortened = true;
  state.cards.shorten--;
  state.notices.push({ t: state.timeSec, kind: 'shortened', trainId: train.id, stationId: station.id });
  return true;
}
