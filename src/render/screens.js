// タイトル / ステージ選択 と 結果画面。SPEC.md §6.7。
import { TYPE_NAMES } from '../config.js';

const stars = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function hideScreen(root) {
  root.hidden = true;
  root.innerHTML = '';
}

export function showTitle(root, { stages, best, onSelect }) {
  root.hidden = false;
  root.innerHTML = `
    <div class="screen-inner title">
      <h1>定時に戻せ！</h1>
      <p class="title-sub">遅れた新幹線をさばいて、ダイヤを戻そう（試作・仮題）</p>
      <ul class="stage-list">
        ${stages.map((s, i) => `
          <li><button type="button" class="stage-btn" data-i="${i}">
            <span class="stage-no">ステージ${i + 1}</span>
            <span class="stage-title">${esc(s.title)}</span>
            <span class="stage-stars" aria-label="最高 星${best[s.id] ?? 0}">${best[s.id] ? stars(best[s.id]) : '未クリア'}</span>
          </button></li>`).join('')}
      </ul>
      <section class="howto">
        <h2>遊び方</h2>
        <ol>
          <li>遅れた列車をタップして「抑止」すると、駅でその列車を待たせて、後ろの速達を先に通せます。</li>
          <li>駅の入口にあるポイントのマークをタップすると、近づく列車が入る番線を切り替えられます。</li>
          <li>全員の遅れ（遅延損失）を、何もしないときより減らすと星がもらえます。</li>
          <li>ステージ2では指令カードが使えます。運休は遅れの大きい列車に（遅れが60分に満たない列車を運休にすると、かえって損失が増えます）、折返し短縮は終点で折り返し中の列車に使います。</li>
        </ol>
      </section>
    </div>`;
  root.querySelectorAll('.stage-btn').forEach((b) => b.addEventListener('click', () => onSelect(stages[Number(b.dataset.i)])));
}

const minutes = (sec) => `${sec >= 0 ? '+' : '−'}${(Math.abs(sec) / 60).toFixed(1)}`;

export function showResult(root, { stage, state, result, baseline, rate, starsEarned, bestBefore, hasNext, onRetry, onNext, onSelect }) {
  root.hidden = false;
  const improved = starsEarned > bestBefore;
  const rows = state.trains.map((t) => {
    const self = t.finalDelaySec;
    const diff = self - baseline.finalDelaySec[t.id];
    const cls = Math.abs(diff) < 6 ? '' : diff < 0 ? 'good' : 'bad';
    return `<tr>
      <td><span class="chip t-${t.type}">${TYPE_NAMES[t.type]} ${t.number}</span></td>
      <td class="num">${t.cancelled ? '運休<small>（60分扱い）</small>' : `${minutes(self)}分${t.unfinished ? '<small>（未着）</small>' : ''}`}</td>
      <td class="num ${cls}">${minutes(diff)}分</td>
    </tr>`;
  }).join('');
  root.innerHTML = `
    <div class="screen-inner result">
      <p class="result-stage">${esc(stage.title)}</p>
      <div class="result-stars" aria-label="星${starsEarned}">${stars(starsEarned)}</div>
      ${improved ? '<p class="result-best">ベスト更新！</p>' : ''}
      ${state.endReason === 'timeout' ? '<p class="result-note">時間切れ: 終点に着いていない列車には +10分を加えています</p>' : ''}
      <dl class="result-stats">
        <div><dt>遅延損失</dt><dd>${Math.round(result.loss).toLocaleString()}<small>人分</small></dd></div>
        <div><dt>ベースライン（操作なし）</dt><dd>${Math.round(baseline.loss).toLocaleString()}<small>人分</small></dd></div>
        <div><dt>改善率</dt><dd class="${rate > 0 ? 'good' : ''}">${(rate * 100).toFixed(1)}<small>%</small></dd></div>
        <div><dt>定時率</dt><dd>${Math.round(result.onTimeRate * 100)}<small>%</small> <small>（操作なし ${Math.round(baseline.onTimeRate * 100)}%）</small></dd></div>
      </dl>
      <table class="result-table">
        <thead><tr><th>列車</th><th>終点到着遅延</th><th>操作なしとの差</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="result-actions">
        <button type="button" class="btn-big" data-act="retry">もう一度</button>
        <button type="button" class="btn-big" data-act="next" ${hasNext ? '' : 'disabled'}>次のステージ</button>
        <button type="button" class="btn-big ghost" data-act="select">ステージ選択</button>
      </div>
    </div>`;
  const on = (act, fn) => root.querySelector(`[data-act="${act}"]`).addEventListener('click', fn);
  on('retry', onRetry);
  on('next', onNext);
  on('select', onSelect);
}
