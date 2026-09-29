# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Pluto serves people with dense recurring context who need memory assistance across captured conversations, notes, meetings, and reference material. Primary users include founders and operators tracking many workstreams, managers and individual contributors maintaining continuity across meetings, researchers and students capturing lectures or study notes, consultants and creators managing client context, and people using Pluto for personal planning, relationships, healthcare conversations, travel, or life administration.

Users usually open Pluto in a re-entry moment: before, during, or after a conversation when they need to know what happened, what changed, what deserves attention, what they committed to, and why Pluto believes it.

## Product Purpose

Pluto is a local-first, open-source desktop second brain that captures meeting audio, transcribes locally, extracts entities and commitments, and turns accumulated context into a trustworthy working memory.

The product exists to transform conversations from isolated events into a connected knowledge system organized by people, projects, themes, decisions, action items, and evidence. Success means users can focus on the conversation, then return later to a concise current read, accountable follow-ups, cited answers, and useful pre-meeting context without manually curating every note.

## Positioning

Pluto treats meetings as durable evidence for a connected working memory rather than as isolated recordings or summaries. Its differentiator is the combination of local capture and transcription, evidence-grounded synthesis, and continuity across people, projects, commitments, and recurring conversations, with paths back to the underlying source.

## Operating Context

Pluto is an Electron desktop application for Apple Silicon Macs. It supports the full meeting loop: preparing from local calendar context, capturing microphone and system audio, following a live transcript, reviewing generated notes and speaker identity, returning to people and project context, and asking grounded questions across accumulated meeting history.

The application is designed for long-running, private use on a personal computer. Users may rely on it during active conversations and later re-entry, so capture, persistence, recovery, provenance, and clear processing state are product-critical rather than background implementation details.

## Capabilities and Constraints

- Pluto captures microphone and system audio and transcribes speech locally with bundled native runtimes.
- It produces evidence-grounded meeting notes, decisions, action items, topics, and searchable transcripts while preserving source recordings and provenance.
- It connects meeting history into People, Projects, commitments, current reads, pre-meeting context, and Ask Pluto answers with citations.
- Calendar access is native, local, read-only product behavior. Calendar attendees and metadata are context hints, not proof of speaker identity.
- Meeting data is stored locally. Intelligence can use configured local or cloud model providers, and the interface must keep that boundary understandable.
- The currently supported production platform is Apple Silicon macOS. Intel macOS, Windows, and Linux are not supported.
- Source evidence, transcripts, identity confirmations, and reversible user data must not be silently discarded, rewritten, or treated as more certain than the evidence supports.
- Python is optional benchmark tooling; it is not the application transcription runtime.

## Brand Commitments

The product name is Pluto. Its voice is calm, sophisticated, trustworthy, warm, and disciplined. Pluto should feel like a careful executive brief or personal newspaper for the user's memory: intelligent without becoming theatrical, and oriented toward helping the user feel informed and in control.

Pluto should not present itself as a generic task manager, raw graph or database browser, meeting archive with nicer cards, pile of extracted bullets, or overconfident AI system. It must not hide uncertainty, make every meeting seem equally important, require manual cleanup before synthesis becomes useful, treat work context as the only meaningful context, or inflate routine follow-ups into critical risks.

## Evidence on Hand

- The runnable product implementation lives in `src/`, `electron/`, `native/`, and `resources/`.
- `README.md` documents current contributor setup, Apple Silicon support, native runtime preparation, required macOS permissions, and production packaging.
- Product specifications, decisions, plans, and verification records live under `docs/`; they are evidence of implemented and proposed behavior, not a substitute for checking the current application.
- The repository contains focused automated tests for capture, transcription, meeting notes, identity, retrieval, persistence, privacy boundaries, and interface behavior.
- No public pricing, customer testimonials, adoption metrics, certifications, or public download URL are established here; future product or marketing work must not fabricate them.

## Product Principles

1. Lead with the current read. Pluto should answer what is active, what changed, what needs attention, and what is missing before showing raw artifacts.
2. Make trust visible. Important claims need a path back to source meetings, quotes, citations, or extraction metadata.
3. Classify before ranking. Decisions, follow-ups, risks, patterns, reference context, and noisy material need different treatment and urgency.
4. Stay proactive without pretending. Pluto can cluster streams, surface commitments, and suggest attention, but it must name weak evidence and stale synthesis.
5. Help users re-enter context quickly. The product should reduce cognitive load, preserve continuity, and make the next useful action obvious.

## Accessibility & Inclusion

Pluto should target WCAG 2.2 AA contrast and keyboard-accessible workflows across product surfaces. The application should support reduced motion, avoid relying on color alone for severity or status, preserve readable density for long working sessions, and keep uncertainty and evidence labels understandable without requiring expert knowledge of the underlying graph or synthesis system.
