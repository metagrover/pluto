export interface AskPlutoSelfReference {
  refersToSelf: boolean;
  asksIdentity: boolean;
  retrievalQuery: string;
}

const PERSONAL_TOPIC =
  /\b(?:contribut\w*|work\w*|say|said|ask\w*|decid\w*|do|did|done|assign\w*|action items?|responsib\w*|role|feedback|strength\w*|weakness\w*|priorit\w*|own\w*|task\w*|mention\w*|participat\w*|achiev\w*|accomplish\w*)\b/i;
const SELF_PRONOUN = /\b(?:i|me|my|mine|myself)\b/i;
const IDENTITY_QUESTION =
  /^(?:who am i|what(?:'s| is) my name|do you know who i am)[?.!]*$/i;
const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const mentionsName = (query: string, name: string): boolean => {
  const normalizedName = name.trim().toLocaleLowerCase();
  if (normalizedName.length < 2) return false;
  const normalizedQuery = query.toLocaleLowerCase();
  let index = normalizedQuery.indexOf(normalizedName);
  while (index >= 0) {
    const before = normalizedQuery[index - 1];
    const after = normalizedQuery[index + normalizedName.length];
    if (
      (!before || !/[\p{L}\p{N}]/u.test(before)) &&
      (!after || !/[\p{L}\p{N}]/u.test(after))
    )
      return true;
    index = normalizedQuery.indexOf(
      normalizedName,
      index + normalizedName.length,
    );
  }
  return false;
};

export const resolveAskPlutoSelfReference = (
  query: string,
  selfName?: string,
  aliases: string[] = [],
): AskPlutoSelfReference => {
  const asksIdentity = IDENTITY_QUESTION.test(query.trim());
  const personalPronoun =
    (SELF_PRONOUN.test(query) && PERSONAL_TOPIC.test(query)) ||
    /\b(?:about|to|for)\s+me\b/i.test(query);
  const namedSelf = mentionsName(query, selfName || '');
  const namedAlias = aliases.find((alias) => mentionsName(query, alias));
  const refersToSelf =
    asksIdentity || personalPronoun || namedSelf || Boolean(namedAlias);
  if (!refersToSelf || !selfName?.trim()) {
    return { refersToSelf, asksIdentity, retrievalQuery: query };
  }
  const name = selfName.trim();
  const normalizedQuery =
    namedAlias && !namedSelf
      ? query.replace(
          new RegExp(
            `(^|[^\\p{L}\\p{N}])${escapeRegExp(namedAlias)}(?![\\p{L}\\p{N}])`,
            'giu',
          ),
          (_, prefix: string) => `${prefix}${name}`,
        )
      : query;
  return {
    refersToSelf,
    asksIdentity,
    retrievalQuery: normalizedQuery
      .replace(/\bmy\b/gi, `${name}'s`)
      .replace(/\b(?:me|myself)\b/gi, name)
      .replace(/\bmine\b/gi, `${name}'s`)
      .replace(/\bI\b/g, name),
  };
};

export const addressConfirmedSelf = (
  answer: string,
  selfName?: string,
): string => {
  if (!selfName?.trim()) return answer;
  const name = escapeRegExp(selfName.trim());
  return answer
    .replace(
      new RegExp(`(^|[^\\p{L}\\p{N}])${name}(['’]s)?(?![\\p{L}\\p{N}])`, 'giu'),
      (
        _match,
        prefix: string,
        possessive: string | undefined,
        offset: number,
      ) => {
        const before = answer.slice(0, offset + prefix.length);
        const capitalized = /(?:^|[.!?]\s+|\n\s*(?:[-*]\s+)?)$/.test(before);
        return `${prefix}${possessive ? (capitalized ? 'Your' : 'your') : capitalized ? 'You' : 'you'}`;
      },
    )
    .replace(/\b([Yy]ou) is\b/g, '$1 are')
    .replace(/\b([Yy]ou) has\b/g, '$1 have')
    .replace(/\b([Yy]ou) was\b/g, '$1 were')
    .replace(/\b([Yy]ou) does\b/g, '$1 do');
};
