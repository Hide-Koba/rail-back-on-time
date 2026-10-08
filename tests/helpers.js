// テスト用の小さなステージを作る補助。
// 駅 A(0km) と B(20km) は 本線(ホームなし)+副本線(ホームあり)、終点 C(40km)。入線点は -10km。

const pair = (s) => [
  { id: `${s}-1`, label: '1番線', isMain: true, hasPlatform: false },
  { id: `${s}-2`, label: '2番線', isMain: false, hasPlatform: true },
];

export function lineStage({ trains, terminalTracks = 3, turnaroundSec = 300, maxDurationSec = 7200, cards, events }) {
  return {
    id: 'test-line',
    title: 'test',
    startClockSec: 0,
    warmupSec: 0,
    maxDurationSec,
    entryKm: -10,
    entryLabel: '東京方面',
    stations: [
      { id: 'A', name: 'A', km: 0, tracks: pair('A') },
      { id: 'B', name: 'B', km: 20, tracks: pair('B') },
      {
        id: 'C', name: 'C', km: 40, isTerminal: true, turnaroundSec,
        tracks: Array.from({ length: terminalTracks }, (_, i) => ({
          id: `C-${i + 1}`, label: `${i + 1}番線`, isMain: i === 0, hasPlatform: true,
        })),
      },
    ],
    trains,
    ...(cards ? { cards } : {}),
    ...(events ? { events } : {}),
    stars: { two: 0.15, three: 0.3 },
    tutorial: [],
  };
}

export const train = (id, type, entrySec, initialDelaySec, stops) => ({
  id, type, number: 1, entrySec, initialDelaySec, stops,
});

export const near = (actual, expected, eps = 1e-6, msg = '') => {
  if (!(Math.abs(actual - expected) <= eps)) {
    throw new Error(`${msg} expected ${expected}, got ${actual}`);
  }
};
