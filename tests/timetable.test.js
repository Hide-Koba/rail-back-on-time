import test from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/sim/model.js';
import { buildTimetable, delaySec, schedTimeAtKm } from '../src/sim/timetable.js';
import { step } from '../src/sim/simulation.js';
import { MAX_SPEED_KMH, SCHED_SPEED_RATIO, SCHED_DWELL_SEC, MIN_DWELL_SEC, OP_STOP_MIN_SEC } from '../src/config.js';
import stage1 from '../src/stages/stage1.js';
import { near } from './helpers.js';

// 期待値は SPEC.md §3.8 の式から、実装とは別に書き下す
const V = MAX_SPEED_KMH * SCHED_SPEED_RATIO; // 250.8 km/h
const sec = (km) => (km / V) * 3600;

test('T1: 停車駅・通過駅・終点の定刻が §3.8 の式どおり', () => {
  const tt = buildTimetable(stage1);

  // L801: 青葉・白鷺に停車。schedEntrySec = 実入線 10:00:00 − 遅延 8 分
  const L = tt.L801;
  const entry = 10 * 3600 - 8 * 60;
  assert.equal(L.schedEntrySec, entry);
  const aobaArr = entry + sec(10);
  near(L.byStation.aoba.arrSec, aobaArr, 1e-6, '青葉 到着');
  near(L.byStation.aoba.depSec, aobaArr + SCHED_DWELL_SEC, 1e-6, '青葉 発車');
  const shiraArr = aobaArr + SCHED_DWELL_SEC + sec(20);
  near(L.byStation.shirasagi.arrSec, shiraArr, 1e-6, '白鷺 到着');
  near(L.byStation.shirasagi.depSec, shiraArr + SCHED_DWELL_SEC, 1e-6, '白鷺 発車');
  near(L.terminalArrSec, shiraArr + SCHED_DWELL_SEC + sec(20), 1e-6, '港 到着');
  assert.equal(L.byStation.aoba.stop, true);

  // S1: 全駅通過。通過時刻 = 駅中心を通る時刻（到着 = 発車）
  const S = tt.S1;
  const s1Entry = stage1.trains.find((t) => t.id === 'S1').entrySec; // 初期遅延 0 なので、定刻の入線時刻 = 実際の入線時刻
  near(S.byStation.aoba.arrSec, s1Entry + sec(10), 1e-6, 'S1 青葉 通過');
  near(S.byStation.aoba.depSec, s1Entry + sec(10), 1e-6, 'S1 青葉 通過(発)');
  near(S.byStation.shirasagi.arrSec, s1Entry + sec(30), 1e-6, 'S1 白鷺 通過');
  near(S.terminalArrSec, s1Entry + sec(50), 1e-6, 'S1 港 到着');
  assert.equal(S.byStation.aoba.stop, false);
});

test('T1: 定刻位置時刻は直前の時刻点から線形補間する', () => {
  const tt = buildTimetable(stage1).L801;
  const entry = 10 * 3600 - 8 * 60;
  near(schedTimeAtKm(tt, -10), entry, 1e-6);
  near(schedTimeAtKm(tt, -4), entry + sec(6), 1e-6, '入線点から補間');
  // 青葉(停車)を出たあとは、発車時刻から補間
  const aobaDep = entry + sec(10) + SCHED_DWELL_SEC;
  near(schedTimeAtKm(tt, 0), aobaDep, 1e-6, '駅中心は発車時刻');
  near(schedTimeAtKm(tt, 5), aobaDep + sec(5), 1e-6, '発車後の補間');
});

test('T1: 遅延の計算式（状態ごと）', () => {
  const state = createState(stage1);
  const L = state.trainById.L801;

  // queued: now − schedEntrySec
  state.timeSec = 10 * 3600 - 100;
  assert.equal(delaySec(state, L), 8 * 60 - 100);

  // 入線直後の running: 8分遅れで入線するので、約8分遅れ
  state.timeSec = 10 * 3600;
  step(state);
  assert.equal(L.status, 'running');
  near(delaySec(state, L), 8 * 60, 2, '入線直後の遅延');

  // dwelling（定期停車）: max(now, 到着+MIN_DWELL) − 定刻発車
  const tt = state.timetable.L801.byStation.aoba;
  L.status = 'dwelling';
  L.dwellKind = 'sched';
  L.resId = 'aoba-2';
  L.arrivedSec = 40000;
  state.timeSec = 40010;
  near(delaySec(state, L), 40000 + MIN_DWELL_SEC - tt.depSec, 1e-6, '停車中（最短停車の前）');
  state.timeSec = 41000;
  near(delaySec(state, L), 41000 - tt.depSec, 1e-6, '停車中（最短停車のあと）');

  // dwelling（運転停車）: max(now, 到着+OP_STOP_MIN) − 定刻通過
  L.dwellKind = 'op';
  state.timeSec = 40010;
  near(delaySec(state, L), 40000 + OP_STOP_MIN_SEC - tt.arrSec, 1e-6, '運転停車');

  // turnaround / done: finalDelaySec
  L.status = 'turnaround';
  L.finalDelaySec = 123;
  assert.equal(delaySec(state, L), 123);
});
