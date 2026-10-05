const OMITTED = '\n[Text omitted]\n';
const normalizeWord = (word: string): string =>
  word.replace(/ies$/, 'y').replace(/(?:ing|ed|s)$/, '');
const STOP = new Set(
  'a an and are as at be been by can concrete did do does each explain for from give has have how i in is it latest me my of on or our please recent show specific tell that the their them these this those to was we were what when which who will with would you your next steps owner owners date dates'
    .split(' ')
    .map(normalizeWord),
);
const words = (text: string): string[] =>
  [...text.toLocaleLowerCase().matchAll(/[\p{L}\p{N}]+/gu)].map(([word]) =>
    normalizeWord(word),
  );

export function excerptQueryEvidence(
  text: string,
  query: string,
  requestedBudget: number,
): string {
  const budget = Math.max(0, Math.floor(requestedBudget));
  if (text.length <= budget) return text;
  if (budget < OMITTED.length * 2 + 20) return text.slice(0, budget);
  // Task state overrides note prose. Retain the leading state block before
  // spending the remaining budget on ranked note excerpts.
  if (text.startsWith('[Canonical commitment state')) {
    const boundary = text.indexOf('\n[Meeting]');
    if (boundary > 0) {
      const state = text.slice(0, boundary);
      if (state.length >= budget - OMITTED.length)
        return state.slice(0, budget - OMITTED.length) + OMITTED;
      return `${state}\n${excerptQueryEvidence(
        text.slice(boundary + 1),
        query,
        budget - state.length - 1,
      )}`;
    }
  }
  const terms = [
    ...new Set(
      words(query).filter((word) => word.length > 2 && !STOP.has(word)),
    ),
  ];
  const lines = text
    .split('\n')
    .flatMap((line) =>
      line.length > 400 ? line.split(/(?<=[.!?;])\s+/u) : [line],
    );
  const termSets = lines.map((line) => new Set(words(line)));
  const ranked = lines
    .map((_line, index) => ({
      index,
      score: terms.filter((term) => termSets[index].has(term)).length,
    }))
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) => right.score - left.score || left.index - right.index,
    );
  const selected = new Set<number>();
  const render = () => {
    const indexes = [...selected].sort((left, right) => left - right);
    let previous = -1;
    let result = '';
    for (const index of indexes) {
      result +=
        (index > previous + 1 ? OMITTED : result ? '\n' : '') + lines[index];
      previous = index;
    }
    return result + (previous < lines.length - 1 ? OMITTED : '');
  };
  const add = (index: number) => {
    if (index < 0 || index >= lines.length || selected.has(index)) return;
    selected.add(index);
    if (render().length > budget) selected.delete(index);
  };
  for (let index = 0; index < Math.min(lines.length, 8); index++) {
    if (
      index === 0 ||
      /^\[(?:Project|Meeting|Occurred|Notes trust|Current(?: saved)? notes)\b/i.test(
        lines[index],
      )
    )
      add(index);
  }
  // Keep a small ending window for corrections/status updates even when the
  // requested topic also occurs in the heading.
  for (let index = Math.max(0, lines.length - 2); index < lines.length; index++)
    add(index);
  for (const { index } of ranked) {
    // Context below a heading commonly contains the owner, count or due date.
    for (const neighbor of [index, index + 1, index + 2, index - 1])
      add(neighbor);
  }
  if (ranked.some(({ index }) => selected.has(index))) return render();
  const retained = budget - OMITTED.length;
  return (
    text.slice(0, Math.ceil(retained * 0.6)) +
    OMITTED +
    text.slice(-Math.floor(retained * 0.4))
  );
}
