// 起動とゲームループ。SPEC.md §3.1。
import { DT_SEC, SPEED_MULTIPLIERS } from './config.js';
import { framesTicks } from './loop.js';
import { stageById, stages } from './stages/index.js';
import { createGame } from './sim/runner.js';
import { step } from './sim/simulation.js';
import { createBoard, delayMinutes } from './render/board.js';
import { createHud } from './render/hud.js';

// M2 はステージ2を自動運転で見せる。?stage=stage1 で別のステージも開ける。
const params = new URLSearchParams(location.search);
const stage = stageById(params.get('stage')) ?? stages.at(-1);

const state = createGame(stage);
let paused = false;
let speedIndex = 0;
let acc = 0; // まだ進めていない端数のティック

const hud = createHud(document.getElementById('hud'), {
  title: stage.title,
  onTogglePause: () => { paused = !paused; },
  onSpeed: (i) => { speedIndex = i; paused = false; },
});
const board = createBoard(document.getElementById('board-scroll'), state);

function totalDelayMin() {
  let sum = 0;
  for (const t of state.trains) sum += delayMinutes(state, t);
  return sum;
}

function draw() {
  board.render(state);
  hud.update({
    clockSec: state.timeSec,
    totalDelayMin: totalDelayMin(),
    paused,
    speedIndex,
    finished: state.finished,
  });
}

let last = performance.now();
function frame(now) {
  const realDt = (now - last) / 1000;
  last = now;
  if (!paused && !state.finished) {
    const r = framesTicks(acc, realDt, SPEED_MULTIPLIERS[speedIndex]);
    acc = r.acc;
    for (let i = 0; i < r.ticks && !state.finished; i++) step(state);
  }
  draw();
  requestAnimationFrame(frame);
}
draw(); // 最初の1フレームを待たずに描く
requestAnimationFrame(frame);

// PC のキーボード: Space = 一時停止の切り替え、1/2/3 = 倍速
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLButtonElement && e.code === 'Space') return; // ボタンの標準動作に任せる
  if (e.code === 'Space') { e.preventDefault(); paused = !paused; }
  else if (['Digit1', 'Digit2', 'Digit3'].includes(e.code)) { speedIndex = Number(e.code.slice(-1)) - 1; paused = false; }
});

// 動作確認用（ブラウザのコンソールから `(await import('/src/main.js')).game.advance(600)` のように使う）
export const game = {
  state,
  advance(sec) {
    for (let i = 0; i < sec / DT_SEC && !state.finished; i++) step(state);
    draw();
  },
};
