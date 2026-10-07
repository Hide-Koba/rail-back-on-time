// 数値の置き場。調整で SPEC.md §3.12 と違う値にしたら、SPEC.md の表も更新する。

export const DT_SEC = 1; // 1ティックの長さ（ゲーム内秒）
export const GAME_SEC_PER_REAL_SEC = 20; // 等速時の時間の速さ
export const SPEED_MULTIPLIERS = [1, 2, 4]; // 倍速ボタンの倍率

export const MAX_SPEED_KMH = 285; // 最高速度
export const SCHED_SPEED_RATIO = 0.88; // ダイヤ上の速度の比率
export const SCHED_SPEED_KMH = MAX_SPEED_KMH * SCHED_SPEED_RATIO;

export const BLOCK_KM = 3.0; // ブロックの基準の長さ
export const STATION_HALF_KM = 0.5; // 駅の半分の長さ
export const ROUTE_LOCK_KM = 2.0; // 進路が確定する距離（駅の上端から）

export const MIN_DWELL_SEC = 150; // 最短停車時間（加減速ロスを含む）
export const SCHED_DWELL_SEC = 210; // ダイヤ上の停車時間（同上）
export const OP_STOP_MIN_SEC = 90; // 運転停車の最短時間
export const RESTART_LOSS_SEC = 45; // 信号待ちからの再発車ロス
export const UNFINISHED_PENALTY_SEC = 600; // 打ち切り時に未到着の列車へ加える遅延

export const PAX = { S: 1300, R: 1000, L: 700 }; // 種別ごとの乗客数

export const MAX_FRAME_TICKS = 400; // 1フレームで進めるティックの上限（SPEC §3.1）

export const TYPE_NAMES = { S: '速達', R: '快速', L: '各停' }; // 画面に出す種別名
