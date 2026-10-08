// 1回のプレイ（ステージ開始〜終了）。ゲームループ、操作、画面の更新をまとめる。
import { DT_SEC, SPEED_MULTIPLIERS } from './config.js';
import { framesTicks } from './loop.js';
import { createGame, baselineResult, summarize } from './sim/runner.js';
import { step } from './sim/simulation.js';
import { applyCommand } from './sim/commands.js';
import { routeTargetTrain, nextRouteChoice } from './sim/dispatch.js';
import { improvementRate, starCount } from './sim/score.js';
import { createTutorial } from './tutorial.js';
import { createBoard, delayMinutes } from './render/board.js';
import { createHud } from './render/hud.js';
import { createPanel } from './render/panel.js';
import { createTutorialView } from './render/tutorial.js';
import { createToasts, noticeText } from './render/notices.js';

/**
 * ステージを開始する。onFinish({ session, result, baseline, rate, stars }) は終了時に1回だけ呼ぶ。
 * 戻り値の destroy() で、ループとイベントを片づける（画面遷移の前に必ず呼ぶ）。
 */
export function startPlay(stage, { onFinish, onExit }) {
  const state = createGame(stage);
  const baseline = baselineResult(stage);
  const tutorial = createTutorial(stage.tutorial ?? []);
  // log: 操作の記録 { t, cmd }。リプレイやテストで同じ操作を再現できる
  const session = { stage, state, baseline, paused: false, speedIndex: 0, selectedId: null, log: [] };

  let acc = 0;
  let rafId = 0;
  let last = performance.now();
  let reported = false;
  let destroyed = false;
  let noticeIndex = state.notices.length; // 開始前（warmup 中）の出来事は知らせない

  const $ = (id) => document.getElementById(id);
  const hud = createHud($('hud'), {
    title: stage.title,
    onTogglePause: () => { if (!tutorial.blocking) session.paused = !session.paused; },
    onSpeed: (i) => { session.speedIndex = i; if (!tutorial.blocking) session.paused = false; },
    onBack: () => {
      if (window.confirm('ステージ選択に戻ります。進行は保存されません。よろしいですか？')) {
        destroy();
        onExit();
      }
    },
  });
  const panel = createPanel($('panel'), {
    onHold: (trainId) => issue({ type: 'hold', trainId }),
    onRelease: (trainId) => issue({ type: 'release', trainId }),
    onCancel: (trainId) => issue({ type: 'cancel', trainId }), // 指令カード: 運休
    onShorten: (trainId) => issue({ type: 'shortenTurnaround', trainId }), // 指令カード: 折返し短縮
    onClose: () => { session.selectedId = null; draw(); },
  });
  const toasts = createToasts($('toasts'));
  const tutorialView = createTutorialView($('tutorial'), { onTap: () => { tutorial.tap(); draw(); } });
  const board = createBoard($('board-scroll'), state, {
    onTrainTap: (trainId) => { session.selectedId = trainId; draw(); },
    onPointTap: (stationIndex) => {
      const station = state.layout.stations[stationIndex];
      const target = routeTargetTrain(state, station.id);
      if (!target) return;
      issue({ type: 'setRoute', trainId: target.id, stationId: station.id, trackId: nextRouteChoice(state, target, station) });
    },
  });

  /**
   * プレイヤーの操作。一時停止中でもすぐ効かせたいので、次の step を待たずに適用する
   * （step が最初にやることと同じ applyCommand なので、結果は変わらない）。
   */
  function issue(cmd) {
    const ok = applyCommand(state, cmd);
    if (ok) session.log.push({ t: state.timeSec, cmd });
    draw();
    return ok;
  }

  function totalDelayMin() {
    let sum = 0;
    for (const t of state.trains) sum += delayMinutes(state, t);
    return sum;
  }

  function draw() {
    tutorial.update(state);
    const selected = session.selectedId && state.trainById[session.selectedId];
    if (selected && selected.status === 'done') session.selectedId = null; // 終了した列車のパネルは自動で閉じる
    board.render(state, { selectedId: session.selectedId, focusId: tutorial.step?.focus ?? null });
    panel.update(state, session.selectedId ? state.trainById[session.selectedId] : null);
    tutorialView.update(tutorial.step);
    for (; noticeIndex < state.notices.length; noticeIndex++) toasts.push(noticeText(state, state.notices[noticeIndex]));
    hud.update({
      clockSec: state.timeSec,
      totalDelayMin: totalDelayMin(),
      paused: session.paused,
      speedIndex: session.speedIndex,
      finished: state.finished,
      blocked: tutorial.blocking,
      cards: stage.cards ? state.cards : null,
    });
  }

  function frame(now) {
    if (destroyed) return;
    const realDt = (now - last) / 1000;
    last = now;
    tutorial.update(state);
    if (!session.paused && !tutorial.blocking && !state.finished) {
      const r = framesTicks(acc, realDt, SPEED_MULTIPLIERS[session.speedIndex]);
      acc = r.acc;
      for (let i = 0; i < r.ticks && !state.finished; i++) step(state);
    }
    draw();
    if (state.finished && !reported) {
      reported = true;
      const result = summarize(state);
      const rate = improvementRate(result.loss, baseline.loss);
      onFinish({ session, result, baseline, rate, stars: starCount(stage, rate) });
      return; // 終了後はループを止める（盤面は結果画面の下に残る）
    }
    rafId = requestAnimationFrame(frame);
  }

  // PC のキーボード: Space = 一時停止の切り替え、1/2/3 = 倍速、Esc = 選択解除
  function onKey(e) {
    if (e.code === 'Space') {
      if (e.target instanceof HTMLButtonElement) return; // ボタンの標準動作に任せる
      e.preventDefault();
      if (!tutorial.blocking) session.paused = !session.paused;
    } else if (['Digit1', 'Digit2', 'Digit3'].includes(e.code)) {
      session.speedIndex = Number(e.code.slice(-1)) - 1;
      if (!tutorial.blocking) session.paused = false;
    } else if (e.code === 'Escape') {
      session.selectedId = null;
    } else {
      return;
    }
    draw();
  }
  window.addEventListener('keydown', onKey);

  function destroy() {
    destroyed = true;
    cancelAnimationFrame(rafId);
    window.removeEventListener('keydown', onKey);
    board.destroy();
    $('hud').innerHTML = '';
    $('panel').hidden = true;
    $('stage-area').classList.remove('has-panel');
    $('tutorial').hidden = true;
    toasts.clear();
  }

  draw(); // 最初のフレームを待たずに描く
  rafId = requestAnimationFrame(frame);

  return {
    session,
    destroy,
    /** 動作確認用: 描画を待たずにゲーム内で sec 秒進める。 */
    advance(sec) {
      for (let i = 0; i < sec / DT_SEC && !state.finished; i++) step(state);
      draw();
    },
    issue,
    draw,
  };
}
