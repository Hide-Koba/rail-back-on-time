// ステージ1「はじめての待避」。SPEC.md §4.2。
export default {
  id: 'stage1',
  title: 'はじめての待避',
  startClockSec: 10 * 3600,
  warmupSec: 0,
  maxDurationSec: 3600,
  entryKm: -10,
  entryLabel: '東京方面',
  stations: [
    { id: 'aoba', name: '青葉', km: 0, tracks: [
      { id: 'aoba-1', label: '1番線', isMain: true, hasPlatform: false },
      { id: 'aoba-2', label: '2番線', isMain: false, hasPlatform: true },
    ] },
    { id: 'shirasagi', name: '白鷺', km: 20, tracks: [
      { id: 'shirasagi-1', label: '1番線', isMain: true, hasPlatform: false },
      { id: 'shirasagi-2', label: '2番線', isMain: false, hasPlatform: true },
    ] },
    { id: 'minato', name: '港', km: 40, isTerminal: true, turnaroundSec: 300, tracks: [
      { id: 'minato-1', label: '1番線', isMain: true, hasPlatform: true },
      { id: 'minato-2', label: '2番線', isMain: false, hasPlatform: true },
      { id: 'minato-3', label: '3番線', isMain: false, hasPlatform: true },
    ] },
  ],
  trains: [
    { id: 'L801', type: 'L', number: 801, entrySec: 10 * 3600 + 0, initialDelaySec: 8 * 60, stops: ['aoba', 'shirasagi'] },
    { id: 'S1', type: 'S', number: 1, entrySec: 10 * 3600 + 90, initialDelaySec: 0, stops: [] },
    { id: 'S3', type: 'S', number: 3, entrySec: 10 * 3600 + 240, initialDelaySec: 0, stops: [] },
  ],
  stars: { two: 0.15, three: 0.30 },
  tutorial: [], // M3 で §6.6 の内容を入れる
};
