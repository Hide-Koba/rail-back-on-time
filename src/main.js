// 起動と画面遷移: タイトル / ステージ選択 → プレイ → 結果。
import { stages, stageById } from './stages/index.js';
import { loadStars, saveStars } from './storage.js';
import { startPlay } from './play.js';
import { showTitle, showResult, hideScreen } from './render/screens.js';

const screen = document.getElementById('screen');
let play = null;

function toTitle() {
  play?.destroy();
  play = null;
  showTitle(screen, { stages, best: loadStars(), onSelect: begin });
}

function begin(stage) {
  play?.destroy();
  hideScreen(screen);
  play = startPlay(stage, { onFinish: (r) => finish(stage, r), onExit: toTitle });
}

function finish(stage, r) {
  const bestBefore = loadStars()[stage.id] ?? 0;
  saveStars(stage.id, r.stars); // 保存に失敗しても、この回の結果はそのまま見せる
  const i = stages.indexOf(stage);
  showResult(screen, {
    stage,
    state: r.session.state,
    result: r.result,
    baseline: r.baseline,
    rate: r.rate,
    starsEarned: r.stars,
    bestBefore,
    hasNext: i < stages.length - 1,
    onRetry: () => begin(stage),
    onNext: () => begin(stages[i + 1]),
    onSelect: toTitle,
  });
}

// ?stage=stage1 のようにステージを指定すると、タイトルを飛ばしてすぐ始める（動作確認用）
const direct = stageById(new URLSearchParams(location.search).get('stage'));
if (direct) begin(direct);
else toTitle();

// 動作確認用（コンソールから `(await import('/src/main.js')).debug.play.advance(600)` のように使う）
export const debug = { get play() { return play; } };
