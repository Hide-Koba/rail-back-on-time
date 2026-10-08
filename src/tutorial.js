// チュートリアルの進行（状態機械）。DOM に依存しない。SPEC.md §6.6。
// 各ステップは「表示する条件 showWhen(state)」と「次へ進む条件 nextWhen」を持つ。
// nextWhen が 'tap' ならタップで、関数なら状態が条件を満たしたら進む。
// ステップを表示している間は blocking が true になり、ゲームは自動で一時停止して待つ。

export function createTutorial(steps = []) {
  let index = 0;
  let showing = false;

  return {
    /** 表示中のステップ（なければ null）。focus はヒントとして輪を付ける列車ID。 */
    get step() { return showing ? steps[index] : null; },
    get blocking() { return showing; },
    get finished() { return index >= steps.length; },

    /** 毎フレーム呼ぶ。条件がすでに満たされているステップは、止めずに飛ばす。 */
    update(state) {
      while (index < steps.length) {
        const step = steps[index];
        if (!showing) {
          if (!step.showWhen(state)) return;
          showing = true;
        }
        if (step.nextWhen === 'tap' || !step.nextWhen(state)) return;
        index++;
        showing = false;
      }
    },

    /** 吹き出しがタップされた。nextWhen が 'tap' のステップだけ進める。 */
    tap() {
      if (showing && steps[index].nextWhen === 'tap') {
        index++;
        showing = false;
      }
    },
  };
}
