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
