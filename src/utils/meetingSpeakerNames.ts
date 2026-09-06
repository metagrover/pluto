export type MeetingSpeakerIdentity = {
  people?: Array<{ id: string; name: string }>;
  bindings?: Array<{ speaker: string; personId?: string | null }>;
  profile?: { preferredName?: string | null } | null;
  selfPersonId?: string | null;
};

export const extractSpeakerDisplayNames = (
  identity: MeetingSpeakerIdentity | null | undefined,
): Record<string, string> => {
  if (
    !identity ||
    !Array.isArray(identity.people) ||
    !Array.isArray(identity.bindings)
  ) {
    return {};
  }
  const peopleById = new Map(
    identity.people.map((person) => [person.id, person.name]),
  );
  const names: Record<string, string> = Object.fromEntries(
    identity.bindings.flatMap((binding) => {
      const name = binding.personId
        ? peopleById.get(binding.personId)?.trim()
        : '';
      return name ? [[binding.speaker, name]] : [];
    }),
  );
  if (!names.Me) {
    const preferredName = identity.profile?.preferredName?.trim();
    if (preferredName) {
      names.Me = preferredName;
    } else if (identity.selfPersonId) {
      const selfName = peopleById.get(identity.selfPersonId)?.trim();
      if (selfName) names.Me = selfName;
    }
  }
  return names;
};
