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
    { id: 'S1', type: 'S', number: 1, entrySec: 10 * 3600 + 150, initialDelaySec: 0, stops: [] },
    { id: 'S3', type: 'S', number: 3, entrySec: 10 * 3600 + 315, initialDelaySec: 0, stops: [] },
  ],
  stars: { two: 0.15, three: 0.30 },
  // チュートリアル（SPEC §6.6）。各ステップは「表示する条件」と「次へ進む条件」を持つ。
  // 条件が満たされるまでゲームは自動で止まる。focus は輪を付ける列車。
  tutorial: [
    {
      id: 'intro',
      text: '青い列車は各停。約8分遅れています。各停は全部の駅に止まるので、後ろの速達がつかえてしまいます',
      showWhen: (s) => s.trainById.L801.status !== 'queued', // L801 が入線して、盤面に見えてから
      nextWhen: 'tap',
      focus: 'L801',
    },
    {
      id: 'hold',
      text: '白鷺駅で各停を抑止して、速達を先に通しましょう。各停をタップして『抑止』',
      showWhen: (s) => s.trainById.L801.status === 'dwelling' && s.trainById.L801.resId.startsWith('shirasagi'),
      nextWhen: (s) => s.trainById.L801.held,
      focus: 'L801',
    },
    {
      id: 'release',
      text: '速達が通過しました。各停の『抑止解除』で発車させましょう',
      showWhen: (s) => s.trainById.S3.nextStation >= 2, // S3 が白鷺を出た
      nextWhen: (s) => !s.trainById.L801.held && !s.trainById.L801.holdAt,
      focus: 'L801',
    },
    {
      id: 'point',
      text: 'ポイントをタップすると、列車が入る番線を変えられます',
      tapLabel: 'タップで閉じる',
      showWhen: () => true,
      nextWhen: 'tap',
    },
  ],
};
