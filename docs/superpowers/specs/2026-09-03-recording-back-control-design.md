# Recording Back Control Design

Issue: #743

## Outcome

The recording workspace Back control sits immediately to the right of the macOS traffic lights and shares their vertical center, following the familiar native titlebar rhythm in the supplied Codex reference.

## Design

Keep the Electron `hiddenInset` titlebar and its traffic-light position unchanged. Preserve the recording header's 96-pixel desktop safe inset, but reduce the Back control to a quiet 32-pixel icon button with an accessible `Back home` name. Shift only that control upward within the existing status group so its center aligns with the traffic-light row; recording state, elapsed time, status copy, drag region, health indicators, and Finish action retain their current layout.

At the compact header breakpoint, reset the vertical offset because the smaller header padding already places the control near the native titlebar axis. Use the existing hover, focus-ring, muted foreground, and no-drag vocabulary. No image asset or new motion is required.

## Testing

Extend the capture-bar stylesheet regression to assert the desktop safe inset, compact icon geometry, titlebar offset, and compact-breakpoint offset reset. Keep the component interaction test for keyboard-safe button semantics and Back behavior.

