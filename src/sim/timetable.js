// 定刻表の生成と、遅延の計算。
import { SCHED_SPEED_KMH, SCHED_DWELL_SEC, MIN_DWELL_SEC, OP_STOP_MIN_SEC } from '../config.js';

const travelSec = (km) => (km / SCHED_SPEED_KMH) * 3600;

/**
 * 列車ごとの定刻表を作る。
 *   points[]    … 入線点と各駅の「この位置から先はこの時刻が基準」という時刻点（補間用）
 *   byStation   … 駅ID -> { arrSec, depSec, stop }（通過駅は arrSec === depSec）
 *   terminalArrSec … 終点の定刻到着
 */
export function buildTimetable(stage) {
  const result = {};
  for (const def of stage.trains) {
    const schedEntrySec = def.entrySec - (def.initialDelaySec ?? 0);
    const points = [{ stationId: null, km: stage.entryKm, sec: schedEntrySec }];
    const byStation = {};
    let prevKm = stage.entryKm;
    let prevSec = schedEntrySec;
    let terminalArrSec = null;

    for (const st of stage.stations) {
      const arrSec = prevSec + travelSec(st.km - prevKm);
      if (st.isTerminal) {
        byStation[st.id] = { arrSec, depSec: arrSec, stop: true };
        terminalArrSec = arrSec;
        break;
      }
      const stop = def.stops.includes(st.id);
      const depSec = stop ? arrSec + SCHED_DWELL_SEC : arrSec;
      byStation[st.id] = { arrSec, depSec, stop };
      points.push({ stationId: st.id, km: st.km, sec: depSec });
      prevKm = st.km;
      prevSec = depSec;
    }
    result[def.id] = { schedEntrySec, points, byStation, terminalArrSec };
  }
  return result;
}

/** 定刻位置時刻: km の地点を通る定刻の時刻。直前の時刻点から、ダイヤ上の速度で線形補間する。 */
export function schedTimeAtKm(tt, km) {
  let pt = tt.points[0];
  for (const p of tt.points) {
    if (p.km <= km) pt = p;
    else break;
  }
  return pt.sec + travelSec(km - pt.km);
}

/** 画面表示用の遅延（秒）。SPEC.md §3.9。 */
export function delaySec(state, train, now = state.timeSec) {
  const tt = state.timetable[train.id];
  switch (train.status) {
    case 'queued':
      return now - tt.schedEntrySec;
    case 'running':
    case 'signal':
      return now - schedTimeAtKm(tt, train.km);
    case 'dwelling': {
      const stId = state.layout.resources[train.resId].stationId;
      const sched = tt.byStation[stId];
      return train.dwellKind === 'sched'
        ? Math.max(now, train.arrivedSec + MIN_DWELL_SEC) - sched.depSec
        : Math.max(now, train.arrivedSec + OP_STOP_MIN_SEC) - sched.arrSec;
    }
    default: // turnaround / done
      return train.finalDelaySec;
  }
}
