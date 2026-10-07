// ステージ2「湖東〜浪速 107km」。SPEC.md §4.3。
const H = 3600;
const hm = (h, m) => h * H + m * 60;
const min = (m) => m * 60;

// 停車駅: 湖東は快速・各停、湖南は各停、古都は全種別
const STOPS = {
  S: ['koto'],
  R: ['kodo', 'koto'],
  L: ['kodo', 'konan', 'koto'],
};
const train = (id, type, number, h, m, delayMin) => ({
  id, type, number, entrySec: hm(h, m), initialDelaySec: min(delayMin), stops: STOPS[type],
});

export default {
  id: 'stage2',
  title: '湖東〜浪速 107km',
  startClockSec: hm(18, 0),
  warmupSec: 600,
  maxDurationSec: 7200,
  entryKm: -15,
  entryLabel: '東京方面',
  stations: [
    { id: 'kodo', name: '湖東', km: 0, tracks: [
      { id: 'kodo-11', label: '11番線', isMain: true, hasPlatform: false },
      { id: 'kodo-12', label: '12番線', isMain: false, hasPlatform: true },
      { id: 'kodo-13', label: '13番線', isMain: false, hasPlatform: true },
    ] },
    { id: 'konan', name: '湖南', km: 35, tracks: [
      { id: 'konan-1', label: '1番線', isMain: true, hasPlatform: false },
      { id: 'konan-2', label: '2番線', isMain: false, hasPlatform: true },
    ] },
    { id: 'koto', name: '古都', km: 68, tracks: [
      { id: 'koto-13', label: '13番線', isMain: true, hasPlatform: true },
      { id: 'koto-14', label: '14番線', isMain: false, hasPlatform: true },
    ] },
    { id: 'naniwa', name: '浪速', km: 107, isTerminal: true, turnaroundSec: 900, tracks: [
      { id: 'naniwa-20', label: '20番線', isMain: false, hasPlatform: true },
      { id: 'naniwa-21', label: '21番線', isMain: false, hasPlatform: true },
      { id: 'naniwa-22', label: '22番線', isMain: false, hasPlatform: true },
      { id: 'naniwa-23', label: '23番線', isMain: false, hasPlatform: true },
    ] },
  ],
  trains: [
    train('L844', 'L', 844, 18, 0, 73),
    train('S38', 'S', 38, 18, 3, 67),
    train('S178', 'S', 178, 18, 5, 60),
    train('R660', 'R', 660, 18, 8, 56),
    train('S462', 'S', 462, 18, 10, 55),
    train('L846', 'L', 846, 18, 12, 50),
    train('S40', 'S', 40, 18, 14, 47),
    train('S102', 'S', 102, 18, 17, 38),
    train('S42', 'S', 42, 18, 19, 32),
    train('R718', 'R', 718, 18, 21, 24),
    train('L848', 'L', 848, 18, 24, 22),
    train('S272', 'S', 272, 18, 26, 17),
    train('S44', 'S', 44, 18, 28, 21),
    train('S476', 'S', 476, 18, 31, 14),
    train('S46', 'S', 46, 18, 33, 6),
    train('L850', 'L', 850, 18, 36, 3),
    train('S104', 'S', 104, 18, 38, 0),
    train('S48', 'S', 48, 18, 41, 0),
  ],
  stars: { two: 0.10, three: 0.20 }, // 仮。M3 で遊んでから決める
  tutorial: [],
};
