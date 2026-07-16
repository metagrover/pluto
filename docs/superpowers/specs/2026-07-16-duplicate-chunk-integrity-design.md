# Duplicate Capture Chunk Integrity Design

## Context

Pluto's capture journal makes duplicate source/sequence delivery idempotent by comparing incoming metadata with the manifest entry. The existing duplicate path then checks only the stored artifact's byte count. Same-size corruption can therefore be accepted even though the manifest checksum no longer proves the stored bytes.

## Design

On duplicate delivery, read the already-stored artifact and compute its SHA-256 with the same checksum helper used for incoming bytes. Return the existing manifest only when metadata, size, and checksum all match. If the stored checksum differs, throw a specific integrity error and leave the manifest and artifact untouched.

This keeps the existing append format and recovery behavior unchanged. It adds no retry, repair, deletion, UI state, or logging of audio content or private paths.

## Error handling

Missing files and ordinary filesystem read failures continue to surface from the filesystem. A readable, same-size artifact whose bytes do not match the acknowledged checksum fails with a capture-journal artifact checksum mismatch error naming only the meeting ID, source, and sequence.

## Tests

- Preserve the existing exact-duplicate idempotency test.
- Add fault injection that overwrites an acknowledged chunk with different same-size bytes, redelivers the original chunk, and asserts rejection plus an unchanged one-entry manifest.

