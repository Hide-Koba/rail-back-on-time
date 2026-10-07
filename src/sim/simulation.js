// 1ティックの進行。SPEC.md §3.4〜§3.7, §3.11。
// step() は state を直接書き換えて返す（ゲーム画面は毎フレーム最大400回呼ぶので、コピーしない）。
import {
  DT_SEC,
  MAX_SPEED_KMH,
  SCHED_SPEED_KMH,
  ROUTE_LOCK_KM,
  MIN_DWELL_SEC,
  OP_STOP_MIN_SEC,
  RESTART_LOSS_SEC,
  UNFINISHED_PENALTY_SEC,
} from '../config.js';
import { applyCommand } from './commands.js';
import { lockRoute } from './dispatch.js';
import { delaySec } from './timetable.js';

export function step(state, commands = []) {
  if (state.finished) return state;

  for (const cmd of commands) applyCommand(state, cmd);
  admitQueued(state);

  // 前にいる列車（km が大きい順）から処理する。同じ km なら本線にいる列車が先。
  const active = state.trains.filter((t) => t.status !== 'queued' && t.status !== 'done');
  active.sort(
    (a, b) => b.km - a.km || mainFirst(state, b) - mainFirst(state, a) || (a.id < b.id ? -1 : 1),
  );
  for (const train of active) processTrain(state, train);

  state.timeSec += DT_SEC;
  checkFinished(state);
  return state;
}

const mainFirst = (state, t) => {
  const res = state.layout.resources[t.resId];
  return res.kind === 'track' && res.isMain ? 1 : 0;
};

/** 入線時刻を過ぎて待っている列車を、入線順に、最初のブロックが空いていれば入線させる。 */
function admitQueued(state) {
  const waiting = state.trains
    .filter((t) => t.status === 'queued' && t.entrySec <= state.timeSec)
    .sort((a, b) => a.entrySec - b.entrySec || (a.id < b.id ? -1 : 1));
  const firstBlock = state.layout.segments[0].blockIds[0];
  for (const t of waiting) {
    if (state.occ[firstBlock] != null) break; // 全員が同じブロックへ入るので、ふさがっていれば全員待つ
    state.occ[firstBlock] = t.id;
    t.resId = firstBlock;
    t.km = state.stage.entryKm;
    t.status = 'running';
  }
}

function processTrain(state, train) {
  const now = state.timeSec;

  if (train.status === 'turnaround') {
    if (now >= train.turnaroundEndSec) {
      state.occ[train.resId] = null;
      train.resId = null;
      train.status = 'done';
    }
    return;
  }

  lockRouteIfNear(state, train);

  if (train.status === 'dwelling') {
    if (!canDepart(state, train, now)) return;
    train.status = 'running';
    train.dwellKind = null;
  } else if (train.status === 'signal') {
    // 次のリソースが空いてから RESTART_LOSS_SEC 待つ。待つ間にふさがったらやり直し。
    if (state.occ[nextResourceId(state, train)] != null) {
      train.freeSince = null;
      return;
    }
    if (train.freeSince == null) train.freeSince = now;
    if (now - train.freeSince < RESTART_LOSS_SEC) return;
    train.status = 'running';
    train.freeSince = null;
  }

  // running
  const speedKmh = delaySec(state, train, now) > 0 ? MAX_SPEED_KMH : SCHED_SPEED_KMH;
  advance(state, train, (speedKmh * DT_SEC) / 3600);
}

/** 向かっている駅の上端から ROUTE_LOCK_KM 以内に入ったら、進路を確定させる。 */
function lockRouteIfNear(state, train) {
  const station = state.layout.stations[train.nextStation];
  if (!station || train.routeLocked[station.id]) return;
  if (train.km >= station.upperKm - ROUTE_LOCK_KM) lockRoute(state, train, station);
}

function canDepart(state, train, now) {
  if (train.held) return false;
  if (train.dwellKind === 'sched') {
    const stId = state.layout.resources[train.resId].stationId;
    if (now - train.arrivedSec < MIN_DWELL_SEC) return false;
    if (now < state.timetable[train.id].byStation[stId].depSec) return false; // 早発しない
  } else if (now - train.arrivedSec < OP_STOP_MIN_SEC) {
    return false;
  }
  return state.occ[nextResourceId(state, train)] == null;
}

/** 列車が次に入るリソースのID。終点の番線から先はない（null）。 */
function nextResourceId(state, train) {
  const { resources, segments, stations } = state.layout;
  const res = resources[train.resId];
  if (res.kind === 'block') {
    const seg = segments[res.segment];
    if (res.blockIndex < seg.blockIds.length - 1) return seg.blockIds[res.blockIndex + 1];
    const station = stations[res.segment];
    lockRoute(state, train, station); // 通常は確定済み。念のため
    return train.routes[station.id];
  }
  const station = stations[res.stationIndex];
  return station.isTerminal ? null : segments[station.index + 1].blockIds[0];
}

/** この駅の番線で、駅中心で止まるか（定期停車・終点・抑止中）。 */
function stopsAt(train, station) {
  return station.isTerminal || train.stops.includes(station.id) || train.held;
}

/** dKm だけ進める。リソースの境界では、空いていれば入って余りを進め、ふさがっていれば止まる。 */
function advance(state, train, dKm) {
  const { resources, stations } = state.layout;
  const tEnd = state.timeSec + DT_SEC; // このティックの終わりの時刻

  for (;;) {
    const res = resources[train.resId];
    let limit = res.endKm;
    let stopPoint = false;
    let station = null;
    if (res.kind === 'track') {
      station = stations[res.stationIndex];
      if (train.km < station.km && stopsAt(train, station)) {
        limit = station.km;
        stopPoint = true;
      }
    }

    const room = limit - train.km;
    if (dKm < room) {
      train.km += dKm;
      return;
    }
    train.km = limit;
    dKm -= room;

    if (stopPoint) {
      arrive(state, train, station, tEnd);
      return;
    }

    const nextId = nextResourceId(state, train);
    if (state.occ[nextId] != null) {
      train.status = 'signal';
      train.freeSince = null;
      return;
    }
    enter(state, train, nextId);
  }
}

function enter(state, train, nextId) {
  const { resources } = state.layout;
  const cur = resources[train.resId];
  const next = resources[nextId];
  state.occ[cur.id] = null;
  state.occ[next.id] = train.id;
  train.resId = next.id;
  train.km = next.startKm;
  if (cur.kind === 'track') train.nextStation = cur.stationIndex + 1;
  if (next.kind === 'track' && train.holdAt === next.stationId) {
    // 抑止予約のある駅に入った: 駅中心で止まって抑止状態になる
    train.held = true;
    train.holdAt = null;
  }
}

function arrive(state, train, station, tEnd) {
  train.arrivedSec = tEnd;
  if (station.isTerminal) {
    train.status = 'turnaround';
    train.held = false;
    train.holdAt = null;
    train.finalDelaySec = tEnd - state.timetable[train.id].terminalArrSec;
    train.turnaroundEndSec = tEnd + station.turnaroundSec;
  } else {
    train.status = 'dwelling';
    train.dwellKind = train.stops.includes(station.id) ? 'sched' : 'op';
  }
}

function checkFinished(state) {
  const allArrived = state.trains.every((t) => t.status === 'turnaround' || t.status === 'done');
  if (allArrived) {
    state.finished = true;
    state.endReason = 'completed';
    return;
  }
  if (state.timeSec - state.startClockSec > state.stage.maxDurationSec) {
    for (const t of state.trains) {
      if (t.status === 'turnaround' || t.status === 'done') continue;
      t.finalDelaySec = delaySec(state, t) + UNFINISHED_PENALTY_SEC;
      t.unfinished = true;
    }
    state.finished = true;
    state.endReason = 'timeout';
  }
}
