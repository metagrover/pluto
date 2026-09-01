import { desc, sql } from 'drizzle-orm';
import {
  check,
  customType,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const datetime = customType<{ data: string }>({
  dataType: () => 'datetime',
});
const bool = customType<{ data: number }>({
  dataType: () => 'boolean',
});
const now = sql`CURRENT_TIMESTAMP`;

export const meetings = sqliteTable('meetings', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  meetingType: text('meeting_type'),
  startedAt: datetime('started_at'),
  endedAt: datetime('ended_at'),
  durationSeconds: integer('duration_seconds'),
  audioPath: text('audio_path'),
  transcriptJson: text('transcript_json'),
  userNotes: text('user_notes'),
  enhancedNotes: text('enhanced_notes'),
  analysisJson: text('analysis_json'),
  analysisSchemaVersion: integer('analysis_schema_version'),
  analysisFormatPass: bool('analysis_format_pass'),
  analysisRetryCount: integer('analysis_retry_count').default(0),
  analysisFallbackUsed: bool('analysis_fallback_used').default(0),
  analysisProvider: text('analysis_provider'),
  analysisModel: text('analysis_model'),
  analysisGenerationPath: text('analysis_generation_path'),
  analysisPromptVersion: text('analysis_prompt_version'),
  analysisGeneratedAt: datetime('analysis_generated_at'),
  analysisErrorCategoriesJson: text('analysis_error_categories_json'),
  valueSignalsJson: text('value_signals_json'),
  followUpDraftsJson: text('follow_up_drafts_json'),
  transcriptStatus: text('transcript_status').default('provisional'),
  transcriptIntegrityJson: text('transcript_integrity_json'),
  systemAudioPath: text('system_audio_path'),
  mixedAudioPath: text('mixed_audio_path'),
  transcriptValidatedAt: datetime('transcript_validated_at'),
  finalizationStatus: text('finalization_status')
    .notNull()
    .default('finalized'),
  finalizationErrorCategory: text('finalization_error_category'),
  downstreamProcessingJson: text('downstream_processing_json'),
  captureJournalGeneration: text('capture_journal_generation'),
  userEditsJson: text('user_edits_json'),
  analysisEditConflictsJson: text('analysis_edit_conflicts_json'),
  folderId: text('folder_id'),
  isFavorite: bool('is_favorite').default(0),
  createdAt: datetime('created_at').default(now),
  endReason: text('end_reason'),
  midJson: text('mid_json'),
});

export const meetingAnalysisRuns = sqliteTable('meeting_analysis_runs', {
  meetingId: text('meeting_id').primaryKey(),
  runId: text('run_id').notNull(),
  inputRevision: text('input_revision').notNull(),
  sourceRevision: text('source_revision').notNull(),
  eligibilityRevision: text('eligibility_revision').notNull(),
  userNotesHash: text('user_notes_hash').notNull(),
  notesStatus: text('notes_status').notNull(),
  secondaryStatus: text('secondary_status').notNull(),
  stage: text('stage').notNull(),
  queuePosition: integer('queue_position'),
  errorCode: text('error_code'),
  startedAt: text('started_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const meetingAnalysisRunHistory = sqliteTable(
  'meeting_analysis_run_history',
  {
    runId: text('run_id').primaryKey(),
    meetingId: text('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    status: text('status').notNull(),
    metricsJson: text('metrics_json').notNull(),
    startedAt: text('started_at').notNull(),
    completedAt: text('completed_at'),
  },
  (table) => [
    index('idx_meeting_analysis_run_history_completed').on(
      desc(table.completedAt),
    ),
  ],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value'),
});

export const entities = sqliteTable(
  'entities',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    name: text('name').notNull(),
    normalizedName: text('normalized_name'),
    status: text('status'),
    dueDate: datetime('due_date'),
    assignedTo: text('assigned_to'),
    metadata: text('metadata'),
    saliencyScore: real('saliency_score').default(1),
    domainTag: text('domain_tag').default('work'),
    createdAt: datetime('created_at').default(now),
    updatedAt: datetime('updated_at').default(now),
  },
  (table) => [
    check(
      'entities_type_check',
      sql`${table.type} IN ('person', 'topic', 'action_item', 'decision', 'project')`,
    ),
    check(
      'entities_status_check',
      sql`${table.status} IN ('active', 'completed', 'stale', 'overdue') OR ${table.status} IS NULL`,
    ),
    index('idx_entities_type').on(table.type),
    index('idx_entities_normalized_name').on(table.normalizedName),
    index('idx_entities_status').on(table.status),
  ],
);

export const commitmentAliases = sqliteTable('commitment_aliases', {
  extractionId: text('extraction_id').primaryKey(),
  canonicalId: text('canonical_id')
    .notNull()
    .references(() => entities.id, { onDelete: 'cascade' }),
  meetingId: text('meeting_id')
    .notNull()
    .references(() => meetings.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  reason: text('reason').notNull(),
  originalJson: text('original_json'),
  associationInserted: integer('association_inserted').notNull().default(0),
  active: integer('active').notNull().default(1),
  createdAt: text('created_at').notNull().default(now),
  restoredAt: text('restored_at'),
});

export const projectAliases = sqliteTable(
  'project_aliases',
  {
    projectId: text('project_id')
      .primaryKey()
      .references(() => entities.id, { onDelete: 'cascade' }),
    canonicalId: text('canonical_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    movedAliasesJson: text('moved_aliases_json'),
    active: integer('active').notNull().default(1),
    createdAt: text('created_at').notNull().default(now),
    restoredAt: text('restored_at'),
  },
  (table) => [
    index('idx_project_aliases_canonical').on(table.canonicalId, table.active),
  ],
);

export const personAliases = sqliteTable(
  'person_aliases',
  {
    personId: text('person_id')
      .primaryKey()
      .references(() => entities.id, { onDelete: 'cascade' }),
    canonicalId: text('canonical_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    movedAliasesJson: text('moved_aliases_json'),
    active: integer('active').notNull().default(1),
    createdAt: text('created_at').notNull().default(now),
    restoredAt: text('restored_at'),
  },
  (table) => [
    index('idx_person_aliases_canonical').on(table.canonicalId, table.active),
  ],
);

export const personNameAliases = sqliteTable(
  'person_name_aliases',
  {
    personId: text('person_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    normalizedName: text('normalized_name').notNull(),
    displayName: text('display_name').notNull(),
    source: text('source').notNull(),
    createdAt: text('created_at').notNull().default(now),
  },
  (table) => [
    primaryKey({ columns: [table.personId, table.normalizedName] }),
    check(
      'person_name_aliases_source_check',
      sql`${table.source} IN ('rename', 'user')`,
    ),
    index('idx_person_name_aliases_name').on(table.normalizedName),
  ],
);

export const attentionItems = sqliteTable(
  'attention_items',
  {
    id: text('id').primaryKey(),
    dedupeKey: text('dedupe_key').notNull().unique(),
    kind: text('kind').notNull(),
    severity: text('severity').notNull(),
    score: real('score').notNull().default(0),
    status: text('status').notNull().default('active'),
    title: text('title').notNull(),
    reason: text('reason').notNull(),
    source: text('source').notNull(),
    scoreBreakdownJson: text('score_breakdown_json'),
    evidenceJson: text('evidence_json'),
    relatedEntityIdsJson: text('related_entity_ids_json'),
    relatedStreamIdsJson: text('related_stream_ids_json'),
    relatedMeetingIdsJson: text('related_meeting_ids_json'),
    createdAt: datetime('created_at').default(now),
    updatedAt: datetime('updated_at').default(now),
    lastSeenAt: datetime('last_seen_at').default(now),
    resolvedAt: datetime('resolved_at'),
  },
  (table) => [
    index('idx_attention_items_status').on(table.status),
    index('idx_attention_items_score').on(desc(table.score)),
    index('idx_attention_items_updated_at').on(desc(table.updatedAt)),
  ],
);

export const workingMemorySnapshots = sqliteTable(
  'working_memory_snapshots',
  {
    id: text('id').primaryKey(),
    scopeType: text('scope_type').notNull(),
    scopeKey: text('scope_key').notNull(),
    title: text('title').notNull(),
    sourceDocId: text('source_doc_id').notNull(),
    sourceDocLastSynthesizedAt: datetime('source_doc_last_synthesized_at'),
    freshness: text('freshness').notNull(),
    trustStatus: text('trust_status').notNull(),
    sourceCount: integer('source_count').notNull().default(0),
    citedMeetingCount: integer('cited_meeting_count').notNull().default(0),
    payloadJson: text('payload_json').notNull(),
    generatedAt: datetime('generated_at').notNull(),
    updatedAt: datetime('updated_at').notNull(),
  },
  (table) => [
    unique('working_memory_snapshots_scope_unique').on(
      table.scopeType,
      table.scopeKey,
    ),
    index('idx_working_memory_snapshots_scope').on(
      table.scopeType,
      table.scopeKey,
    ),
    index('idx_working_memory_snapshots_generated_at').on(
      desc(table.generatedAt),
    ),
  ],
);

export const meetingContextEvents = sqliteTable(
  'meeting_context_events',
  {
    id: text('id').primaryKey(),
    meetingId: text('meeting_id').notNull(),
    eventKey: text('event_key').notNull(),
    kind: text('kind').notNull(),
    summary: text('summary').notNull(),
    evidenceJson: text('evidence_json').notNull(),
    attributesJson: text('attributes_json'),
    supersedesEventId: text('supersedes_event_id'),
    observedAtMs: integer('observed_at_ms').notNull(),
    createdAt: datetime('created_at').notNull(),
  },
  (table) => [
    unique('meeting_context_events_meeting_event_unique').on(
      table.meetingId,
      table.eventKey,
    ),
    index('idx_meeting_context_events_timeline').on(
      table.meetingId,
      table.observedAtMs,
      table.createdAt,
    ),
  ],
);

export const meetingContextSnapshots = sqliteTable(
  'meeting_context_snapshots',
  {
    id: text('id').primaryKey(),
    meetingId: text('meeting_id').notNull(),
    revision: integer('revision').notNull(),
    stateJson: text('state_json').notNull(),
    lastSegmentId: text('last_segment_id'),
    lastSegmentTimestampMs: integer('last_segment_timestamp_ms'),
    generatedAt: datetime('generated_at').notNull(),
    createdAt: datetime('created_at').notNull(),
  },
  (table) => [
    unique('meeting_context_snapshots_meeting_revision_unique').on(
      table.meetingId,
      table.revision,
    ),
    index('idx_meeting_context_snapshots_revision').on(
      table.meetingId,
      desc(table.revision),
    ),
  ],
);

export const entityLinks = sqliteTable(
  'entity_links',
  {
    id: text('id').primaryKey(),
    sourceEntityId: text('source_entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    targetEntityId: text('target_entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    relationship: text('relationship').notNull(),
    meetingId: text('meeting_id').references(() => meetings.id, {
      onDelete: 'set null',
    }),
    state: text('state').notNull().default('suggested'),
    evidenceMeetingId: text('evidence_meeting_id').references(
      () => meetings.id,
      { onDelete: 'set null' },
    ),
    evidenceQuote: text('evidence_quote'),
    source: text('source').notNull().default('pipeline'),
    confidence: real('confidence').default(1),
    createdAt: datetime('created_at').default(now),
    updatedAt: datetime('updated_at').default(now),
  },
  (table) => [
    check(
      'entity_links_relationship_check',
      sql`${table.relationship} IN ('discussed','assigned_to','belongs_to','relates_to','attended','produced','impacts','works_on','involved_in','depends_on','blocked_by','owns')`,
    ),
    check(
      'entity_links_state_check',
      sql`${table.state} IN ('suggested','confirmed','rejected')`,
    ),
    check(
      'entity_links_source_check',
      sql`${table.source} IN ('pipeline','synthesis','user')`,
    ),
    index('idx_entity_links_source').on(table.sourceEntityId),
    index('idx_entity_links_target').on(table.targetEntityId),
    index('idx_entity_links_meeting').on(table.meetingId),
    index('idx_entity_links_pair_rel').on(
      table.sourceEntityId,
      table.targetEntityId,
      table.relationship,
    ),
    index('idx_entity_links_state_relationship').on(
      table.state,
      table.relationship,
    ),
    index('idx_entity_links_evidence_meeting').on(table.evidenceMeetingId),
    index('idx_entity_links_confirmed_source')
      .on(table.sourceEntityId)
      .where(sql`${table.state} = 'confirmed'`),
    index('idx_entity_links_confirmed_target')
      .on(table.targetEntityId)
      .where(sql`${table.state} = 'confirmed'`),
  ],
);

export const meetingEntities = sqliteTable(
  'meeting_entities',
  {
    meetingId: text('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    entityId: text('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    mentionCount: integer('mention_count').default(1),
    firstMentionedAt: integer('first_mentioned_at'),
    context: text('context'),
    createdAt: datetime('created_at').default(now),
  },
  (table) => [primaryKey({ columns: [table.meetingId, table.entityId] })],
);

export const knowledgeDocs = sqliteTable(
  'knowledge_docs',
  {
    id: text('id').primaryKey(),
    scopeType: text('scope_type').notNull(),
    scopeKey: text('scope_key').notNull(),
    title: text('title').notNull(),
    renderedContent: text('rendered_content'),
    structuredJson: text('structured_json'),
    config: text('config'),
    status: text('status').notNull().default('stale'),
    lastSynthesizedAt: datetime('last_synthesized_at'),
    lastSourceCursor: text('last_source_cursor'),
    updatedAt: datetime('updated_at').default(now),
  },
  (table) => [
    check(
      'knowledge_docs_scope_type_check',
      sql`${table.scopeType} IN ('global','project','team_tracker','person_context')`,
    ),
    check(
      'knowledge_docs_status_check',
      sql`${table.status} IN ('synthesizing','up_to_date','stale','failed','inactive')`,
    ),
    uniqueIndex('idx_knowledge_docs_scope').on(table.scopeType, table.scopeKey),
    index('idx_knowledge_docs_updated_at').on(desc(table.updatedAt)),
  ],
);

export const knowledgeDocSources = sqliteTable(
  'knowledge_doc_sources',
  {
    docId: text('doc_id')
      .notNull()
      .references(() => knowledgeDocs.id, { onDelete: 'cascade' }),
    meetingId: text('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    contributedAt: datetime('contributed_at').default(now),
  },
  (table) => [
    primaryKey({ columns: [table.docId, table.meetingId] }),
    index('idx_knowledge_doc_sources_doc').on(
      table.docId,
      desc(table.contributedAt),
    ),
    index('idx_knowledge_doc_sources_meeting').on(table.meetingId),
  ],
);

export const knowledgeDocVersions = sqliteTable(
  'knowledge_doc_versions',
  {
    docId: text('doc_id')
      .notNull()
      .references(() => knowledgeDocs.id, { onDelete: 'cascade' }),
    versionNo: integer('version_no').notNull(),
    structuredJson: text('structured_json'),
    renderedContent: text('rendered_content'),
    changelogJson: text('changelog_json'),
    synthesizedAt: datetime('synthesized_at').default(now),
    sourceCount: integer('source_count').default(0),
  },
  (table) => [
    primaryKey({ columns: [table.docId, table.versionNo] }),
    index('idx_knowledge_doc_versions_doc').on(
      table.docId,
      desc(table.versionNo),
    ),
  ],
);

export const knowledgeDocUserEdits = sqliteTable(
  'knowledge_doc_user_edits',
  {
    id: text('id').primaryKey(),
    docId: text('doc_id')
      .notNull()
      .references(() => knowledgeDocs.id, { onDelete: 'cascade' }),
    editedContent: text('edited_content').notNull(),
    editedAt: datetime('edited_at').default(now),
    editedBy: text('edited_by').default('local-user'),
  },
  (table) => [
    index('idx_knowledge_doc_user_edits_doc').on(
      table.docId,
      desc(table.editedAt),
    ),
  ],
);

export const knowledgeDocNotes = sqliteTable(
  'knowledge_doc_notes',
  {
    docId: text('doc_id')
      .primaryKey()
      .references(() => knowledgeDocs.id, { onDelete: 'cascade' }),
    markdown: text('markdown').notNull().default(''),
    parsedLinksJson: text('parsed_links_json'),
    updatedAt: datetime('updated_at').default(now),
  },
  (table) => [
    index('idx_knowledge_doc_notes_updated_at').on(desc(table.updatedAt)),
  ],
);

export const knowledgeCorrections = sqliteTable(
  'knowledge_corrections',
  {
    id: text('id').primaryKey(),
    docId: text('doc_id')
      .notNull()
      .references(() => knowledgeDocs.id, { onDelete: 'cascade' }),
    targetKind: text('target_kind').notNull(),
    targetId: text('target_id').notNull(),
    action: text('action').notNull(),
    payloadJson: text('payload_json'),
    createdAt: datetime('created_at').default(now),
  },
  (table) => [
    check(
      'knowledge_corrections_target_kind_check',
      sql`${table.targetKind} IN ('source','stream','item','claim')`,
    ),
    check(
      'knowledge_corrections_action_check',
      sql`${table.action} IN ('exclude_source','rename_stream','merge_stream','split_stream','pin_stream','promote_item','demote_item','correct_classification','correct_claim')`,
    ),
    index('idx_knowledge_corrections_doc').on(
      table.docId,
      desc(table.createdAt),
    ),
    index('idx_knowledge_corrections_target').on(
      table.docId,
      table.targetKind,
      table.targetId,
    ),
  ],
);

export const knowledgeBacklinks = sqliteTable(
  'knowledge_backlinks',
  {
    id: text('id').primaryKey(),
    sourceDocId: text('source_doc_id')
      .notNull()
      .references(() => knowledgeDocs.id, { onDelete: 'cascade' }),
    targetKind: text('target_kind').notNull(),
    targetId: text('target_id').notNull(),
    label: text('label').notNull(),
    snippet: text('snippet'),
    createdAt: datetime('created_at').default(now),
  },
  (table) => [
    check(
      'knowledge_backlinks_target_kind_check',
      sql`${table.targetKind} IN ('entity','doc')`,
    ),
    index('idx_knowledge_backlinks_source').on(table.sourceDocId),
    index('idx_knowledge_backlinks_target').on(
      table.targetKind,
      table.targetId,
    ),
  ],
);

export const autoEndLog = sqliteTable(
  'auto_end_log',
  {
    id: text('id').primaryKey(),
    meetingId: text('meeting_id').references(() => meetings.id, {
      onDelete: 'cascade',
    }),
    timestamp: datetime('timestamp').default(now),
    reasonCode: text('reason_code').notNull(),
    appName: text('app_name'),
    graceSeconds: integer('grace_seconds'),
  },
  (table) => [index('idx_auto_end_log_meeting').on(table.meetingId)],
);

export const calendarIntegration = sqliteTable(
  'calendar_integration',
  {
    singleton: integer('singleton').primaryKey(),
    enabled: integer('enabled').notNull().default(0),
    selectedCalendarJson: text('selected_calendar_json'),
    cacheRevision: integer('cache_revision').notNull().default(0),
    lastAttemptAt: text('last_attempt_at'),
    lastReadAt: text('last_read_at'),
    cacheStart: text('cache_start'),
    cacheEnd: text('cache_end'),
    errorCode: text('error_code'),
  },
  (table) => [
    check('calendar_integration_singleton_check', sql`${table.singleton} = 1`),
  ],
);

export const calendarEvents = sqliteTable(
  'calendar_events',
  {
    occurrenceKey: text('occurrence_key').primaryKey(),
    calendarIdentifier: text('calendar_identifier').notNull(),
    startsAt: text('starts_at').notNull(),
    endsAt: text('ends_at').notNull(),
    isAllDay: integer('is_all_day').notNull(),
    isCancelled: integer('is_cancelled').notNull(),
    eventJson: text('event_json').notNull(),
  },
  (table) => [
    index('idx_calendar_events_window').on(table.startsAt, table.endsAt),
  ],
);

export const meetingCalendarContext = sqliteTable(
  'meeting_calendar_context',
  {
    meetingId: text('meeting_id')
      .primaryKey()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    occurrenceKey: text('occurrence_key').notNull(),
    calendarTitle: text('calendar_title').notNull(),
    eventJson: text('event_json').notNull(),
    matchOrigin: text('match_origin').notNull(),
    matchEvidence: text('match_evidence').notNull(),
    cacheRevision: integer('cache_revision').notNull(),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (table) => [
    check(
      'meeting_calendar_context_origin_check',
      sql`${table.matchOrigin} IN ('automatic','user')`,
    ),
    check(
      'meeting_calendar_context_evidence_check',
      sql`${table.matchEvidence} IN ('time_overlap','user_selected')`,
    ),
  ],
);

export const identityWorkspace = sqliteTable(
  'identity_workspace',
  {
    singleton: integer('singleton').primaryKey(),
    selfPersonId: text('self_person_id'),
    revision: integer('revision').notNull().default(0),
  },
  (table) => [
    check('identity_workspace_singleton_check', sql`${table.singleton} = 1`),
  ],
);

export const identityProfiles = sqliteTable(
  'identity_profiles',
  {
    singleton: integer('singleton').primaryKey(),
    payload: text('payload').notNull(),
  },
  (table) => [
    check('identity_profiles_singleton_check', sql`${table.singleton} = 1`),
  ],
);

export const identityPersonAliases = sqliteTable('identity_person_aliases', {
  personId: text('person_id')
    .primaryKey()
    .references(() => entities.id, { onDelete: 'cascade' }),
  aliasesJson: text('aliases_json').notNull(),
});

export const identityCaptures = sqliteTable('identity_captures', {
  meetingId: text('meeting_id').primaryKey(),
  origin: text('origin').notNull(),
  selfPersonId: text('self_person_id'),
});

export const identityBindings = sqliteTable(
  'identity_bindings',
  {
    meetingId: text('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    speaker: text('speaker').notNull(),
    payload: text('payload').notNull(),
  },
  (table) => [primaryKey({ columns: [table.meetingId, table.speaker] })],
);

export const identityResolutions = sqliteTable(
  'identity_resolutions',
  {
    actionId: text('action_id').primaryKey(),
    fingerprint: text('fingerprint').notNull(),
    payload: text('payload').notNull(),
    meetingId: text('meeting_id'),
  },
  (table) => [index('idx_identity_resolutions_meeting').on(table.meetingId)],
);

export const identityResolutionHistory = sqliteTable(
  'identity_resolution_history',
  {
    actionId: text('action_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    payload: text('payload').notNull(),
    meetingId: text('meeting_id'),
  },
  (table) => [
    primaryKey({ columns: [table.actionId, table.fingerprint] }),
    index('idx_identity_resolution_history_meeting').on(table.meetingId),
  ],
);

export const identityJobs = sqliteTable('identity_jobs', {
  meetingId: text('meeting_id')
    .primaryKey()
    .references(() => meetings.id, { onDelete: 'cascade' }),
  revision: integer('revision').notNull(),
  fingerprint: text('fingerprint').notNull(),
  cursor: text('cursor'),
  state: text('state').notNull(),
  attempts: integer('attempts').notNull().default(0),
  error: text('error'),
  nextAttemptAt: integer('next_attempt_at').notNull().default(0),
});

export const identityInputRevision = sqliteTable('identity_input_revision', {
  singleton: integer('singleton').primaryKey(),
  revision: integer('revision').notNull(),
});
