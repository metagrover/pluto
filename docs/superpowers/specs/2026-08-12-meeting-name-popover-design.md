# Meeting Name Popover Design

## Issue

Tied to GitHub issue #611: Meeting Zen View must preserve a quiet meeting surface without trapping or obscuring primary app navigation.

## Goal

Move the active recording name out of the dense capture bar and into a lightweight, top-centered popover that matches the reference interaction: voice state on the left, meeting or note name in the middle, and an expand action on the right. Add a clear back-home action so users can leave Zen View without ending the active recording.

## User Experience

When the user backs out of Zen View into the home/dashboard shell while a recording remains active in the background, Pluto shows a compact pill at the top center of the app. The pill keeps the active note or meeting reachable while primary navigation returns. The pill contains:

- live voice-input dots that reflect the same voice/capture activity already available in the note window
- an editable meeting name, using the current default meeting title when available and falling back to `Meeting` only when no name exists
- an expand icon that opens or focuses the fuller meeting details surface

The popover is not a modal and does not close the user away from the meeting. It keeps title editing discoverable while making the meeting workspace feel less like a form.

Zen View shows a visible back button inline with the recording status, immediately to the left of the `Recording` label. Activating it returns the user to the home/dashboard shell while recording continues.

## Component Shape

`RecordingCaptureBar` should stop rendering the title input inline. A focused title popover component should own the visual treatment for the floating pill and receive:

- current title
- title change callback
- recording or processing status
- voice activity state
- expand callback
- home/back callback

The existing capture bar keeps operational controls: recording state, elapsed time, capture health, and finish recording.

## Behavior

Clicking or focusing the title area edits the active meeting title. `Enter` commits through the existing title change callback. `Escape` restores the last committed title for that editing interaction. Blur commits the current text.

The expand button focuses the existing live meeting details rail. It does not dismiss the popover or stop recording.

The back button exits Zen View, clears any selected meeting, switches the main shell to the dashboard/home tab, and then shows the name popover as an active background-recording affordance.

## Testing

Add focused UI coverage for the recording workspace components:

- the popover renders the current default meeting title when available and falls back to `Meeting` when empty
- the popover exposes voice-input status dots as semantic voice activity, not decorative status only
- the expand control is present and calls the supplied expand handler
- the back button returns to the home shell while the active recording pill remains visible
- the capture bar no longer contains the inline title input

## Non-Goals

This work does not create a new note editor, change recording persistence, or alter post-meeting title generation.
