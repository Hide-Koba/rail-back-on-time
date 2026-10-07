// プレイヤーのコマンドの適用。SPEC.md §3.10。
// 無効なコマンドは何もせず false を返す（例外は投げない）。
import { validTracks } from './dispatch.js';

export function applyCommand(state, cmd) {
  const train = state.trainById[cmd.trainId];
  if (!train) return false;
  switch (cmd.type) {
    case 'setRoute':
      return setRoute(state, train, cmd.stationId, cmd.trackId);
    case 'hold':
      return hold(state, train);
    case 'release':
      return release(train);
    default:
      return false;
  }
}

function setRoute(state, train, stationId, trackId) {
  const station = state.layout.stations.find((s) => s.id === stationId);
  if (!station) return false;
  if (train.status === 'turnaround' || train.status === 'done') return false;
  if (train.routeLocked[stationId]) return false; // 確定後は変えられない
  if (!validTracks(station, train).some((t) => t.id === trackId)) return false;
  train.routes[stationId] = trackId;
  return true;
}

function hold(state, train) {
  if (train.status === 'queued' || train.status === 'turnaround' || train.status === 'done') return false;
  const { resources, stations } = state.layout;
  const res = resources[train.resId];

  let target; // 抑止を予約する駅の index
  if (res.kind === 'track') {
    const st = stations[res.stationIndex];
    if (st.isTerminal) return false;
    // 停車中、または駅中心の手前を走行中: その場で抑止（通過中なら駅中心で運転停車になる）
    if (train.status === 'dwelling' || train.km < st.km) {
      train.held = true;
      return true;
    }
    // 駅中心を過ぎて出ていく途中の列車は、次の駅に予約する（区間を走っているのと同じ扱い）
    target = res.stationIndex + 1;
  } else {
    target = res.segment;
  }

  const st = stations[target];
  if (!st || st.isTerminal) return false; // 終点に向かっている列車には効かない
  train.holdAt = st.id;
  return true;
}

function release(train) {
  if (train.status === 'queued' || train.status === 'done') return false;
  train.held = false;
  train.holdAt = null;
  return true;
}
