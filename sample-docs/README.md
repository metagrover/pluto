# Sample Reference Documents for Testing

These documents are provided for testing Pluto's **Reference Document Ingestion** and **Grounded Meeting Notes Synthesis**.

## Available Documents

1. **`Project-Starlight-PRD-and-Technical-Specs`** (`.docx`, `.pdf`, `.md`):
   - **Type**: Comprehensive Product Requirements & Architecture Brief.
   - **Context Included**:
     - Architecture decisions (SQLite junction table `meeting_local_artifacts`, SHA-256 revision hash invalidation).
     - Named stakeholders (Maya Lin, Alex Chen, David Rossi, Priya Sharma) and their roles.
     - Q3 sprint milestones with specific target dates (Oct 3, Oct 10, Oct 17, Oct 24).
     - Known risks and mitigations (audio drift, scanned PDFs, model quantization).
   - **Best Used For**: Testing deep context grounding, seeing Pluto attribute decisions to specific team members, and verifying how attached PRD milestones get synthesized into the meeting's *Decisions & Next Steps*.

2. **`Engineering-Sync-Agenda`** (`.docx`, `.pdf`, `.md`):
   - **Type**: Weekly Engineering Sync & Agenda.
   - **Context Included**:
     - Agenda topics (CoreAudio drift, CoreML Whisper Q4_0 benchmarks, reference document attachment UI).
     - Specific action items assigned to Maya, David, and Alex.
   - **Best Used For**: Quick sync testing and validating that action items in the attached agenda are synthesized alongside spoken notes.

## How to Test in Pluto

### Method A: Via the `...` Dropdown
1. Open any meeting in Pluto (or create a new recording).
2. Click the `...` button in the notes header.
3. Select **"Attach reference document…"**.
4. Browse to `/Users/metagrover/Desktop/pluto/sample-docs/` and pick any `.docx`, `.pdf`, or `.md` file.
5. Notice the quiet inline pill badge appears above the notes: `📎 Reference docs: [Word · Project-Starlight...]`.
6. Click the pill badge to open the full extracted text inspector.
7. Click **"Docs changed · Regenerate notes"** to re-synthesize notes with the document context included.

### Method B: Drag and Drop
1. Open Finder at `/Users/metagrover/Desktop/pluto/sample-docs/`.
2. Drag any `.docx`, `.pdf`, or `.md` file directly over the Pluto meeting notes view.
3. Observe the dropzone overlay and drop the file.
