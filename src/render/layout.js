// km → 画面座標の変換と、駅の箱の配置。DOM に依存しない（Node でテストできる）。SPEC.md §6.2。

export const STATION_BOX_PX = 72; // 駅の箱の高さ（固定）
export const MIN_BLOCK_PX = 18; // 1ブロックの最小の高さ
export const TRACK_GAP_PX = 56; // 番線の列の間隔（左に「種別 番号」、右に遅延を出しても隣の列車に被らない広さ）
export const BRANCH_RATIO = 0.25; // 駅の入口・出口で、路線から番線へ斜めに分岐・合流する範囲（駅の長さに対する割合）

/** 駅の番線を、路線（画面中央）からの横のずれ [px] に割り当てる。本線を中央、副本線を左右に交互に並べる。 */
export function trackOffsets(tracks, gap = TRACK_GAP_PX) {
  const dx = {};
  const main = tracks.find((t) => t.isMain);
  if (!main) {
    // 本線がない駅（終点など）は、中央を挟んで左右対称に並べる
    tracks.forEach((t, i) => { dx[t.id] = (i - (tracks.length - 1) / 2) * gap; });
    return dx;
  }
  dx[main.id] = 0;
  tracks.filter((t) => t !== main).forEach((t, i) => {
    dx[t.id] = (i % 2 === 0 ? -1 : 1) * (Math.floor(i / 2) + 1) * gap;
  });
  return dx;
}

/**
 * 盤面の配置を計算する。
 *   width, height … 盤面を表示できる領域の大きさ（height に収まるなら収め、収まらなければ縦スクロール）
 * 戻り値: { width, height, cx, pxPerKm, entryY, segments[], stations[] }
 */
export function computeBoardLayout(sim, { width, height, topPad = 76, bottomPad = 24 }) {
  const { segments, stations, resources } = sim;

  const segKm = segments.map((s) => s.endKm - s.startKm);
  const totalSegKm = segKm.reduce((a, b) => a + b, 0);
  const blockKms = Object.values(resources)
    .filter((r) => r.kind === 'block')
    .map((r) => r.endKm - r.startKm);
  const minBlockKm = Math.min(...blockKms);

  // 「盤面全体が画面の高さに収まる値」。ただし1ブロックが MIN_BLOCK_PX 未満にならないようにする
  const fixed = topPad + stations.length * STATION_BOX_PX + bottomPad;
  const fit = (height - fixed) / totalSegKm;
  const pxPerKm = Math.max(fit, MIN_BLOCK_PX / minBlockKm);

  const cx = width / 2;
  const outSegments = [];
  const outStations = [];
  let y = topPad;
  segments.forEach((seg, i) => {
    const y0 = y;
    const y1 = y0 + segKm[i] * pxPerKm;
    outSegments.push({
      index: i,
      y0,
      y1,
      startKm: seg.startKm,
      // ブロックの境目の y（両端は含まない）
      blockEdges: seg.blockIds.slice(1).map((id) => y0 + (resources[id].startKm - seg.startKm) * pxPerKm),
    });
    const st = stations[i];
    const boxTop = y1;
    outStations.push({
      index: i,
      boxTop,
      boxBottom: boxTop + STATION_BOX_PX,
      trackDx: trackOffsets(st.tracks),
    });
    y = boxTop + STATION_BOX_PX;
  });

  return {
    width,
    height: y + bottomPad,
    cx,
    pxPerKm,
    entryY: topPad,
    segments: outSegments,
    stations: outStations,
  };
}

/** 列車の先頭の画面座標 {x, y}。queued / done（盤面にいない）は null。 */
export function trainPosition(geo, sim, train) {
  if (train.resId == null) return null;
  const res = sim.resources[train.resId];
  if (res.kind === 'block') {
    const seg = geo.segments[res.segment];
    return { x: geo.cx, y: seg.y0 + (train.km - seg.startKm) * geo.pxPerKm };
  }
  // 番線: 駅の箱の高さいっぱいに、番線の km の範囲 [startKm, endKm] を対応させる
  const st = geo.stations[res.stationIndex];
  const f = (train.km - res.startKm) / (res.endKm - res.startKm);
  const dx = st.trackDx[res.id];
  const b = BRANCH_RATIO;
  const shift = f < b ? dx * (f / b) : f > 1 - b ? dx * ((1 - f) / b) : dx; // 入口と出口の斜めの部分
  return { x: geo.cx + shift, y: st.boxTop + f * STATION_BOX_PX };
}

/**
 * 駅の箱の中で、路線から番線へ入る経路（SVG の path の d）。入口で斜めに分岐し、出口で合流する。
 * 終点は合流せず行き止まり。
 */
export function trackPath(geo, sim, track) {
  const st = sim.stations[track.stationIndex];
  const gs = geo.stations[track.stationIndex];
  const x = geo.cx + gs.trackDx[track.id];
  const yA = gs.boxTop + STATION_BOX_PX * BRANCH_RATIO;
  const yB = gs.boxTop + STATION_BOX_PX * (1 - BRANCH_RATIO);
  const head = `M ${geo.cx} ${gs.boxTop} L ${x} ${yA} L ${x} ${yB}`;
  return st.isTerminal ? head : `${head} L ${geo.cx} ${gs.boxBottom}`;
}

export const TRAIN_HIT_PX = 24; // 列車のタップ判定の半径
export const POINT_HIT_PX = 44; // ポイントのタップ領域の一辺（44×44px 以上）
const POINT_OFFSET_X = 50; // ポイントのアイコンを、路線から右へずらす量（駅に入る列車の文字と重ならない位置）

/** ポイントのアイコンの中心。各駅の入口（駅の箱の上端）の、路線の右に置く。 */
export function pointCenter(geo, stationIndex) {
  return { x: geo.cx + POINT_OFFSET_X, y: geo.stations[stationIndex].boxTop - 6 };
}

/** 列車の「中心」（先頭から本体の真ん中）。タップ判定と、輪の位置に使う。 */
export function trainCenter(geo, sim, train) {
  const p = trainPosition(geo, sim, train);
  return p && { x: p.x, y: p.y - 11 };
}

/** タップした位置に最も近い列車（中心から TRAIN_HIT_PX 以内）。なければ null。 */
export function hitTestTrain(geo, sim, trains, x, y, radius = TRAIN_HIT_PX) {
  let best = null;
  let bestD = radius;
  for (const t of trains) {
    const c = trainCenter(geo, sim, t);
    if (!c) continue;
    const d = Math.hypot(c.x - x, c.y - y);
    if (d <= bestD) { best = t; bestD = d; }
  }
  return best;
}

/** タップした位置にあるポイントの駅 index。なければ null。 */
export function hitTestPoint(geo, x, y) {
  const half = POINT_HIT_PX / 2;
  for (const st of geo.stations) {
    const c = pointCenter(geo, st.index);
    if (Math.abs(x - c.x) <= half && Math.abs(y - c.y) <= half) return st.index;
  }
  return null;
}

/** km の地点の画面の y。駅の中は、駅の箱の高さいっぱいに対応させる（列車の座標と同じ対応）。線路の外は両端に丸める。 */
export function kmToY(geo, sim, km) {
  for (const st of sim.stations) {
    if (km >= st.upperKm && km <= st.lowerKm) {
      return geo.stations[st.index].boxTop + ((km - st.upperKm) / (st.lowerKm - st.upperKm)) * STATION_BOX_PX;
    }
  }
  for (const seg of sim.segments) {
    if (km >= seg.startKm && km <= seg.endKm) return geo.segments[seg.index].y0 + (km - seg.startKm) * geo.pxPerKm;
  }
  return km < sim.segments[0].startKm ? geo.entryY : geo.stations.at(-1).boxBottom;
}
