import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, buildLayout } from '../src/sim/model.js';
import { step } from '../src/sim/simulation.js';
import { runHeadless } from '../src/sim/runner.js';
import { checkInvariants, assertInvariants } from '../src/sim/invariants.js';
import { RESTART_LOSS_SEC, MIN_DWELL_SEC, UNFINISHED_PENALTY_SEC } from '../src/config.js';
import stage1 from '../src/stages/stage1.js';
import stage2 from '../src/stages/stage2.js';
import { lineStage, train, near } from './helpers.js';
import { applyCommand as applyCommandDirect } from '../src/sim/commands.js';

const hold = (trainId) => ({ type: 'hold', trainId });
const release = (trainId) => ({ type: 'release', trainId });

test('ブロック分割: 区間を ceil(長さ/3km) 個に均等に割る', () => {
  const count = (stage) => buildLayout(stage).segments.map((s) => s.blockIds.length);
  assert.deepEqual(count(stage1), [4, 7, 7]); // 9.5 / 19 / 19 km
  assert.deepEqual(count(stage2), [5, 12, 11, 13]); // 14.5 / 34 / 32 / 38 km

  const { resources, segments } = buildLayout(stage1);
  for (const seg of segments) {
    const blocks = seg.blockIds.map((id) => resources[id]);
    assert.equal(blocks[0].startKm, seg.startKm);
    assert.equal(blocks.at(-1).endKm, seg.endKm);
    const len = blocks[0].endKm - blocks[0].startKm;
    blocks.forEach((b, i) => {
      near(b.endKm - b.startKm, len, 1e-9, '均等');
      if (i > 0) assert.equal(b.startKm, blocks[i - 1].endKm); // 隙間も重なりもない
    });
  }
});

test('T2: ステージ1・2をベースラインで最後まで実行し、全ティックで不変条件が通る', () => {
  for (const stage of [stage1, stage2]) {
    let ticks = 0;
    const r = runHeadless(stage, [], { onTick: (s) => { assertInvariants(s); ticks++; } });
    assert.equal(r.endReason, 'completed', stage.id);
    assert.ok(ticks > 100, stage.id);
  }
});

test('T2: 不変条件の検査は、2本が同じリソースにいる状態を検出する', () => {
  const state = createState(stage1);
  step(state);
  state.timeSec = 10 * 3600 + 90;
  for (let i = 0; i < 200; i++) step(state);
  const [a, b] = state.trains.filter((t) => t.resId);
  assert.ok(a && b, '走行中の列車が2本以上いること');
  assert.deepEqual(checkInvariants(state), []);
  b.resId = a.resId; // わざと壊す
  assert.ok(checkInvariants(state).length > 0);
  assert.throws(() => assertInvariants(state), /不変条件/);
});

test('T3: 同じステージ・同じ操作なら、全列車の finalDelaySec が完全に一致する', () => {
  // ステージ2: 各停すべてを湖南で抑止し、後続の速達が2本通ったら解除する（簡単な操作の例）
  const schedule = [];
  for (const t of stage2.trains.filter((t) => t.type === 'L')) {
    schedule.push({ atSec: 18 * 3600 + 15 * 60, command: hold(t.id) });
    schedule.push({ atSec: 19 * 3600, command: release(t.id) });
  }
  schedule.push({ when: (s) => s.timeSec > 18 * 3600 + 1200, command: hold('S42') });
  schedule.push({ atSec: 19 * 3600 + 600, command: release('S42') });

  const a = runHeadless(stage2, schedule);
  const b = runHeadless(stage2, schedule);
  assert.deepEqual(a.finalDelaySec, b.finalDelaySec);
  assert.equal(a.endSec, b.endSec);
  assert.equal(JSON.stringify(a.state.trains), JSON.stringify(b.state.trains));
  // 操作が結果に反映されていること（何もしないのと同じ結果になっていない）
  assert.notDeepEqual(a.finalDelaySec, runHeadless(stage2).finalDelaySec);
});

test('T4: 各停が待避駅の副本線で抑止されている間に、後ろの速達が本線を通過して前に出る', () => {
  // L は B に停車（B-2 に入る）。S は 220 秒遅れて入線し、L が自然に発車したあとの B を通る。
  const stage = lineStage({
    trains: [train('L', 'L', 1000, 0, ['B']), train('S', 'S', 1220, 0, [])],
  });
  const schedule = [
    { when: (s) => s.trainById.L.status === 'dwelling', command: hold('L') },
    { when: (s) => s.trainById.S.km > 20.5, command: release('L') }, // S が B を出たら解除
  ];

  let overtook = false;
  let sOnMain = false;
  let sDelayWhileHeld = null;
  const r = runHeadless(stage, schedule, {
    onTick: (s) => {
      const L = s.trainById.L;
      const S = s.trainById.S;
      if (L.status === 'dwelling' && L.held && S.km > L.km) overtook = true;
      if (S.resId === 'B-1') sOnMain = true;
    },
  });
  assert.ok(sOnMain, 'S は B の本線(B-1)を通る');
  assert.ok(overtook, 'L が B で抑止されている間に S が L の前に出る');

  // 抑止なしでは S が L につかえる。抑止すると S は定刻通りに着き、L は遅れる。
  const base = runHeadless(stage);
  assert.ok(base.finalDelaySec.S > 30, `抑止なしの S は遅れる (${base.finalDelaySec.S})`);
  assert.ok(r.finalDelaySec.S < 5, `抑止ありの S はほぼ定刻 (${r.finalDelaySec.S})`);
  assert.ok(r.finalDelaySec.L > base.finalDelaySec.L, 'そのぶん L は遅れる（トレードオフ）');
  assert.ok(r.state.trainById.S.arrivedSec < r.state.trainById.L.arrivedSec, '終点にも S が先に着く');
});

test('T5: 定刻より早く着いた定期停車の列車は、定刻の発車時刻まで発車しない', () => {
  // E は 600 秒早い（initialDelaySec = -600）。ダイヤ上の B 発車は、実際の到着より約 10 分あと。
  const stage = lineStage({ trains: [train('E', 'L', 1000, -600, ['B'])] });
  const schedDep = createState(stage).timetable.E.byStation.B.depSec;

  let arrivedAt = null;
  let departedAt = null; // dwelling → running になったティックの開始時刻
  let prev = 'queued';
  runHeadless(stage, [], {
    onTick: (s) => {
      const E = s.trainById.E;
      if (E.status === 'dwelling' && arrivedAt === null) arrivedAt = E.arrivedSec;
      if (prev === 'dwelling' && E.status !== 'dwelling' && departedAt === null) departedAt = s.timeSec - 1;
      prev = E.status;
    },
  });
  assert.ok(schedDep - arrivedAt > 500, `早着していること (到着 ${arrivedAt} / 定刻発車 ${schedDep})`);
  assert.ok(departedAt >= schedDep, `定刻の発車時刻 ${schedDep} より前に発車した: ${departedAt}`);
  assert.ok(departedAt < schedDep + 1, `定刻になったらすぐ発車する: ${departedAt}`);
});

test('T5: 遅れている列車は、最短停車時間（150秒）で発車する', () => {
  const stage = lineStage({ trains: [train('D', 'L', 1000, 600, ['B'])] });
  let arrivedAt = null;
  let departedAt = null;
  let prev = 'queued';
  runHeadless(stage, [], {
    onTick: (s) => {
      const D = s.trainById.D;
      if (D.status === 'dwelling' && arrivedAt === null) arrivedAt = D.arrivedSec;
      if (prev === 'dwelling' && D.status !== 'dwelling' && departedAt === null) departedAt = s.timeSec - 1;
      prev = D.status;
    },
  });
  assert.equal(departedAt - arrivedAt, MIN_DWELL_SEC);
});

test('T6: 終点の番線がすべて turnaround のとき、次の列車は手前のブロックで signal になり、ホームが空いたら入る', () => {
  // 終点は2番線・折り返し600秒。3本が100秒おきに着く（定刻運転）。
  const stage = lineStage({
    terminalTracks: 2,
    turnaroundSec: 600,
    trains: [
      train('T1', 'S', 1000, 0, []),
      train('T2', 'S', 1100, 0, []),
      train('T3', 'S', 1200, 0, []),
    ],
  });

  let waitingSeen = false;
  let t3EnteredAt = null;
  let t1FreedAt = null;
  const lastSeg = buildLayout(stage).segments.at(-1);
  const r = runHeadless(stage, [], {
    onTick: (s) => {
      const [T1, T2, T3] = ['T1', 'T2', 'T3'].map((id) => s.trainById[id]);
      const bothFull = T1.status === 'turnaround' && T2.status === 'turnaround';
      if (bothFull && T3.status === 'signal') {
        waitingSeen = true;
        assert.equal(T3.resId, lastSeg.blockIds.at(-1), 'T3 は終点手前の最後のブロックで待つ');
      }
      if (T1.status === 'done' && t1FreedAt === null) t1FreedAt = s.timeSec;
      if (T3.resId?.startsWith('C-') && t3EnteredAt === null) t3EnteredAt = s.timeSec;
    },
  });
  assert.ok(waitingSeen, 'T3 が signal で待つ瞬間がある');
  assert.ok(t3EnteredAt !== null, 'T3 はホームが空いたら入る');
  const T1 = r.state.trainById.T1;
  const freed = T1.turnaroundEndSec;
  assert.ok(t3EnteredAt >= freed + RESTART_LOSS_SEC, `空いてから再発車ロス(${RESTART_LOSS_SEC}秒)のあとに入る: ${t3EnteredAt} vs ${freed}`);
  assert.ok(t3EnteredAt <= freed + RESTART_LOSS_SEC + 20, `空いたら間もなく入る: ${t3EnteredAt} vs ${freed}`);
  assert.equal(r.endReason, 'completed');
  // T3 の遅れ = 空くまでの待ち + 再発車ロス + 番線内を走る数秒
  const T3sched = r.state.timetable.T3.terminalArrSec;
  const expected = freed - T3sched + RESTART_LOSS_SEC;
  assert.ok(
    r.finalDelaySec.T3 >= expected && r.finalDelaySec.T3 <= expected + 20,
    `T3 の遅れ ${r.finalDelaySec.T3} が ${expected}〜${expected + 20} の範囲外`,
  );
});

test('打ち切り: maxDurationSec を超えたら終了し、未到着の列車に +600 秒を加える', () => {
  const stage = lineStage({ maxDurationSec: 300, trains: [train('X', 'S', 100, 0, [])] });
  const r = runHeadless(stage);
  assert.equal(r.endReason, 'timeout');
  const X = r.state.trainById.X;
  assert.equal(X.unfinished, true);
  assert.ok(X.finalDelaySec >= UNFINISHED_PENALTY_SEC - 30 && X.finalDelaySec <= UNFINISHED_PENALTY_SEC + 30);
});

test('ステージ定義の検証: 開始時刻より前の入線・不正な停車駅・終点の指定ミスは例外にする', () => {
  const ok = [train('X', 'S', 0, 0, [])];
  assert.doesNotThrow(() => createState(lineStage({ trains: ok })));
  assert.throws(() => createState({ ...lineStage({ trains: ok }), startClockSec: 100 }), /開始時刻/);
  assert.throws(() => createState(lineStage({ trains: [train('X', 'S', 0, 0, ['C'])] })), /停車駅/);
  assert.throws(() => createState(lineStage({ trains: [train('X', 'S', 0, 0, ['Z'])] })), /停車駅/);
  assert.throws(() => createState(lineStage({ trains: [train('X', 'S', 0, 0, []), train('X', 'S', 9, 0, [])] })), /重複/);
  const noTerminal = lineStage({ trains: ok });
  delete noTerminal.stations[2].isTerminal;
  assert.throws(() => createState(noTerminal), /終点/);
});

test('入線: 最初のブロックがふさがっていれば待機列に残る', () => {
  // 同時刻に入線する2本は、ID順に1本ずつ入る
  const stage = lineStage({ trains: [train('B2', 'S', 500, 0, []), train('B1', 'S', 500, 0, [])] });
  const s = createState(stage);
  s.timeSec = 500;
  step(s);
  assert.equal(s.trainById.B1.status, 'running');
  assert.equal(s.trainById.B2.status, 'queued');
  for (let i = 0; i < 60; i++) step(s);
  assert.notEqual(s.trainById.B2.status, 'queued');
  assert.ok(s.trainById.B2.finalDelaySec === null); // まだ終点には着いていない
  assert.deepEqual(checkInvariants(s), []);
});

// ---- コマンドと進路（SPEC.md §3.7 / §3.10。T7 の内容を含む） ----

const run = (state, until) => {
  for (let i = 0; i < 20000 && !until(state); i++) step(state);
  assert.ok(until(state), '条件に到達しなかった');
};
const send = (state, cmd) => step(state, [cmd]);
const lineState = (trains, extra = {}) => createState(lineStage({ trains, ...extra }));

test('T7: 進路は km が駅の上端から 2.0km 以内に入ったときに確定する', () => {
  const s = lineState([train('X', 'S', 100, 0, [])]);
  const X = s.trainById.X;
  s.timeSec = 100;
  // A の上端は -0.5km。進路の確定はティックの頭（移動前）の km で判定する。
  // 移動前の km が -2.5 未満なら未確定のまま、-2.5 以上になった最初のティックで確定する。
  let locked = false;
  for (let i = 0; i < 5000 && !locked; i++) {
    const before = X.status === 'queued' ? -Infinity : X.km;
    step(s);
    locked = !!X.routeLocked.A;
    if (before >= -2.5) assert.ok(locked, `移動前 km=${before} で確定していない`);
    else assert.ok(!locked, `移動前 km=${before} (< -2.5) なのに確定した`);
  }
  assert.ok(locked);
});

test('T7: 確定後の setRoute は無視される', () => {
  const s = lineState([train('X', 'S', 100, 0, [])]);
  const X = s.trainById.X;
  s.timeSec = 100;
  run(s, (st) => X.routeLocked.A);
  assert.equal(X.routes.A, 'A-1'); // 通過列車の自動ルール: 空いていれば本線
  step(s, [{ type: 'setRoute', trainId: 'X', stationId: 'A', trackId: 'A-2' }]);
  assert.equal(X.routes.A, 'A-1');
  run(s, () => X.resId === 'A-1' || X.resId === 'A-2');
  assert.equal(X.resId, 'A-1', '確定済みの進路で入る');
});

test('T7: 定期停車する駅で、ホームのない番線を指定しても無視される', () => {
  const s = lineState([train('L', 'L', 100, 0, ['A', 'B'])]);
  const L = s.trainById.L;
  // 入線前でも指定できる。ホームのない A-1 は無効、A-2 は有効
  assert.equal(applyAndReturn(s, { type: 'setRoute', trainId: 'L', stationId: 'A', trackId: 'A-1' }), false);
  assert.equal(L.routes.A, undefined);
  assert.equal(applyAndReturn(s, { type: 'setRoute', trainId: 'L', stationId: 'A', trackId: 'A-2' }), true);
  assert.equal(L.routes.A, 'A-2');
  // 存在しない番線・別の駅の番線・存在しない列車/駅
  assert.equal(applyAndReturn(s, { type: 'setRoute', trainId: 'L', stationId: 'A', trackId: 'B-2' }), false);
  assert.equal(applyAndReturn(s, { type: 'setRoute', trainId: 'L', stationId: 'A', trackId: 'zzz' }), false);
  assert.equal(applyAndReturn(s, { type: 'setRoute', trainId: 'nobody', stationId: 'A', trackId: 'A-2' }), false);
  assert.equal(applyAndReturn(s, { type: 'setRoute', trainId: 'L', stationId: 'ZZ', trackId: 'A-2' }), false);
});

test('T7: 通過する駅ではホームのない番線も選べる。指定した進路は自動ルールより優先される', () => {
  const s = lineState([train('X', 'S', 100, 0, [])]);
  assert.equal(applyAndReturn(s, { type: 'setRoute', trainId: 'X', stationId: 'A', trackId: 'A-2' }), true);
  s.timeSec = 100;
  run(s, (st) => s.trainById.X.resId === 'A-2' || s.trainById.X.resId === 'A-1');
  assert.equal(s.trainById.X.resId, 'A-2');
});

test('自動ルール: 停車は副本線→本線の順、通過は本線優先、終点は番線の小さい順', () => {
  const s = lineState([train('L', 'L', 100, 0, ['A']), train('X', 'S', 400, 0, [])]);
  s.timeSec = 100;
  const L = s.trainById.L;
  run(s, () => L.routeLocked.A);
  assert.equal(L.routes.A, 'A-2'); // 停車: ホームのある副本線
  run(s, () => L.routeLocked.C);
  assert.equal(L.routes.C, 'C-1'); // 終点: 空いている最小番号

  // 本線がふさがっているとき、通過列車は空いている他の番線を選ぶ（本線を持つ別の列車を置く）
  const s2 = lineState([train('X', 'S', 100, 0, [])]);
  s2.occ['A-1'] = 'dummy';
  s2.timeSec = 100;
  run(s2, () => s2.trainById.X.routeLocked.A);
  assert.equal(s2.trainById.X.routes.A, 'A-2');
  // 全部ふさがっていれば本線
  const s3 = lineState([train('X', 'S', 100, 0, [])]);
  s3.occ['A-1'] = 'dummy';
  s3.occ['A-2'] = 'dummy';
  s3.timeSec = 100;
  run(s3, () => s3.trainById.X.routeLocked.A);
  assert.equal(s3.trainById.X.routes.A, 'A-1');
});

test('hold: 区間を走行中なら次の駅に予約し、その駅の番線に入ると駅中心で止まる（運転停車）', () => {
  const s = lineState([train('X', 'S', 100, 0, [])]);
  const X = s.trainById.X;
  s.timeSec = 100;
  run(s, () => X.status === 'running');
  send(s, hold('X'));
  assert.equal(X.holdAt, 'A');
  assert.equal(X.held, false);
  // 予約は進路確定にも効く（運転停車のルール: 本線以外→本線）
  run(s, () => X.status === 'dwelling');
  assert.equal(X.resId, 'A-2');
  assert.equal(X.held, true);
  assert.equal(X.holdAt, null);
  assert.equal(X.dwellKind, 'op');
  assert.equal(X.km, 0, '駅中心で止まる');
  // 抑止中は 90 秒たっても発車しない。解除すると（最短90秒を満たしていれば）すぐ発車
  const arrived = X.arrivedSec;
  run(s, () => s.timeSec >= arrived + 300);
  assert.equal(X.status, 'dwelling');
  send(s, release('X'));
  assert.equal(X.held, false);
  assert.notEqual(X.status, 'dwelling');
  assert.deepEqual(checkInvariants(s), []);
});

test('hold: 運転停車は到着から 90 秒で発車できる（解除済みなら）', () => {
  const s = lineState([train('X', 'S', 100, 0, [])]);
  const X = s.trainById.X;
  s.timeSec = 100;
  run(s, () => X.status === 'running');
  send(s, hold('X'));
  run(s, () => X.status === 'dwelling');
  const arrived = X.arrivedSec;
  send(s, release('X')); // 到着直後に解除
  run(s, () => X.status !== 'dwelling');
  assert.equal(s.timeSec - 1 - arrived, 90); // OP_STOP_MIN_SEC
});

test('hold: 本線を通過中の列車に hold すると、駅中心で止まって運転停車になる', () => {
  const s = lineState([train('X', 'S', 100, 0, [])]);
  const X = s.trainById.X;
  s.timeSec = 100;
  run(s, () => X.resId === 'A-1' && X.km > -0.4);
  send(s, hold('X'));
  assert.equal(X.held, true);
  run(s, () => X.status === 'dwelling');
  assert.equal(X.resId, 'A-1');
  assert.equal(X.km, 0);
  assert.equal(X.dwellKind, 'op');
});

test('hold: 通過中でも駅中心を過ぎていれば、次の駅への予約になる', () => {
  const s = lineState([train('X', 'S', 100, 0, [])]);
  const X = s.trainById.X;
  s.timeSec = 100;
  run(s, () => X.resId === 'A-1' && X.km > 0.1);
  send(s, hold('X'));
  assert.equal(X.held, false);
  assert.equal(X.holdAt, 'B');
});

test('hold: queued・終点に向かっている列車・終点では無視される', () => {
  const s = lineState([train('X', 'S', 100, 0, [])]);
  const X = s.trainById.X;
  assert.equal(applyAndReturn(s, hold('X')), false); // queued
  s.timeSec = 100;
  run(s, () => X.resId?.startsWith('B-') || X.nextStation === 2);
  run(s, () => X.nextStation === 2 && X.resId.startsWith('seg2'));
  assert.equal(applyAndReturn(s, hold('X')), false); // 終点に向かっている
  assert.equal(X.holdAt, null);
  run(s, () => X.status === 'turnaround');
  assert.equal(applyAndReturn(s, hold('X')), false); // 終点
  assert.equal(X.held, false);
});

test('release: 予約も取り消す。発車前に解除すれば通過する', () => {
  const s = lineState([train('X', 'S', 100, 0, [])]);
  const X = s.trainById.X;
  s.timeSec = 100;
  run(s, () => X.status === 'running');
  send(s, hold('X'));
  send(s, release('X'));
  assert.equal(X.holdAt, null);
  run(s, () => X.resId === 'A-1' && X.km > 0.1);
  assert.equal(X.status, 'running'); // 止まらずに通過した
});

test('signal: 進路が確定した番線がふさがっていると境界で止まり、空いてから 45 秒後に再発車する', () => {
  // X は B の本線(B-1)で運転停車。Y も B-1 を指定して後ろから来る → B 手前の最後のブロックで signal になる。
  const s = lineState([train('X', 'S', 100, 0, []), train('Y', 'S', 220, 0, [])]);
  const X = s.trainById.X;
  const Y = s.trainById.Y;
  s.timeSec = 100;
  step(s, [
    { type: 'setRoute', trainId: 'X', stationId: 'B', trackId: 'B-1' },
    { type: 'setRoute', trainId: 'Y', stationId: 'B', trackId: 'B-1' },
  ]);
  // hold は「次の駅」に予約する。B で止めたいので、A を出て B へ向かう区間に入ってから送る
  run(s, () => X.nextStation === 1 && s.layout.resources[X.resId].kind === 'block');
  send(s, hold('X'));
  assert.equal(X.holdAt, 'B');
  run(s, () => X.status === 'dwelling' && X.resId === 'B-1');
  const lastBlockOfSeg1 = s.layout.segments[1].blockIds.at(-1);
  run(s, () => Y.status === 'signal');
  assert.equal(Y.resId, lastBlockOfSeg1, 'B 手前の最後のブロックで止まる');
  assert.equal(Y.km, s.layout.resources[lastBlockOfSeg1].endKm, 'ブロックの端で止まる');

  // 抑止中は何ティック待っても signal のまま
  for (let i = 0; i < 200; i++) step(s);
  assert.equal(Y.status, 'signal');

  // X を解除。B-1 が空いたティック(freedAt)から、Y が signal を抜けるまでの時間を測る
  send(s, release('X'));
  let freedAt = null;
  let restartedAt = null;
  for (let i = 0; i < 1000 && restartedAt === null; i++) {
    step(s);
    assert.deepEqual(checkInvariants(s), []);
    if (freedAt === null && s.occ['B-1'] === null) freedAt = s.timeSec;
    if (freedAt !== null && Y.status !== 'signal') restartedAt = s.timeSec;
  }
  assert.ok(freedAt !== null && restartedAt !== null);
  assert.equal(restartedAt - freedAt, RESTART_LOSS_SEC);
});

function applyAndReturn(state, cmd) {
  // step の中で applyCommand が呼ばれるが、戻り値が欲しいので直接呼ぶ
  return applyCommandDirect(state, cmd);
}
