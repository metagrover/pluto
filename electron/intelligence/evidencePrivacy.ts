export const containsConfidentialAside = (text: string): boolean =>
  /\bconfidential\b|\boff[\s-]+the[\s-]+record\b|\b(?:keep|remain|stay|treat|hold)\b.{0,80}\bprivate\b|\bprivate\b.{0,80}\b(?:between us|only us|do not share|don't share)\b/i.test(
    text,
  );
