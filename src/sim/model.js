// ステージ定義から、路線の構造（ブロック分割・番線）と初期状態を作る。
import { BLOCK_KM, STATION_HALF_KM, PAX } from '../config.js';
import { buildTimetable } from './timetable.js';

/**
 * 路線の静的な構造。ゲーム中は変わらないので state 間で共有してよい。
 *   resources[id] … ブロックまたは番線（1本しか入れないリソース）
 *   segments[i]   … 駅 i の手前の区間（i=0 は入線点から駅0まで）
 *   stations[i]   … 駅
 */
export function buildLayout(stage) {
  const resources = {};
  const segments = [];
  const stations = [];

  stage.stations.forEach((s, i) => {
    const isLast = i === stage.stations.length - 1;
    if (!!s.isTerminal !== isLast) {
      throw new Error(`終点は最後の駅だけに指定してください: ${s.id}`);
    }
    const segStart = i === 0 ? stage.entryKm : stage.stations[i - 1].km + STATION_HALF_KM;
    const segEnd = s.km - STATION_HALF_KM;
    const len = segEnd - segStart;
    if (!(len > 0)) throw new Error(`区間の長さが正になっていません: ${s.id}`);

    // 長さを BLOCK_KM でおおよそ均等に割る（浮動小数の誤差で1個増えないよう微小量を引く）
    const n = Math.max(1, Math.ceil(len / BLOCK_KM - 1e-9));
    const blockIds = [];
    for (let j = 0; j < n; j++) {
      const id = `seg${i}-b${j}`;
      resources[id] = {
        id,
        kind: 'block',
        startKm: j === 0 ? segStart : segStart + (len * j) / n,
        endKm: j === n - 1 ? segEnd : segStart + (len * (j + 1)) / n,
        segment: i,
        blockIndex: j,
      };
      blockIds.push(id);
    }
    segments.push({ index: i, startKm: segStart, endKm: segEnd, blockIds });

    const tracks = s.tracks.map((t) => {
      if (resources[t.id]) throw new Error(`番線IDが重複しています: ${t.id}`);
      resources[t.id] = {
        id: t.id,
        kind: 'track',
        startKm: s.km - STATION_HALF_KM,
        endKm: s.km + STATION_HALF_KM,
        stationIndex: i,
        stationId: s.id,
        label: t.label,
        isMain: !!t.isMain,
        hasPlatform: !!t.hasPlatform,
      };
      return resources[t.id];
    });
    if (isLast && tracks.some((t) => !t.hasPlatform)) {
      throw new Error(`終点の番線はすべてホームが必要です: ${s.id}`);
    }
    stations.push({
      index: i,
      id: s.id,
      name: s.name,
      km: s.km,
      upperKm: s.km - STATION_HALF_KM,
      lowerKm: s.km + STATION_HALF_KM,
      isTerminal: isLast,
      turnaroundSec: s.turnaroundSec ?? 0,
      tracks,
    });
  });

  return { resources, segments, stations };
}

/** 初期状態を作る（warmup はここでは進めない。runner.js の createGame を使う）。 */
export function createState(stage) {
  const layout = buildLayout(stage);
  const stationIds = new Set(layout.stations.filter((s) => !s.isTerminal).map((s) => s.id));

  const trains = stage.trains.map((def) => {
    for (const id of def.stops) {
      if (!stationIds.has(id)) throw new Error(`${def.id}: 停車駅が不正です: ${id}`);
    }
    // 開始時刻より前の入線時刻は、開始と同時に入線して、その分が余計な遅延になってしまう
    if (def.entrySec < stage.startClockSec) {
      throw new Error(`${def.id}: 入線時刻が盤面の開始時刻より前です`);
    }
    return {
      id: def.id,
      type: def.type,
      number: def.number,
      pax: PAX[def.type],
      stops: [...def.stops],
      entrySec: def.entrySec,
      initialDelaySec: def.initialDelaySec ?? 0,
      schedEntrySec: def.entrySec - (def.initialDelaySec ?? 0),

      status: 'queued',
      km: stage.entryKm,
      resId: null, // 占有しているリソース（queued / done は null）
      nextStation: 0, // 向かっている（または今いる）駅の index

      routes: {}, // stationId -> trackId
      routeLocked: {}, // stationId -> true（確定済み）
      held: false,
      holdAt: null, // 抑止予約をした駅ID
      dwellKind: null, // 'sched' | 'op'
      arrivedSec: null,
      freeSince: null, // signal 中、次のリソースが空いているのを見つけた時刻
      turnaroundEndSec: null,
      finalDelaySec: null,
      unfinished: false,
    };
  });

  const trainById = {};
  for (const t of trains) {
    if (trainById[t.id]) throw new Error(`列車IDが重複しています: ${t.id}`);
    trainById[t.id] = t;
  }

  const occ = {};
  for (const id of Object.keys(layout.resources)) occ[id] = null;

  return {
    stage,
    layout,
    timetable: buildTimetable(stage),
    startClockSec: stage.startClockSec,
    timeSec: stage.startClockSec,
    trains,
    trainById,
    occ, // resId -> trainId | null
    finished: false,
    endReason: null, // 'completed' | 'timeout'
  };
}
