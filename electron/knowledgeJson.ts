const stripMarkdownFence = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\n?/, '')
    .replace(/\n?```$/, '')
    .trim();
};

const extractJsonObject = (value: string): string => {
  const firstBrace = value.indexOf('{');
  const firstBracket = value.indexOf('[');

  let startIndex = -1;
  let endIndex = -1;

  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIndex = firstBrace;
    endIndex = value.lastIndexOf('}');
  } else if (firstBracket !== -1) {
    startIndex = firstBracket;
    endIndex = value.lastIndexOf(']');
  }

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return value;
  }

  return value.slice(startIndex, endIndex + 1);
};

const repairCommonLocalJsonDamage = (value: string): string => {
  return value
    .replace(/,\s*([}\]])/g, '$1') // remove trailing commas
    .replace(
      /("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[}\]])\s+(?=[{"\[\d\-tfn])/g,
      '$1,',
    ); // add missing comma between any two consecutive JSON elements
};

const escapeLikelyUnescapedInnerQuotes = (value: string): string => {
  let output = '';
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (!inString) {
      output += char;
      if (char === '"') inString = true;
      continue;
    }

    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      output += char;
      escaped = true;
      continue;
    }

    if (char !== '"') {
      output += char;
      continue;
    }

    const rest = value.slice(index + 1);
    const closesString =
      /^\s*[,}\]:]/.test(rest) || /^\s*"[-A-Za-z0-9_]+":/.test(rest);
    if (!closesString) {
      output += '\\"';
      continue;
    }

    output += char;
    inString = false;
  }

  return output;
};

export const parseKnowledgeJsonResponse = (raw: string): unknown => {
  const cleaned = extractJsonObject(stripMarkdownFence(raw));

  try {
    return JSON.parse(cleaned);
  } catch (initialError) {
    const repaired = repairCommonLocalJsonDamage(
      escapeLikelyUnescapedInnerQuotes(cleaned),
    );
    try {
      return JSON.parse(repaired);
    } catch {
      throw initialError;
    }
  }
};
