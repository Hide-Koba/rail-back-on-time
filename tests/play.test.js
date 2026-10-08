import test from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/sim/model.js';
import { step } from '../src/sim/simulation.js';
import { holdAction, applyCommand } from '../src/sim/commands.js';
import { nextStationIndex, nextRouteChoice, routeTargetTrain } from '../src/sim/dispatch.js';
import { baselineResult } from '../src/sim/runner.js';
import { loadStars, saveStars } from '../src/storage.js';
import { createTutorial } from '../src/tutorial.js';
import {
  computeBoardLayout, hitTestTrain, hitTestPoint, pointCenter, trackPath, trainCenter, POINT_HIT_PX, TRAIN_HIT_PX,
} from '../src/render/layout.js';
import stage1 from '../src/stages/stage1.js';
import { lineStage, train, near } from './helpers.js';

const run = (state, until) => {
  for (let i = 0; i < 20000 && !until(state); i++) step(state);
  assert.ok(until(state), '条件に到達しなかった');
};
const lineState = (trains) => createState(lineStage({ trains }));

test('抑止ボタンの状態: 状況に合わせて「抑止」「次駅で抑止」「抑止解除」「なし」を切り替える', () => {
  const s = lineState([train('X', 'S', 100, 0, []), train('Q', 'S', 5000, 0, [])]);
  const X = s.trainById.X;
  assert.equal(holdAction(s, s.trainById.Q), 'none', '入線待ち');
  s.timeSec = 100;
  run(s, () => X.status === 'running');
  assert.equal(holdAction(s, X), 'holdNext', '区間を走行中 → 次駅で抑止');
  applyCommand(s, { type: 'hold', trainId: 'X' });
  assert.equal(holdAction(s, X), 'release', '予約中 → 抑止解除');
  run(s, () => X.status === 'dwelling');
  assert.equal(holdAction(s, X), 'release', '抑止中 → 抑止解除');
  applyCommand(s, { type: 'release', trainId: 'X' });
  assert.equal(holdAction(s, X), 'hold', '停車中 → 抑止');
  run(s, () => X.nextStation === 2 && X.resId.startsWith('seg2'));
  assert.equal(holdAction(s, X), 'none', '終点に向かっている');
  run(s, () => X.status === 'turnaround');
  assert.equal(holdAction(s, X), 'none', '終点');
});

test('抑止ボタンの状態: 駅中心の手前を走行中なら「抑止」、中心を過ぎたら次の駅への「次駅で抑止」', () => {
  const s = lineState([train('X', 'S', 100, 0, [])]);
  const X = s.trainById.X;
  s.timeSec = 100;
  run(s, () => X.resId === 'A-1' && X.km > -0.3);
  assert.equal(holdAction(s, X), 'hold');
  run(s, () => X.resId === 'A-1' && X.km > 0.1);
  assert.equal(holdAction(s, X), 'holdNext');
});

test('次の駅: 区間では向かう駅、停車中は次の駅、終点に着いたらなし', () => {
  const s = lineState([train('X', 'L', 100, 0, ['A'])]);
  const X = s.trainById.X;
  s.timeSec = 100;
  run(s, () => X.status === 'running');
  assert.equal(nextStationIndex(s, X), 0);
  run(s, () => X.status === 'dwelling');
  assert.equal(nextStationIndex(s, X), 1, 'A に停車中 → 次は B');
  run(s, () => X.status === 'turnaround');
  assert.equal(nextStationIndex(s, X), null);
});

test('ポイント: 対象は「進路が未確定で最も駅に近い列車」。タップで有効な番線を順に切り替える', () => {
  const s = lineState([train('F', 'L', 100, 0, ['A']), train('G', 'L', 130, 0, ['A'])]);
  s.timeSec = 100;
  const F = s.trainById.F;
  const G = s.trainById.G;
  assert.equal(routeTargetTrain(s, 'A'), null, '入線前の列車は対象にならない');
  run(s, () => G.status === 'running' && !G.routeLocked.A);
  assert.equal(routeTargetTrain(s, 'A').id, F.routeLocked.A ? 'G' : 'F', '駅に近い方');
  const station = s.layout.stations[2]; // 終点 C（3番線ある）: 全部ホームあり
  const t = routeTargetTrain(s, 'C');
  // 有効な番線を順に巡回（計画中の番線の次）
  const a = nextRouteChoice(s, t, station);
  applyCommand(s, { type: 'setRoute', trainId: t.id, stationId: 'C', trackId: a });
  const b = nextRouteChoice(s, t, station);
  assert.notEqual(a, b);
  applyCommand(s, { type: 'setRoute', trainId: t.id, stationId: 'C', trackId: b });
  const c = nextRouteChoice(s, t, station);
  applyCommand(s, { type: 'setRoute', trainId: t.id, stationId: 'C', trackId: c });
  assert.equal(nextRouteChoice(s, t, station), a, '3番線を一周して戻る');
  // 定期停車する駅（A）は、ホームのある副本線の1本だけ → 切り替えても同じ番線
  const tA = routeTargetTrain(s, 'A');
  if (tA) assert.equal(nextRouteChoice(s, tA, s.layout.stations[0]), 'A-2');
});

test('ベースラインはステージごとに1回だけ計算して使い回す', () => {
  const a = baselineResult(stage1);
  const b = baselineResult(stage1);
  assert.equal(a, b);
  assert.ok(a.loss > 0);
  assert.equal(typeof a.finalDelaySec.L801, 'number');
});

// ---- 星の保存 ----
const fakeStorage = (initial = {}) => {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = String(v); } };
};

test('星の保存: 最高の星の数だけを残す', () => {
  const st = fakeStorage();
  assert.deepEqual(loadStars(st), {});
  assert.deepEqual(saveStars('stage1', 2, st), { stage1: 2 });
  assert.deepEqual(saveStars('stage1', 1, st), { stage1: 2 }, '下がらない');
  assert.deepEqual(saveStars('stage1', 3, st), { stage1: 3 });
  assert.deepEqual(saveStars('stage2', 1, st), { stage1: 3, stage2: 1 });
  assert.deepEqual(loadStars(st), { stage1: 3, stage2: 1 });
});

test('星の保存: 壊れた値・読み書きの失敗・localStorage がない環境でも例外を出さない', () => {
  assert.deepEqual(loadStars(fakeStorage({ 'rbot.stars.v1': '{broken' })), {});
  assert.deepEqual(loadStars(fakeStorage({ 'rbot.stars.v1': '{"a":9,"b":"x","c":2,"d":-1}' })), { c: 2 }, '範囲外は捨てる');
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  assert.deepEqual(loadStars(throwing), {});
  assert.deepEqual(saveStars('stage1', 3, throwing), { stage1: 3 }, '保存できなくても、その回の値は返る');
  assert.deepEqual(loadStars(undefined), {});
  assert.deepEqual(saveStars('stage1', 2, undefined), { stage1: 2 });
});

// ---- チュートリアル ----
test('チュートリアル: 表示条件が満たされるまで止めず、表示中は blocking、条件で次へ進む', () => {
  const world = { arrived: false, held: false, passed: false, released: false };
  const tut = createTutorial([
    { id: 'intro', showWhen: () => true, nextWhen: 'tap' },
    { id: 'hold', showWhen: (w) => w.arrived, nextWhen: (w) => w.held },
    { id: 'release', showWhen: (w) => w.passed, nextWhen: (w) => w.released },
    { id: 'point', showWhen: () => true, nextWhen: 'tap' },
  ]);
  tut.update(world);
  assert.equal(tut.step.id, 'intro');
  assert.ok(tut.blocking);
  tut.update(world); // tap 待ちは条件では進まない
  assert.equal(tut.step.id, 'intro');
  tut.tap();
  tut.update(world);
  assert.equal(tut.step, null, '次の表示条件を待っている間は止めない');
  assert.ok(!tut.blocking);
  world.arrived = true;
  tut.update(world);
  assert.equal(tut.step.id, 'hold');
  assert.ok(tut.blocking);
  tut.tap(); // 条件で進むステップはタップでは進まない
  assert.equal(tut.step.id, 'hold');
  world.held = true;
  tut.update(world);
  assert.ok(!tut.blocking, '操作したら再開する');
  world.passed = true;
  tut.update(world);
  assert.equal(tut.step.id, 'release');
  world.released = true;
  tut.update(world); // 解除して次の「ポイント」が表示される
  assert.equal(tut.step.id, 'point');
  tut.tap();
  assert.ok(tut.finished && !tut.blocking);
});

test('チュートリアル: 条件がすでに満たされているステップは、止めずに飛ばす', () => {
  const tut = createTutorial([{ id: 'hold', showWhen: () => true, nextWhen: () => true }]);
  tut.update({});
  assert.ok(tut.finished);
  assert.ok(!tut.blocking);
});

// ---- 当たり判定・経路 ----
test('タップ判定: 列車は中心から24px以内で最も近いもの、ポイントは44×44px以上', () => {
  const s = createState(stage1);
  const geo = computeBoardLayout(s.layout, { width: 375, height: 700 });
  s.timeSec = 10 * 3600;
  run(s, () => s.trainById.L801.status === 'running' && s.trainById.L801.km > -7);
  const L = s.trainById.L801;
  const c = trainCenter(geo, s.layout, L);
  assert.equal(hitTestTrain(geo, s.layout, s.trains, c.x + 10, c.y + 10)?.id, 'L801');
  assert.equal(hitTestTrain(geo, s.layout, s.trains, c.x + TRAIN_HIT_PX + 1, c.y), null, '24pxの外');
  // 近い方を選ぶ（偽の列車を約4px下に置き、タップを L801 側／偽の列車側にずらして確かめる）
  const fake = { ...L, id: 'N', km: L.km + 0.5 };
  assert.equal(hitTestTrain(geo, s.layout, [L, fake], c.x, c.y - 1).id, 'L801');
  assert.equal(hitTestTrain(geo, s.layout, [L, fake], c.x, c.y + 6).id, 'N');

  assert.ok(POINT_HIT_PX >= 44);
  for (const st of geo.stations) {
    const p = pointCenter(geo, st.index);
    assert.equal(hitTestPoint(geo, p.x + 21, p.y - 21), st.index, '44×44の四隅の内側');
    assert.equal(hitTestPoint(geo, p.x + 23, p.y), null);
  }
  // ポイントの領域と、路線上の列車の判定は重ならない
  for (const st of geo.stations) {
    const p = pointCenter(geo, st.index);
    assert.ok(p.x - POINT_HIT_PX / 2 > geo.cx + TRAIN_HIT_PX, '列車の判定円（路線の中央）と重ならない');
  }
});

test('経路: 本線は直線、副本線は入口で斜めに分岐して出口で合流、終点は合流しない', () => {
  const sim = createState(stage1).layout;
  const geo = computeBoardLayout(sim, { width: 375, height: 700 });
  const main = trackPath(geo, sim, sim.resources['aoba-1']);
  assert.ok(!main.includes('NaN'));
  const xs = [...main.matchAll(/[ML] ([\d.]+) /g)].map((m) => +m[1]);
  xs.forEach((x) => near(x, geo.cx, 1e-9, '本線は中央の列'));
  const sub = trackPath(geo, sim, sim.resources['aoba-2']);
  assert.equal((sub.match(/L/g) ?? []).length, 3, '分岐・直進・合流');
  const term = trackPath(geo, sim, sim.resources['minato-2']);
  assert.equal((term.match(/L/g) ?? []).length, 2, '終点は合流しない');
});
