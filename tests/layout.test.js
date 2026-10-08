import test from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/sim/model.js';
import { step } from '../src/sim/simulation.js';
import {
  computeBoardLayout, trainPosition, trackOffsets, STATION_BOX_PX, MIN_BLOCK_PX,
} from '../src/render/layout.js';
import stage1 from '../src/stages/stage1.js';
import stage2 from '../src/stages/stage2.js';
import { near } from './helpers.js';

test('番線の並び: 本線が中央、副本線は左右に交互。本線がなければ左右対称', () => {
  const dx = trackOffsets(stage2.stations[0].tracks, 30); // 11(本線) / 12 / 13
  assert.deepEqual([dx['kodo-11'], dx['kodo-12'], dx['kodo-13']], [0, -30, 30]);
  const t = trackOffsets(stage2.stations[3].tracks, 30); // 浪速: 本線なし 4番線
  assert.deepEqual(Object.values(t), [-45, -15, 15, 45]);
  const five = trackOffsets([
    { id: 'm', isMain: true }, { id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' },
  ], 10);
  assert.deepEqual(five, { m: 0, a: -10, b: 10, c: -20, d: 20 });
});

test('1ブロックは 18px 未満にならない。ステージ1は画面に収まり、ステージ2は縦スクロールになる', () => {
  for (const stage of [stage1, stage2]) {
    const sim = createState(stage).layout;
    const geo = computeBoardLayout(sim, { width: 375, height: 700 });
    for (const seg of sim.segments) {
      for (const id of seg.blockIds) {
        const b = sim.resources[id];
        assert.ok((b.endKm - b.startKm) * geo.pxPerKm >= MIN_BLOCK_PX - 1e-9, `${stage.id} ${id}`);
      }
    }
    // 駅の箱は固定の高さ
    geo.stations.forEach((s) => near(s.boxBottom - s.boxTop, STATION_BOX_PX));
  }
  const g1 = computeBoardLayout(createState(stage1).layout, { width: 375, height: 700 });
  const g2 = computeBoardLayout(createState(stage2).layout, { width: 375, height: 700 });
  assert.ok(g1.height <= 700 + 1e-6, `ステージ1は収まる: ${g1.height}`);
  assert.ok(g2.height > 700, `ステージ2は収まらない: ${g2.height}`);
});

test('列車の座標は、ブロック→番線→ブロックの境目で途切れずにつながる', () => {
  const sim = createState(stage1).layout;
  const geo = computeBoardLayout(sim, { width: 375, height: 700 });
  const st = geo.stations[0];
  const track = sim.resources['aoba-2'];
  const fakeTrain = (resId, km) => ({ resId, km });

  // 駅の上端: 最後のブロックの端と、番線の入口は同じ y（x も路線の中央）
  const lastBlock = sim.segments[0].blockIds.at(-1);
  const a = trainPosition(geo, sim, fakeTrain(lastBlock, sim.segments[0].endKm));
  const b = trainPosition(geo, sim, fakeTrain('aoba-2', track.startKm));
  near(a.y, st.boxTop, 1e-9);
  near(b.y, st.boxTop, 1e-9);
  near(a.x, b.x, 1e-9);

  // 番線の途中では副本線の列にいて、駅中心は箱の中央の高さ
  const mid = trainPosition(geo, sim, fakeTrain('aoba-2', 0));
  near(mid.y, st.boxTop + STATION_BOX_PX / 2, 1e-9);
  near(mid.x, geo.cx + st.trackDx['aoba-2'], 1e-9);

  // 駅の下端: 番線の出口と、次の区間の最初のブロックの頭が同じ y
  const c = trainPosition(geo, sim, fakeTrain('aoba-2', track.endKm));
  const d = trainPosition(geo, sim, fakeTrain(sim.segments[1].blockIds[0], sim.segments[1].startKm));
  near(c.y, st.boxBottom, 1e-9);
  near(d.y, st.boxBottom, 1e-9);
  near(c.x, d.x, 1e-9);
});

test('走行中の全ティックで、列車の y は進行方向に単調に増え、盤面の外に出ない', () => {
  const state = createState(stage1);
  const geo = computeBoardLayout(state.layout, { width: 375, height: 700 });
  const lastY = {};
  while (!state.finished) {
    step(state);
    for (const t of state.trains) {
      const p = trainPosition(geo, state.layout, t);
      if (!p) { delete lastY[t.id]; continue; }
      assert.ok(p.y >= geo.entryY - 1e-9 && p.y <= geo.height, `${t.id} y=${p.y}`);
      if (lastY[t.id] !== undefined) assert.ok(p.y >= lastY[t.id] - 1e-9, `${t.id} が戻った`);
      lastY[t.id] = p.y;
    }
  }
});

test('km → y: 区間と駅の中で途切れずにつながり、線路の外は両端に丸める', async () => {
  const { kmToY } = await import('../src/render/layout.js');
  const sim = createState(stage1).layout;
  const geo = computeBoardLayout(sim, { width: 375, height: 700 });
  const st = geo.stations[0];
  // 駅の上端・中心・下端
  near(kmToY(geo, sim, sim.stations[0].upperKm), st.boxTop, 1e-9);
  near(kmToY(geo, sim, 0), st.boxTop + STATION_BOX_PX / 2, 1e-9);
  near(kmToY(geo, sim, sim.stations[0].lowerKm), st.boxBottom, 1e-9);
  // 区間の中は、km に比例
  near(kmToY(geo, sim, 5) - kmToY(geo, sim, 4), geo.pxPerKm, 1e-9);
  // 単調に増える（細かく走査）
  let prev = -Infinity;
  for (let km = -12; km <= 42; km += 0.05) {
    const y = kmToY(geo, sim, km);
    assert.ok(y >= prev - 1e-9, `km=${km}`);
    prev = y;
  }
  assert.equal(kmToY(geo, sim, -50), geo.entryY);
  assert.equal(kmToY(geo, sim, 999), geo.stations.at(-1).boxBottom);
  // 列車の座標と同じ対応: 番線の途中の列車の y と一致する
  const t = { resId: 'aoba-2', km: 0.2 };
  near(trainPosition(geo, sim, t).y, kmToY(geo, sim, 0.2), 1e-9);
});
