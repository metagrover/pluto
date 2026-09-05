CREATE TABLE `attention_items` (
	`id` text PRIMARY KEY NOT NULL,
	`dedupe_key` text NOT NULL,
	`kind` text NOT NULL,
	`severity` text NOT NULL,
	`score` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`title` text NOT NULL,
	`reason` text NOT NULL,
	`source` text NOT NULL,
	`score_breakdown_json` text,
	`evidence_json` text,
	`related_entity_ids_json` text,
	`related_stream_ids_json` text,
	`related_meeting_ids_json` text,
	`created_at` datetime DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
	`last_seen_at` datetime DEFAULT CURRENT_TIMESTAMP,
	`resolved_at` datetime
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attention_items_dedupe_key_unique` ON `attention_items` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `idx_attention_items_status` ON `attention_items` (`status`);--> statement-breakpoint
CREATE INDEX `idx_attention_items_score` ON `attention_items` ("score" desc);--> statement-breakpoint
CREATE INDEX `idx_attention_items_updated_at` ON `attention_items` ("updated_at" desc);--> statement-breakpoint
CREATE TABLE `auto_end_log` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text,
	`timestamp` datetime DEFAULT CURRENT_TIMESTAMP,
	`reason_code` text NOT NULL,
	`app_name` text,
	`grace_seconds` integer,
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_auto_end_log_meeting` ON `auto_end_log` (`meeting_id`);--> statement-breakpoint
CREATE TABLE `calendar_events` (
	`occurrence_key` text PRIMARY KEY NOT NULL,
	`calendar_identifier` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`is_all_day` integer NOT NULL,
	`is_cancelled` integer NOT NULL,
	`event_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_calendar_events_window` ON `calendar_events` (`starts_at`,`ends_at`);--> statement-breakpoint
CREATE TABLE `calendar_integration` (
	`singleton` integer PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`selected_calendar_json` text,
	`selected_calendars_json` text,
	`cache_revision` integer DEFAULT 0 NOT NULL,
	`last_attempt_at` text,
	`last_read_at` text,
	`cache_start` text,
	`cache_end` text,
	`error_code` text,
	CONSTRAINT "calendar_integration_singleton_check" CHECK("calendar_integration"."singleton" = 1)
);
--> statement-breakpoint
CREATE TABLE `commitment_aliases` (
	`extraction_id` text PRIMARY KEY NOT NULL,
	`canonical_id` text NOT NULL,
	`meeting_id` text NOT NULL,
	`description` text NOT NULL,
	`reason` text NOT NULL,
	`original_json` text,
	`association_inserted` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`restored_at` text,
	FOREIGN KEY (`canonical_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `entities` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text,
	`status` text,
	`due_date` datetime,
	`assigned_to` text,
	`metadata` text,
	`saliency_score` real DEFAULT 1,
	`domain_tag` text DEFAULT 'work',
	`created_at` datetime DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "entities_type_check" CHECK("entities"."type" IN ('person', 'topic', 'action_item', 'decision', 'project')),
	CONSTRAINT "entities_status_check" CHECK("entities"."status" IN ('active', 'completed', 'stale', 'overdue') OR "entities"."status" IS NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_entities_type` ON `entities` (`type`);--> statement-breakpoint
CREATE INDEX `idx_entities_normalized_name` ON `entities` (`normalized_name`);--> statement-breakpoint
CREATE INDEX `idx_entities_status` ON `entities` (`status`);--> statement-breakpoint
CREATE TABLE `entity_alias_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`suggested_name` text NOT NULL,
	`source_meeting_ids_json` text DEFAULT '[]' NOT NULL,
	`evidence_snippet` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` datetime DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "entity_alias_suggestions_status_check" CHECK("entity_alias_suggestions"."status" IN ('pending','merged','dismissed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_entity_alias_suggestions_unique` ON `entity_alias_suggestions` (`entity_id`,`suggested_name`);--> statement-breakpoint
CREATE INDEX `idx_entity_alias_suggestions_lookup` ON `entity_alias_suggestions` (`entity_id`,`status`);--> statement-breakpoint
CREATE TABLE `entity_corrections` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`item_type` text NOT NULL,
	`fingerprint` text NOT NULL,
	`reason` text,
	`created_at` datetime DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_entity_corrections_unique` ON `entity_corrections` (`entity_id`,`item_type`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `idx_entity_corrections_lookup` ON `entity_corrections` (`entity_id`,"created_at" desc);--> statement-breakpoint
CREATE TABLE `entity_dreaming_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`proposal_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`normalized_name` text NOT NULL,
	`display_name` text NOT NULL,
	`source` text NOT NULL,
	`evidence_json` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`removed_at` text,
	FOREIGN KEY (`proposal_id`) REFERENCES `entity_dreaming_proposals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "entity_dreaming_aliases_entity_type_check" CHECK("entity_dreaming_aliases"."entity_type" IN ('project','person')),
	CONSTRAINT "entity_dreaming_aliases_source_check" CHECK("entity_dreaming_aliases"."source" = 'dreaming'),
	CONSTRAINT "entity_dreaming_aliases_evidence_check" CHECK(json_valid("entity_dreaming_aliases"."evidence_json")),
	CONSTRAINT "entity_dreaming_aliases_active_check" CHECK("entity_dreaming_aliases"."active" IN (0,1)),
	CONSTRAINT "entity_dreaming_aliases_removed_check" CHECK(("entity_dreaming_aliases"."active" = 1 AND "entity_dreaming_aliases"."removed_at" IS NULL) OR ("entity_dreaming_aliases"."active" = 0 AND "entity_dreaming_aliases"."removed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entity_dreaming_aliases_proposal_id_unique` ON `entity_dreaming_aliases` (`proposal_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_entity_dreaming_aliases_active_name` ON `entity_dreaming_aliases` (`entity_type`,`normalized_name`) WHERE "entity_dreaming_aliases"."active" = 1;--> statement-breakpoint
CREATE INDEX `idx_entity_dreaming_aliases_entity` ON `entity_dreaming_aliases` (`entity_id`,`entity_type`,`active`);--> statement-breakpoint
CREATE TABLE `entity_dreaming_person_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`proposal_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`evidence_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`proposal_id`) REFERENCES `entity_dreaming_proposals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "entity_dreaming_person_claims_kind_check" CHECK("entity_dreaming_person_claims"."kind" IN ('person_headline','person_focus','person_collaborator')),
	CONSTRAINT "entity_dreaming_person_claims_evidence_check" CHECK(json_valid("entity_dreaming_person_claims"."evidence_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entity_dreaming_person_claims_proposal_id_unique` ON `entity_dreaming_person_claims` (`proposal_id`);--> statement-breakpoint
CREATE INDEX `idx_entity_dreaming_person_claims_entity` ON `entity_dreaming_person_claims` (`entity_id`,`kind`,`created_at`);--> statement-breakpoint
CREATE TABLE `entity_dreaming_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`kind` text NOT NULL,
	`payload_json` text NOT NULL,
	`evidence_json` text NOT NULL,
	`fingerprint` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `entity_dreaming_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "entity_dreaming_proposals_entity_type_check" CHECK("entity_dreaming_proposals"."entity_type" IN ('project','person')),
	CONSTRAINT "entity_dreaming_proposals_kind_check" CHECK("entity_dreaming_proposals"."kind" IN ('project_summary','project_milestone','project_commitment','project_alias','person_headline','person_focus','person_collaborator','person_alias')),
	CONSTRAINT "entity_dreaming_proposals_payload_check" CHECK(json_valid("entity_dreaming_proposals"."payload_json")),
	CONSTRAINT "entity_dreaming_proposals_evidence_check" CHECK(json_valid("entity_dreaming_proposals"."evidence_json")),
	CONSTRAINT "entity_dreaming_proposals_fingerprint_check" CHECK(length("entity_dreaming_proposals"."fingerprint") > 0),
	CONSTRAINT "entity_dreaming_proposals_status_check" CHECK("entity_dreaming_proposals"."status" IN ('pending','accepted','rejected','stale')),
	CONSTRAINT "entity_dreaming_proposals_decision_check" CHECK(("entity_dreaming_proposals"."status" = 'pending' AND "entity_dreaming_proposals"."decided_at" IS NULL) OR ("entity_dreaming_proposals"."status" <> 'pending' AND "entity_dreaming_proposals"."decided_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `idx_entity_dreaming_proposals_entity_status` ON `entity_dreaming_proposals` (`entity_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_entity_dreaming_proposals_run` ON `entity_dreaming_proposals` (`run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `entity_dreaming_proposals_run_fingerprint_unique` ON `entity_dreaming_proposals` (`run_id`,`fingerprint`);--> statement-breakpoint
CREATE TABLE `entity_dreaming_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`source_revision` text NOT NULL,
	`decision_revision` text,
	`status` text NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`start_mode` text NOT NULL,
	`error_code` text,
	`lease_token` text,
	`started_at` text NOT NULL,
	`completed_at` text,
	`next_retry_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "entity_dreaming_runs_entity_type_check" CHECK("entity_dreaming_runs"."entity_type" IN ('project','person')),
	CONSTRAINT "entity_dreaming_runs_status_check" CHECK("entity_dreaming_runs"."status" IN ('running','no_change','proposed','failed','cancelled')),
	CONSTRAINT "entity_dreaming_runs_attempt_count_check" CHECK("entity_dreaming_runs"."attempt_count" >= 0),
	CONSTRAINT "entity_dreaming_runs_failure_count_check" CHECK("entity_dreaming_runs"."failure_count" >= 0 AND "entity_dreaming_runs"."failure_count" <= "entity_dreaming_runs"."attempt_count"),
	CONSTRAINT "entity_dreaming_runs_start_mode_check" CHECK("entity_dreaming_runs"."start_mode" IN ('automatic','manual')),
	CONSTRAINT "entity_dreaming_runs_error_code_check" CHECK("entity_dreaming_runs"."error_code" IS NULL OR "entity_dreaming_runs"."error_code" IN ('provider_unavailable','generation_failed','validation_failed','persistence_failed','lease_expired')),
	CONSTRAINT "entity_dreaming_runs_lease_check" CHECK(("entity_dreaming_runs"."status" = 'running' AND "entity_dreaming_runs"."lease_token" IS NOT NULL AND "entity_dreaming_runs"."completed_at" IS NULL) OR ("entity_dreaming_runs"."status" <> 'running' AND "entity_dreaming_runs"."lease_token" IS NULL AND "entity_dreaming_runs"."completed_at" IS NOT NULL)),
	CONSTRAINT "entity_dreaming_runs_failure_check" CHECK(("entity_dreaming_runs"."status" = 'failed' AND "entity_dreaming_runs"."error_code" IS NOT NULL) OR ("entity_dreaming_runs"."status" <> 'failed' AND "entity_dreaming_runs"."error_code" IS NULL)),
	CONSTRAINT "entity_dreaming_runs_retry_check" CHECK("entity_dreaming_runs"."next_retry_at" IS NULL OR "entity_dreaming_runs"."status" = 'failed')
);
--> statement-breakpoint
CREATE INDEX `idx_entity_dreaming_runs_status_retry` ON `entity_dreaming_runs` (`status`,`next_retry_at`);--> statement-breakpoint
CREATE INDEX `idx_entity_dreaming_runs_entity_created` ON `entity_dreaming_runs` (`entity_id`,"created_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX `entity_dreaming_runs_entity_revision_unique` ON `entity_dreaming_runs` (`entity_id`,`source_revision`);--> statement-breakpoint
CREATE TABLE `entity_links` (
	`id` text PRIMARY KEY NOT NULL,
	`source_entity_id` text NOT NULL,
	`target_entity_id` text NOT NULL,
	`relationship` text NOT NULL,
	`meeting_id` text,
	`state` text DEFAULT 'suggested' NOT NULL,
	`evidence_meeting_id` text,
	`evidence_quote` text,
	`source` text DEFAULT 'pipeline' NOT NULL,
	`confidence` real DEFAULT 1,
	`created_at` datetime DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`source_entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`evidence_meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "entity_links_relationship_check" CHECK("entity_links"."relationship" IN ('discussed','assigned_to','belongs_to','relates_to','attended','produced','impacts','works_on','involved_in','depends_on','blocked_by','owns')),
	CONSTRAINT "entity_links_state_check" CHECK("entity_links"."state" IN ('suggested','confirmed','rejected')),
	CONSTRAINT "entity_links_source_check" CHECK("entity_links"."source" IN ('pipeline','synthesis','user'))
);
--> statement-breakpoint
CREATE INDEX `idx_entity_links_source` ON `entity_links` (`source_entity_id`);--> statement-breakpoint
CREATE INDEX `idx_entity_links_target` ON `entity_links` (`target_entity_id`);--> statement-breakpoint
CREATE INDEX `idx_entity_links_meeting` ON `entity_links` (`meeting_id`);--> statement-breakpoint
CREATE INDEX `idx_entity_links_pair_rel` ON `entity_links` (`source_entity_id`,`target_entity_id`,`relationship`);--> statement-breakpoint
CREATE INDEX `idx_entity_links_state_relationship` ON `entity_links` (`state`,`relationship`);--> statement-breakpoint
CREATE INDEX `idx_entity_links_evidence_meeting` ON `entity_links` (`evidence_meeting_id`);--> statement-breakpoint
CREATE INDEX `idx_entity_links_confirmed_source` ON `entity_links` (`source_entity_id`) WHERE "entity_links"."state" = 'confirmed';--> statement-breakpoint
CREATE INDEX `idx_entity_links_confirmed_target` ON `entity_links` (`target_entity_id`) WHERE "entity_links"."state" = 'confirmed';--> statement-breakpoint
CREATE TABLE `identity_bindings` (
	`meeting_id` text NOT NULL,
	`speaker` text NOT NULL,
	`payload` text NOT NULL,
	PRIMARY KEY(`meeting_id`, `speaker`),
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `identity_captures` (
	`meeting_id` text PRIMARY KEY NOT NULL,
	`origin` text NOT NULL,
	`self_person_id` text
);
--> statement-breakpoint
CREATE TABLE `identity_input_revision` (
	`singleton` integer PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `identity_jobs` (
	`meeting_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`fingerprint` text NOT NULL,
	`cursor` text,
	`state` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	`next_attempt_at` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `identity_person_aliases` (
	`person_id` text PRIMARY KEY NOT NULL,
	`aliases_json` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `identity_profiles` (
	`singleton` integer PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	CONSTRAINT "identity_profiles_singleton_check" CHECK("identity_profiles"."singleton" = 1)
);
--> statement-breakpoint
CREATE TABLE `identity_resolution_history` (
	`action_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`payload` text NOT NULL,
	`meeting_id` text,
	PRIMARY KEY(`action_id`, `fingerprint`)
);
--> statement-breakpoint
CREATE INDEX `idx_identity_resolution_history_meeting` ON `identity_resolution_history` (`meeting_id`);--> statement-breakpoint
CREATE TABLE `identity_resolutions` (
	`action_id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`payload` text NOT NULL,
	`meeting_id` text
);
--> statement-breakpoint
CREATE INDEX `idx_identity_resolutions_meeting` ON `identity_resolutions` (`meeting_id`);--> statement-breakpoint
CREATE TABLE `identity_workspace` (
	`singleton` integer PRIMARY KEY NOT NULL,
	`self_person_id` text,
	`revision` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "identity_workspace_singleton_check" CHECK("identity_workspace"."singleton" = 1)
);
--> statement-breakpoint
CREATE TABLE `knowledge_backlinks` (
	`id` text PRIMARY KEY NOT NULL,
	`source_doc_id` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`label` text NOT NULL,
	`snippet` text,
	`created_at` datetime DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`source_doc_id`) REFERENCES `knowledge_docs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "knowledge_backlinks_target_kind_check" CHECK("knowledge_backlinks"."target_kind" IN ('entity','doc'))
);
--> statement-breakpoint
CREATE INDEX `idx_knowledge_backlinks_source` ON `knowledge_backlinks` (`source_doc_id`);--> statement-breakpoint
CREATE INDEX `idx_knowledge_backlinks_target` ON `knowledge_backlinks` (`target_kind`,`target_id`);--> statement-breakpoint
CREATE TABLE `knowledge_corrections` (
	`id` text PRIMARY KEY NOT NULL,
	`doc_id` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`action` text NOT NULL,
	`payload_json` text,
	`created_at` datetime DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`doc_id`) REFERENCES `knowledge_docs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "knowledge_corrections_target_kind_check" CHECK("knowledge_corrections"."target_kind" IN ('source','stream','item','claim')),
	CONSTRAINT "knowledge_corrections_action_check" CHECK("knowledge_corrections"."action" IN ('exclude_source','rename_stream','merge_stream','split_stream','pin_stream','promote_item','demote_item','correct_classification','correct_claim'))
);
--> statement-breakpoint
CREATE INDEX `idx_knowledge_corrections_doc` ON `knowledge_corrections` (`doc_id`,"created_at" desc);--> statement-breakpoint
CREATE INDEX `idx_knowledge_corrections_target` ON `knowledge_corrections` (`doc_id`,`target_kind`,`target_id`);--> statement-breakpoint
CREATE TABLE `knowledge_doc_notes` (
	`doc_id` text PRIMARY KEY NOT NULL,
	`markdown` text DEFAULT '' NOT NULL,
	`parsed_links_json` text,
	`updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`doc_id`) REFERENCES `knowledge_docs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_knowledge_doc_notes_updated_at` ON `knowledge_doc_notes` ("updated_at" desc);--> statement-breakpoint
CREATE TABLE `knowledge_doc_sources` (
	`doc_id` text NOT NULL,
	`meeting_id` text NOT NULL,
	`contributed_at` datetime DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY(`doc_id`, `meeting_id`),
	FOREIGN KEY (`doc_id`) REFERENCES `knowledge_docs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_knowledge_doc_sources_doc` ON `knowledge_doc_sources` (`doc_id`,"contributed_at" desc);--> statement-breakpoint
CREATE INDEX `idx_knowledge_doc_sources_meeting` ON `knowledge_doc_sources` (`meeting_id`);--> statement-breakpoint
CREATE TABLE `knowledge_doc_user_edits` (
	`id` text PRIMARY KEY NOT NULL,
	`doc_id` text NOT NULL,
	`edited_content` text NOT NULL,
	`edited_at` datetime DEFAULT CURRENT_TIMESTAMP,
	`edited_by` text DEFAULT 'local-user',
	FOREIGN KEY (`doc_id`) REFERENCES `knowledge_docs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_knowledge_doc_user_edits_doc` ON `knowledge_doc_user_edits` (`doc_id`,"edited_at" desc);--> statement-breakpoint
CREATE TABLE `knowledge_doc_versions` (
	`doc_id` text NOT NULL,
	`version_no` integer NOT NULL,
	`structured_json` text,
	`rendered_content` text,
	`changelog_json` text,
	`synthesized_at` datetime DEFAULT CURRENT_TIMESTAMP,
	`source_count` integer DEFAULT 0,
	PRIMARY KEY(`doc_id`, `version_no`),
	FOREIGN KEY (`doc_id`) REFERENCES `knowledge_docs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_knowledge_doc_versions_doc` ON `knowledge_doc_versions` (`doc_id`,"version_no" desc);--> statement-breakpoint
CREATE TABLE `knowledge_docs` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_type` text NOT NULL,
	`scope_key` text NOT NULL,
	`title` text NOT NULL,
	`rendered_content` text,
	`structured_json` text,
	`config` text,
	`status` text DEFAULT 'stale' NOT NULL,
	`last_synthesized_at` datetime,
	`last_source_cursor` text,
	`updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "knowledge_docs_scope_type_check" CHECK("knowledge_docs"."scope_type" IN ('global','project','team_tracker','person_context')),
	CONSTRAINT "knowledge_docs_status_check" CHECK("knowledge_docs"."status" IN ('synthesizing','up_to_date','stale','failed','inactive'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_knowledge_docs_scope` ON `knowledge_docs` (`scope_type`,`scope_key`);--> statement-breakpoint
CREATE INDEX `idx_knowledge_docs_updated_at` ON `knowledge_docs` ("updated_at" desc);--> statement-breakpoint
CREATE TABLE `meeting_analysis_run_history` (
	`run_id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`reason` text NOT NULL,
	`status` text NOT NULL,
	`error_code` text,
	`metrics_json` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_meeting_analysis_run_history_completed` ON `meeting_analysis_run_history` ("completed_at" desc);--> statement-breakpoint
CREATE TABLE `meeting_analysis_runs` (
	`meeting_id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`input_revision` text NOT NULL,
	`source_revision` text NOT NULL,
	`eligibility_revision` text NOT NULL,
	`user_notes_hash` text NOT NULL,
	`notes_status` text NOT NULL,
	`secondary_status` text NOT NULL,
	`stage` text NOT NULL,
	`queue_position` integer,
	`error_code` text,
	`automatic_attempt_count` integer DEFAULT 0 NOT NULL,
	`started_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `meeting_calendar_context` (
	`meeting_id` text PRIMARY KEY NOT NULL,
	`occurrence_key` text NOT NULL,
	`calendar_title` text NOT NULL,
	`event_json` text NOT NULL,
	`match_origin` text NOT NULL,
	`match_evidence` text NOT NULL,
	`cache_revision` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "meeting_calendar_context_origin_check" CHECK("meeting_calendar_context"."match_origin" IN ('automatic','user')),
	CONSTRAINT "meeting_calendar_context_evidence_check" CHECK("meeting_calendar_context"."match_evidence" IN ('time_overlap','user_selected'))
);
--> statement-breakpoint
CREATE TABLE `meeting_context_events` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`event_key` text NOT NULL,
	`kind` text NOT NULL,
	`summary` text NOT NULL,
	`evidence_json` text NOT NULL,
	`attributes_json` text,
	`supersedes_event_id` text,
	`observed_at_ms` integer NOT NULL,
	`created_at` datetime NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_meeting_context_events_timeline` ON `meeting_context_events` (`meeting_id`,`observed_at_ms`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_context_events_meeting_event_unique` ON `meeting_context_events` (`meeting_id`,`event_key`);--> statement-breakpoint
CREATE TABLE `meeting_context_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_id` text NOT NULL,
	`revision` integer NOT NULL,
	`state_json` text NOT NULL,
	`last_segment_id` text,
	`last_segment_timestamp_ms` integer,
	`generated_at` datetime NOT NULL,
	`created_at` datetime NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_meeting_context_snapshots_revision` ON `meeting_context_snapshots` (`meeting_id`,"revision" desc);--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_context_snapshots_meeting_revision_unique` ON `meeting_context_snapshots` (`meeting_id`,`revision`);--> statement-breakpoint
CREATE TABLE `meeting_entities` (
	`meeting_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`mention_count` integer DEFAULT 1,
	`first_mentioned_at` integer,
	`context` text,
	`created_at` datetime DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY(`meeting_id`, `entity_id`),
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_meeting_entities_entity_meeting` ON `meeting_entities` (`entity_id`,`meeting_id`);--> statement-breakpoint
CREATE TABLE `meeting_speaker_candidates` (
	`meeting_id` text NOT NULL,
	`speaker` text NOT NULL,
	`source_revision` text NOT NULL,
	`candidate_digest` text NOT NULL,
	`embedding_json` text NOT NULL,
	`clean_duration_sec` real NOT NULL,
	`clean_segment_count` integer NOT NULL,
	`clean_chunk_count` integer NOT NULL,
	`minimum_chunk_similarity` real NOT NULL,
	`mean_chunk_similarity` real NOT NULL,
	`reference_start_sec` real NOT NULL,
	`reference_end_sec` real NOT NULL,
	`reference_excerpt` text NOT NULL,
	`provenance_json` text NOT NULL,
	`created_at` datetime DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY(`meeting_id`, `speaker`, `source_revision`),
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_meeting_speaker_candidates_meeting` ON `meeting_speaker_candidates` (`meeting_id`);--> statement-breakpoint
CREATE TABLE `meetings` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`meeting_type` text,
	`started_at` datetime,
	`ended_at` datetime,
	`duration_seconds` integer,
	`audio_path` text,
	`transcript_json` text,
	`user_notes` text,
	`enhanced_notes` text,
	`analysis_json` text,
	`analysis_schema_version` integer,
	`analysis_format_pass` boolean,
	`analysis_retry_count` integer DEFAULT 0,
	`analysis_fallback_used` boolean DEFAULT 0,
	`analysis_provider` text,
	`analysis_model` text,
	`analysis_generation_path` text,
	`analysis_prompt_version` text,
	`analysis_generated_at` datetime,
	`analysis_error_categories_json` text,
	`value_signals_json` text,
	`follow_up_drafts_json` text,
	`transcript_status` text DEFAULT 'provisional',
	`transcript_integrity_json` text,
	`system_audio_path` text,
	`mixed_audio_path` text,
	`transcript_validated_at` datetime,
	`finalization_status` text DEFAULT 'finalized' NOT NULL,
	`finalization_error_category` text,
	`downstream_processing_json` text,
	`capture_journal_generation` text,
	`user_edits_json` text,
	`analysis_edit_conflicts_json` text,
	`folder_id` text,
	`is_favorite` boolean DEFAULT 0,
	`created_at` datetime DEFAULT CURRENT_TIMESTAMP,
	`end_reason` text,
	`mid_json` text
);
--> statement-breakpoint
CREATE TABLE `person_aliases` (
	`person_id` text PRIMARY KEY NOT NULL,
	`canonical_id` text NOT NULL,
	`moved_aliases_json` text,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`restored_at` text,
	FOREIGN KEY (`person_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`canonical_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_person_aliases_canonical` ON `person_aliases` (`canonical_id`,`active`);--> statement-breakpoint
CREATE TABLE `person_name_aliases` (
	`person_id` text NOT NULL,
	`normalized_name` text NOT NULL,
	`display_name` text NOT NULL,
	`source` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`person_id`, `normalized_name`),
	FOREIGN KEY (`person_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "person_name_aliases_source_check" CHECK("person_name_aliases"."source" IN ('rename', 'user'))
);
--> statement-breakpoint
CREATE INDEX `idx_person_name_aliases_name` ON `person_name_aliases` (`normalized_name`);--> statement-breakpoint
CREATE TABLE `project_aliases` (
	`project_id` text PRIMARY KEY NOT NULL,
	`canonical_id` text NOT NULL,
	`moved_aliases_json` text,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`restored_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`canonical_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_project_aliases_canonical` ON `project_aliases` (`canonical_id`,`active`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text
);
--> statement-breakpoint
CREATE TABLE `speaker_voice_enrollments` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`source_meeting_id` text NOT NULL,
	`source_revision` text NOT NULL,
	`speaker` text NOT NULL,
	`embedding_json` text NOT NULL,
	`chunk_count` integer NOT NULL,
	`clean_duration_sec` real NOT NULL,
	`minimum_chunk_similarity` real NOT NULL,
	`mean_chunk_similarity` real NOT NULL,
	`reference_start_sec` real NOT NULL,
	`reference_end_sec` real NOT NULL,
	`reference_excerpt` text NOT NULL,
	`provenance_json` text NOT NULL,
	`candidate_digest` text NOT NULL,
	`created_at` datetime DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`person_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_speaker_voice_enrollments_person` ON `speaker_voice_enrollments` (`person_id`);--> statement-breakpoint
CREATE INDEX `idx_speaker_voice_enrollments_meeting` ON `speaker_voice_enrollments` (`source_meeting_id`);--> statement-breakpoint
CREATE TABLE `speaker_voice_profile_settings` (
	`person_id` text PRIMARY KEY NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`person_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `speaker_voice_rejections` (
	`meeting_id` text NOT NULL,
	`speaker` text NOT NULL,
	`source_revision` text NOT NULL,
	`candidate_digest` text NOT NULL,
	`person_id` text NOT NULL,
	`created_at` datetime DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY(`meeting_id`, `speaker`, `source_revision`, `candidate_digest`, `person_id`),
	FOREIGN KEY (`meeting_id`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_speaker_voice_rejections_meeting` ON `speaker_voice_rejections` (`meeting_id`);--> statement-breakpoint
CREATE TABLE `working_memory_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_type` text NOT NULL,
	`scope_key` text NOT NULL,
	`title` text NOT NULL,
	`source_doc_id` text NOT NULL,
	`source_doc_last_synthesized_at` datetime,
	`freshness` text NOT NULL,
	`trust_status` text NOT NULL,
	`source_count` integer DEFAULT 0 NOT NULL,
	`cited_meeting_count` integer DEFAULT 0 NOT NULL,
	`payload_json` text NOT NULL,
	`generated_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_working_memory_snapshots_scope` ON `working_memory_snapshots` (`scope_type`,`scope_key`);--> statement-breakpoint
CREATE INDEX `idx_working_memory_snapshots_generated_at` ON `working_memory_snapshots` ("generated_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX `working_memory_snapshots_scope_unique` ON `working_memory_snapshots` (`scope_type`,`scope_key`);
--> statement-breakpoint
CREATE VIRTUAL TABLE `meetings_fts` USING fts5(
  title,
  transcript_text,
  enhanced_notes,
  user_notes,
  mid_participants,
  mid_topics,
  mid_decisions,
  mid_action_items,
  meeting_id UNINDEXED
);
--> statement-breakpoint
CREATE VIRTUAL TABLE `meeting_notes_fts` USING fts5(
  title,
  notes_text,
  decisions_text,
  action_items_text,
  topics_text,
  participants_text,
  meeting_id UNINDEXED
);
--> statement-breakpoint
CREATE VIRTUAL TABLE `entities_fts` USING fts5(name, entity_id UNINDEXED);
--> statement-breakpoint
INSERT INTO `calendar_integration` (`singleton`) VALUES (1);
--> statement-breakpoint
INSERT INTO `identity_workspace` (`singleton`) VALUES (1);
--> statement-breakpoint
INSERT INTO `identity_input_revision` (`singleton`, `revision`) VALUES (1, 0);
--> statement-breakpoint
CREATE TRIGGER `identity_input_entities_INSERT` AFTER INSERT ON `entities`
BEGIN UPDATE `identity_input_revision` SET `revision` = `revision` + 1 WHERE `singleton` = 1; END;
--> statement-breakpoint
CREATE TRIGGER `identity_input_entities_UPDATE` AFTER UPDATE ON `entities`
BEGIN UPDATE `identity_input_revision` SET `revision` = `revision` + 1 WHERE `singleton` = 1; END;
--> statement-breakpoint
CREATE TRIGGER `identity_input_entities_DELETE` AFTER DELETE ON `entities`
BEGIN UPDATE `identity_input_revision` SET `revision` = `revision` + 1 WHERE `singleton` = 1; END;
--> statement-breakpoint
CREATE TRIGGER `identity_input_entity_links_INSERT` AFTER INSERT ON `entity_links`
BEGIN UPDATE `identity_input_revision` SET `revision` = `revision` + 1 WHERE `singleton` = 1; END;
--> statement-breakpoint
CREATE TRIGGER `identity_input_entity_links_UPDATE` AFTER UPDATE ON `entity_links`
BEGIN UPDATE `identity_input_revision` SET `revision` = `revision` + 1 WHERE `singleton` = 1; END;
--> statement-breakpoint
CREATE TRIGGER `identity_input_entity_links_DELETE` AFTER DELETE ON `entity_links`
BEGIN UPDATE `identity_input_revision` SET `revision` = `revision` + 1 WHERE `singleton` = 1; END;
--> statement-breakpoint
CREATE TRIGGER `identity_input_meeting_entities_INSERT` AFTER INSERT ON `meeting_entities`
BEGIN UPDATE `identity_input_revision` SET `revision` = `revision` + 1 WHERE `singleton` = 1; END;
--> statement-breakpoint
CREATE TRIGGER `identity_input_meeting_entities_UPDATE` AFTER UPDATE ON `meeting_entities`
BEGIN UPDATE `identity_input_revision` SET `revision` = `revision` + 1 WHERE `singleton` = 1; END;
--> statement-breakpoint
CREATE TRIGGER `identity_input_meeting_entities_DELETE` AFTER DELETE ON `meeting_entities`
BEGIN UPDATE `identity_input_revision` SET `revision` = `revision` + 1 WHERE `singleton` = 1; END;
--> statement-breakpoint
CREATE TRIGGER `identity_input_meetings_insert` AFTER INSERT ON `meetings`
BEGIN UPDATE `identity_input_revision` SET `revision` = `revision` + 1 WHERE `singleton` = 1; END;
--> statement-breakpoint
CREATE TRIGGER `identity_input_meetings_delete` AFTER DELETE ON `meetings`
BEGIN UPDATE `identity_input_revision` SET `revision` = `revision` + 1 WHERE `singleton` = 1; END;
--> statement-breakpoint
CREATE TRIGGER `identity_input_meetings_update`
AFTER UPDATE OF `title`, `transcript_json`, `analysis_json`, `started_at` ON `meetings`
WHEN OLD.`title` IS NOT NEW.`title`
  OR OLD.`transcript_json` IS NOT NEW.`transcript_json`
  OR OLD.`analysis_json` IS NOT NEW.`analysis_json`
  OR OLD.`started_at` IS NOT NEW.`started_at`
BEGIN UPDATE `identity_input_revision` SET `revision` = `revision` + 1 WHERE `singleton` = 1; END;
