const CONTRADICTION_TOKEN =
  /[\p{N}\p{S}%]|^[\p{Pd}]+$|^(?:no|not|never|without|cannot|\w+n't)$/u;

const PROTECTED_ECHO_WORD =
  /^(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|hundredth|thousandth|could|would|should|might|shall|always|possibly|probably|maybe|unable|actually|instead|rather|except|unless|denied|against|exclude|excluded|wrong|false|cancel|cancelled|enable|enabled|disable|disabled|correct|correction)$/;

export const isProtectedEchoWord = (word: string): boolean =>
  CONTRADICTION_TOKEN.test(word) || PROTECTED_ECHO_WORD.test(word);

// A deliberately narrow pronunciation approximation for ASR boundary changes:
// vowel reduction, non-rhotic r, silent terminal e, and final coronal-stop + s
// reduction. Keep vowel positions and require two unchanged consonants. This is
// only a candidate gate; the reconciler still requires paired acoustic evidence.
const reducedPronunciation = (text: string): string | undefined => {
  const key = text
    .replace(/([aeiou])r(?=[^aeiou]|$)/g, '$1')
    .replace(/e(?=s?$)/g, '')
    .replace(/[aeiou]+/g, 'A')
    .replace(/[dt]s$/, 's');
  return (key.match(/[bcdfghjklmnpqrstvwxyz]/g)?.length ?? 0) >= 2
    ? key
    : undefined;
};

export type EchoTokenAlignment = {
  tokenCount: number;
  confidence: number;
  disputed?: { start: number; micCount: number; systemCount: number };
};

// Bounded sequence alignment of a single interior replacement or word split.
// Free insertions/omissions cannot be consumed: both sides must contribute words,
// and an exact shared word inside a replacement would disguise an insertion.
export function* alignEchoTokens(
  mic: string[],
  system: string[],
): Generator<EchoTokenAlignment> {
  if (system.every((word, index) => word === mic[index])) {
    yield { tokenCount: system.length, confidence: 1 };
    return;
  }
  if (system.length < 20) return;
  let prefix = 0;
  while (
    prefix < Math.min(mic.length, system.length) &&
    mic[prefix] === system[prefix]
  )
    prefix += 1;
  if (prefix < 3) return;
  for (let micCount = 1; micCount <= 2; micCount += 1) {
    for (let systemCount = 1; systemCount <= 2; systemCount += 1) {
      const suffix = system.length - prefix - systemCount;
      const tokenCount = prefix + micCount + suffix;
      const confidence =
        (prefix + suffix) / Math.max(tokenCount, system.length);
      if (
        suffix < 3 ||
        tokenCount > mic.length ||
        confidence < 0.9 ||
        !system
          .slice(prefix + systemCount)
          .every((word, index) => word === mic[prefix + micCount + index])
      )
        continue;
      const leftWords = mic.slice(prefix, prefix + micCount);
      const rightWords = system.slice(prefix, prefix + systemCount);
      if (
        leftWords.some((word) => rightWords.includes(word)) ||
        [...leftWords, ...rightWords].some((word) => isProtectedEchoWord(word))
      )
        continue;
      const left = leftWords.join('');
      const right = rightWords.join('');
      if (!/^[a-z]{1,48}$/.test(left) || !/^[a-z]{1,48}$/.test(right)) continue;
      const pronunciation =
        micCount !== systemCount ? reducedPronunciation(left) : undefined;
      const pronouncedBoundaryChange =
        pronunciation !== undefined &&
        pronunciation === reducedPronunciation(right);
      if (!pronouncedBoundaryChange && (left.length < 5 || right.length < 5))
        continue;
      let previous = Uint8Array.from(
        { length: right.length + 1 },
        (_, index) => index,
      );
      for (let i = 1; i <= left.length; i += 1) {
        const next = new Uint8Array(right.length + 1);
        next[0] = i;
        for (let j = 1; j <= right.length; j += 1)
          next[j] = Math.min(
            next[j - 1] + 1,
            previous[j] + 1,
            previous[j - 1] + Number(left[i - 1] !== right[j - 1]),
          );
        previous = next;
      }
      if (
        !pronouncedBoundaryChange &&
        previous[right.length] / Math.max(left.length, right.length) > 0.5
      )
        continue;
      yield {
        tokenCount,
        confidence,
        disputed: { start: prefix, micCount, systemCount },
      };
    }
  }
}
