// 進路（番線の選択）: 有効な番線、自動ルール、確定、ポイントの対象列車。SPEC.md §3.7 / §6.4。

/** その駅に「止まる」列車か（定期停車または終点）。止まる駅ではホームのある番線しか使えない。 */
export function stopsRegularlyAt(train, station) {
  return station.isTerminal || train.stops.includes(station.id);
}

/** 列車がその駅で選べる番線（定義順）。 */
export function validTracks(station, train) {
  return stopsRegularlyAt(train, station)
    ? station.tracks.filter((t) => t.hasPlatform)
    : station.tracks;
}

const isFree = (state, track) => state.occ[track.id] == null;

/** 終点の番線の「折り返しの残り時間」。まだ到着していない列車が入っている番線は、折り返し時間まるごと残っているとみなす。 */
function remainingTurnaroundSec(state, station, track) {
  const occupant = state.trainById[state.occ[track.id]];
  if (!occupant) return 0;
  const end = occupant.turnaroundEndSec ?? state.timeSec + station.turnaroundSec;
  return end - state.timeSec;
}

/** 自動ルール。プレイヤーが指定していないときに、進路確定の時点で使う。 */
export function autoRoute(state, train, station) {
  const mains = station.tracks.filter((t) => t.isMain);
  const subs = station.tracks.filter((t) => !t.isMain);

  if (station.isTerminal) {
    const cands = station.tracks.filter((t) => t.hasPlatform);
    const free = cands.find((t) => isFree(state, t));
    if (free) return free.id;
    let best = cands[0];
    for (const t of cands) {
      // 同じ残り時間なら番線番号（定義順）の小さい方を残す
      if (remainingTurnaroundSec(state, station, t) < remainingTurnaroundSec(state, station, best)) best = t;
    }
    return best.id;
  }

  if (train.stops.includes(station.id)) {
    const cands = [...subs, ...mains].filter((t) => t.hasPlatform);
    return (cands.find((t) => isFree(state, t)) ?? cands[0]).id;
  }

  if (train.holdAt === station.id) {
    const cands = [...subs, ...mains];
    return (cands.find((t) => isFree(state, t)) ?? cands[0]).id;
  }

  const cands = [...mains, ...subs];
  return (cands.find((t) => isFree(state, t)) ?? mains[0] ?? cands[0]).id;
}

/** 進路を確定させる。プレイヤーが指定済みならそれを使い、なければ自動ルール。 */
export function lockRoute(state, train, station) {
  if (train.routeLocked[station.id]) return;
  if (!train.routes[station.id]) train.routes[station.id] = autoRoute(state, train, station);
  train.routeLocked[station.id] = true;
}

/** ポイントの対象列車: その駅へ向かっている列車のうち、進路が未確定で最も駅に近いもの。 */
export function routeTargetTrain(state, stationId) {
  let best = null;
  for (const t of state.trains) {
    if (t.status === 'queued' || t.status === 'turnaround' || t.status === 'done') continue;
    if (t.routeLocked[stationId]) continue;
    if (!best || t.km > best.km) best = t;
  }
  return best;
}

/** その列車が今その駅で使う予定の番線ID（未指定なら、いま自動ルールで決めた場合の番線）。 */
export function plannedTrack(state, train, station) {
  return train.routes[station.id] ?? autoRoute(state, train, station);
}

/** ポイントをタップしたときの次の番線ID（有効な番線の中で順に切り替える）。 */
export function nextRouteChoice(state, train, station) {
  const valid = validTracks(station, train);
  const current = plannedTrack(state, train, station);
  const i = valid.findIndex((t) => t.id === current);
  return valid[(i + 1) % valid.length].id;
}

/** 列車が次に着く（または今向かっている）駅の index。終点に着いたあとなど、次がなければ null。 */
export function nextStationIndex(state, train) {
  if (train.resId == null) return null;
  const { resources, stations } = state.layout;
  const res = resources[train.resId];
  let i;
  if (res.kind === 'block') {
    i = res.segment;
  } else {
    const st = stations[res.stationIndex];
    const reachedCenter = train.status === 'dwelling' || train.status === 'turnaround' || train.km >= st.km;
    i = reachedCenter ? res.stationIndex + 1 : res.stationIndex;
  }
  return i < stations.length ? i : null;
}
