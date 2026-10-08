import test from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/sim/model.js';
import { step } from '../src/sim/simulation.js';
import { applyCommand } from '../src/sim/commands.js';
import { runHeadless } from '../src/sim/runner.js';
import { assertInvariants } from '../src/sim/invariants.js';
import { delayLoss } from '../src/sim/score.js';
import { delaySec } from '../src/sim/timetable.js';
import { CANCEL_DELAY_SEC, PAX, SCHED_SPEED_KMH, RESTART_LOSS_SEC } from '../src/config.js';
import { lineStage, train, near } from './helpers.js';

const run = (state, until) => {
  for (let i = 0; i < 20000 && !until(state); i++) { step(state); assertInvariants(state); }
  assert.ok(until(state), '条件に到達しなかった');
};
const cmd = (type, trainId) => ({ type, trainId });

// ---- 運休 ----
test('運休: 走行中に使うと、次の停車駅の駅中心に着いたところで盤面から消え、番線が空く', () => {
  const s = createState(lineStage({ cards: { cancel: 1 }, trains: [train('L', 'L', 100, 0, ['A', 'B'])] }));
  const L = s.trainById.L;
  s.timeSec = 100;
  run(s, () => L.status === 'running');
  assert.equal(applyCommand(s, cmd('cancel', 'L')), true);
  assert.equal(s.cards.cancel, 0, 'カードが1枚減る');
  assert.equal(L.cancelPending, true);
  assert.equal(L.status, 'running', 'その場では消えない');
  run(s, () => L.status === 'done');
  assert.equal(L.cancelled, true);
  assert.equal(L.resId, null);
  assert.equal(s.occ['A-2'], null, '次の停車駅 A の番線は空く');
  assert.equal(L.nextStation, 0, 'B まで行かない');
  assert.equal(L.finalDelaySec, CANCEL_DELAY_SEC);
  assert.equal(s.notices.at(-1).kind, 'cancelled');
});

test('運休: 遅延損失は「乗客数 × 60分」になる', () => {
  const s = createState(lineStage({ cards: { cancel: 1 }, trains: [train('L', 'L', 100, 0, ['A']), train('S', 'S', 5000, 0, [])] }));
  s.timeSec = 100;
  run(s, () => s.trainById.L.status === 'running');
  applyCommand(s, cmd('cancel', 'L'));
  run(s, () => s.trainById.L.status === 'done');
  // S はまだ入線していないので、遅延損失は L の分だけ（終点遅延が null の S は 0 として数える）
  assert.equal(delayLoss(s), PAX.L * 60);
});

test('運休: 停車中の列車に使うと、その場で消える', () => {
  const s = createState(lineStage({ cards: { cancel: 1 }, trains: [train('L', 'L', 100, 0, ['A'])] }));
  const L = s.trainById.L;
  s.timeSec = 100;
  run(s, () => L.status === 'dwelling');
  assert.equal(applyCommand(s, cmd('cancel', 'L')), true);
  assert.equal(L.status, 'done');
  assert.equal(s.occ['A-2'], null);
});

test('運休: もう停車しない列車は、終点で折り返さずに消え、ホームの空きを早める', () => {
  // 終点は2番線・折り返し600秒。T1・T2 が先に着き、T3 は空きを待つ（M1 の T6 と同じ場面）
  const make = (cards) => lineStage({
    cards, terminalTracks: 2, turnaroundSec: 600,
    trains: [train('T1', 'S', 1000, 0, []), train('T2', 'S', 1100, 0, []), train('T3', 'S', 1200, 0, [])],
  });
  const without = runHeadless(make(undefined));
  assert.ok(without.finalDelaySec.T3 > 400, `運休なし: T3 は待たされる (${without.finalDelaySec.T3})`);

  const withCancel = runHeadless(make({ cancel: 1 }), [
    { when: (s) => s.trainById.T1.status === 'running' && s.trainById.T1.nextStation === 2, command: cmd('cancel', 'T1') },
  ], { onTick: assertInvariants });
  const T1 = withCancel.state.trainById.T1;
  assert.equal(T1.cancelled, true);
  assert.equal(T1.turnaroundEndSec, null, '折り返しをしない');
  assert.ok(withCancel.finalDelaySec.T3 < 30, `T3 はすぐホームに入れる (${withCancel.finalDelaySec.T3})`);
});

test('運休: 使えない場合は false を返し、カードを減らさない', () => {
  const stage = lineStage({ cards: { cancel: 1 }, trains: [train('X', 'S', 100, 0, []), train('Q', 'S', 9000, 0, [])] });
  const s = createState(stage);
  assert.equal(applyCommand(s, cmd('cancel', 'Q')), false, '入線前');
  assert.equal(s.cards.cancel, 1);
  s.timeSec = 100;
  run(s, () => s.trainById.X.status === 'running');
  assert.equal(applyCommand(s, cmd('cancel', 'X')), true);
  assert.equal(applyCommand(s, cmd('cancel', 'X')), false, '予約済み');
  assert.equal(s.cards.cancel, 0);
  assert.equal(applyCommand(s, cmd('cancel', 'nobody')), false);

  const none = createState(lineStage({ trains: [train('X', 'S', 100, 0, [])] }));
  none.timeSec = 100;
  run(none, () => none.trainById.X.status === 'running');
  assert.equal(applyCommand(none, cmd('cancel', 'X')), false, 'カードのないステージ');

  const s2 = createState(lineStage({ cards: { cancel: 2 }, trains: [train('X', 'S', 100, 0, [])] }));
  s2.timeSec = 100;
  run(s2, () => s2.trainById.X.status === 'turnaround');
  assert.equal(applyCommand(s2, cmd('cancel', 'X')), false, '終点に着いた列車');
  assert.equal(s2.cards.cancel, 2);
});

// ---- 折返し短縮 ----
test('折返し短縮: 終点で折り返し中の列車の折り返し時間を半分にし、番線が早く空く', () => {
  const make = (cards) => lineStage({
    cards, terminalTracks: 1, turnaroundSec: 600,
    trains: [train('T1', 'S', 1000, 0, []), train('T2', 'S', 1100, 0, [])],
  });
  const base = runHeadless(make(undefined));
  const r = runHeadless(make({ shorten: 1 }), [
    { when: (s) => s.trainById.T1.status === 'turnaround', command: cmd('shortenTurnaround', 'T1') },
  ]);
  const T1 = r.state.trainById.T1;
  assert.equal(T1.turnaroundShortened, true);
  assert.equal(T1.turnaroundEndSec, T1.arrivedSec + 300);
  // T2 は 300 秒早く入れる
  near(base.finalDelaySec.T2 - r.finalDelaySec.T2, 300, 5, 'T2 の短縮');
});

test('折返し短縮: 使えない場合は false。遅れて使うと、すぐ折り返し終了', () => {
  // T2 は遅れて入線する列車。これがないと、T1 が着いた時点で全列車が到着してゲームが終わる
  const s = createState(lineStage({
    cards: { shorten: 2 }, terminalTracks: 2, turnaroundSec: 600,
    trains: [train('T1', 'S', 1000, 0, []), train('T2', 'S', 5000, 0, [])],
  }));
  const T1 = s.trainById.T1;
  s.timeSec = 1000;
  assert.equal(applyCommand(s, cmd('shortenTurnaround', 'T1')), false, '終点にいない');
  run(s, () => T1.status === 'turnaround');
  for (let i = 0; i < 400; i++) step(s); // 到着から400秒（半分の300秒を過ぎた）
  assert.equal(applyCommand(s, cmd('shortenTurnaround', 'T1')), true);
  assert.equal(T1.turnaroundEndSec, s.timeSec, 'すでに半分を過ぎていれば、いますぐ終わる');
  assert.equal(applyCommand(s, cmd('shortenTurnaround', 'T1')), false, '1本につき1回');
  assert.equal(s.cards.shorten, 1);
  step(s);
  assert.equal(T1.status, 'done');
});

// ---- 速度規制 ----
test('速度規制: 時間帯と範囲の中だけ、規制値との小さい方の速度で走る', () => {
  const trains = [train('X', 'S', 100, 0, [])];
  // 規制区間は 30〜40km（終点の駅中心まで）。区間を出たあとに、遅れを最高速度で取り戻す走行が混ざらない
  const limit = (over = {}) => ({ type: 'speedLimit', label: '雨', fromKm: 30, toKm: 40, kmh: 100, fromSec: 0, toSec: 99999, ...over });
  const arrival = (events) => runHeadless(lineStage({ trains, events })).state.trainById.X.arrivedSec;
  const base = arrival(undefined);

  // 10km を 250.8 → 100km/h で走る分だけ遅れる
  const expected = (10 / 100 - 10 / SCHED_SPEED_KMH) * 3600;
  near(arrival([limit()]) - base, expected, 3, '規制区間の所要時間');
  assert.equal(arrival([limit({ fromSec: 90000, toSec: 99999 })]), base, '時間帯の外');
  assert.equal(arrival([limit({ fromKm: 41, toKm: 50 })]), base, '範囲の外（終点より先）');
  assert.equal(arrival([limit({ kmh: 300 })]), base, '速度より高い規制は効かない');
  // 2つの規制が重なれば、小さい方
  // 速度は1ティックの頭の位置で決まるので、規制区間に入るティックは前の速度で走り切る（50km/h なら最大約5秒の差）
  near(arrival([limit(), limit({ kmh: 50 })]) - base, (10 / 50 - 10 / SCHED_SPEED_KMH) * 3600, 6, '重なる規制');
});

test('速度規制: 遅れて最高速度で走る列車にも規制が効く', () => {
  const trains = [train('X', 'S', 100, 600, [])];
  const ev = [{ type: 'speedLimit', label: '強風', fromKm: 0, toKm: 20, kmh: 200, fromSec: 0, toSec: 99999 }];
  const base = runHeadless(lineStage({ trains })).state.trainById.X.arrivedSec;
  const slow = runHeadless(lineStage({ trains, events: ev })).state.trainById.X.arrivedSec;
  near(slow - base, (20 / 200 - 20 / 285) * 3600, 3);
});

test('速度規制: 開始と終了が、その時刻のティックで通知される', () => {
  const stage = lineStage({
    trains: [train('X', 'S', 100, 0, [])],
    events: [{ type: 'speedLimit', label: '雨', fromKm: 5, toKm: 15, kmh: 100, fromSec: 300, toSec: 600 }],
  });
  const r = runHeadless(stage);
  const kinds = r.state.notices.filter((n) => n.kind.startsWith('limit')).map((n) => `${n.kind}@${n.t}`);
  // 規制は「ティックの頭の時刻が fromSec 以上」から効く。通知は、そのティックの頭の時刻（直前の step が終わった時刻）で出る
  assert.deepEqual(kinds, ['limitStart@300', 'limitEnd@600']);
});

// ---- 車両点検 ----
test('車両点検: 通過のはずの駅で駅中心に止まり、指定の時間たつまで出られない（副本線に入る）', () => {
  const stage = lineStage({
    trains: [train('X', 'S', 100, 0, [])],
    events: [{ type: 'inspection', trainId: 'X', stationId: 'B', durationSec: 480 }],
  });
  const s = createState(stage);
  const X = s.trainById.X;
  s.timeSec = 100;
  run(s, () => X.status === 'dwelling');
  assert.equal(X.resId, 'B-2', '運転停車と同じく、本線以外を選ぶ');
  assert.equal(X.km, 20);
  const arrived = X.arrivedSec;
  assert.equal(X.inspectionUntil, arrived + 480);
  assert.equal(s.notices.at(-1).kind, 'inspection');
  // 点検中は、解除（release）しても出られない。表示の遅延も点検の終了まで数える
  applyCommand(s, cmd('release', 'X'));
  near(delaySec(s, X), arrived + 480 - s.timetable.X.byStation.B.arrSec, 1e-6);
  for (let i = 0; i < 479; i++) step(s);
  assert.equal(X.status, 'dwelling');
  run(s, () => X.status !== 'dwelling');
  assert.ok(s.timeSec - 1 - arrived >= 480);
  run(s, () => X.status === 'turnaround');
  assert.equal(X.inspection.started, true);
});

test('車両点検: その駅に定期停車する列車は、点検の時間も含めて出発する。一度きり', () => {
  const stage = lineStage({
    trains: [train('X', 'L', 100, 0, ['B'])],
    events: [{ type: 'inspection', trainId: 'X', stationId: 'B', durationSec: 600 }],
  });
  let atB = null;
  const r = runHeadless(stage, [], {
    onTick: (s) => {
      const X = s.trainById.X;
      if (X.status === 'dwelling' && atB === null) atB = { arrived: X.arrivedSec, until: X.inspectionUntil, kind: X.dwellKind };
    },
  });
  assert.equal(atB.kind, 'sched');
  assert.equal(atB.until - atB.arrived, 600, '点検の600秒が、最短停車の150秒より長く効く');
  assert.equal(r.state.notices.filter((n) => n.kind === 'inspection').length, 1);
});

test('イベント定義の検証: 不正な速度規制・点検は例外にする', () => {
  const t = [train('X', 'S', 0, 0, [])];
  const ok = { type: 'speedLimit', fromKm: 0, toKm: 10, kmh: 100, fromSec: 0, toSec: 10 };
  assert.doesNotThrow(() => createState(lineStage({ trains: t, events: [ok] })));
  assert.throws(() => createState(lineStage({ trains: t, events: [{ ...ok, kmh: 0 }] })), /速度規制/);
  assert.throws(() => createState(lineStage({ trains: t, events: [{ ...ok, fromKm: 10, toKm: 5 }] })), /速度規制/);
  assert.throws(() => createState(lineStage({ trains: t, events: [{ type: 'inspection', trainId: 'X', stationId: 'C', durationSec: 60 }] })), /点検の駅/);
  assert.throws(() => createState(lineStage({ trains: t, events: [{ type: 'inspection', trainId: 'Y', stationId: 'B', durationSec: 60 }] })), /点検の列車/);
  assert.throws(() => createState(lineStage({ trains: t, events: [{ type: 'rain' }] })), /不明なイベント/);
});

test('決定性: カードとイベントを使っても、同じ操作なら全列車の finalDelaySec が一致する', () => {
  const stage = lineStage({
    cards: { cancel: 1, shorten: 1 }, terminalTracks: 2, turnaroundSec: 600,
    events: [
      { type: 'speedLimit', label: '雨', fromKm: 5, toKm: 15, kmh: 120, fromSec: 1000, toSec: 1500 },
      { type: 'inspection', trainId: 'T2', stationId: 'B', durationSec: 200 },
    ],
    trains: [train('T1', 'S', 1000, 0, []), train('T2', 'S', 1100, 0, []), train('T3', 'L', 1200, 0, ['A', 'B'])],
  });
  const plan = [
    { when: (s) => s.trainById.T3.status === 'running' && s.trainById.T3.nextStation === 1, command: cmd('cancel', 'T3') },
    { when: (s) => s.trainById.T1.status === 'turnaround', command: cmd('shortenTurnaround', 'T1') },
  ];
  const a = runHeadless(stage, plan, { onTick: assertInvariants });
  const b = runHeadless(stage, plan);
  assert.deepEqual(a.finalDelaySec, b.finalDelaySec);
  assert.equal(JSON.stringify(a.state.notices), JSON.stringify(b.state.notices));
  assert.equal(a.state.trainById.T3.cancelled, true);
  assert.equal(a.state.trainById.T1.turnaroundShortened, true);
});
