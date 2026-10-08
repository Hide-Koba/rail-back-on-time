// チュートリアルの吹き出し。進行の判断は src/tutorial.js（状態機械）が行い、ここは表示だけ。SPEC.md §6.6。
export function createTutorialView(root, { onTap }) {
  root.innerHTML = `<div class="tutorial-text"></div><div class="tutorial-hint"></div>`;
  const text = root.querySelector('.tutorial-text');
  const hint = root.querySelector('.tutorial-hint');
  root.addEventListener('click', onTap);
  let shownId = null;

  return {
    /** step が null なら隠す。 */
    update(step) {
      root.hidden = !step;
      if (!step || shownId === step.id) return;
      shownId = step.id;
      text.textContent = step.text;
      hint.textContent = step.nextWhen === 'tap' ? (step.tapLabel ?? 'タップで次へ') : '操作すると進みます';
      root.classList.toggle('tappable', step.nextWhen === 'tap');
    },
  };
}
