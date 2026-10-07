import test from 'node:test';
import assert from 'node:assert/strict';
import { framesTicks } from '../src/loop.js';
import { MAX_FRAME_TICKS } from '../src/config.js';

// 60fps で 1 実秒ぶん回したときに進むティックの合計
const simulate = (multiplier, fps = 60, seconds = 1) => {
  let acc = 0;
  let total = 0;
  for (let i = 0; i < fps * seconds; i++) {
    const r = framesTicks(acc, 1 / fps, multiplier);
    acc = r.acc;
    total += r.ticks;
  }
  return total;
};

test('等速は実時間1秒＝ゲーム内20秒、2x は40秒、4x は80秒（端数を持ち越して取りこぼさない）', () => {
  assert.ok(Math.abs(simulate(1) - 20) <= 1);
  assert.ok(Math.abs(simulate(2) - 40) <= 1);
  assert.ok(Math.abs(simulate(4) - 80) <= 1);
  // フレームが遅くても（2fps）合計は同じ
  assert.ok(Math.abs(simulate(1, 2, 10) - 200) <= 1);
});

test('1フレームの上限は 400 ティック。超えた分は切り捨てる', () => {
  const r = framesTicks(0, 600, 4); // 10 分ぶんの経過
  assert.equal(r.ticks, MAX_FRAME_TICKS);
  assert.ok(r.acc < 1);
});

test('経過時間 0 なら進まない', () => {
  assert.deepEqual(framesTicks(0, 0, 1), { ticks: 0, acc: 0 });
});
