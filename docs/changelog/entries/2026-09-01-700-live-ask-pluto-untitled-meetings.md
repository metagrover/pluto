### Keep live Ask Pluto responsive for untitled meetings

- **Issue:** [#700](https://github.com/metagrover/pluto/issues/700)
- **PR:** [#696](https://github.com/metagrover/pluto/pull/696)
- **Changed:** Live Ask Pluto now supplies a neutral title when a recording has not been named and surfaces unavailable responses as a visible error instead of an empty assistant turn.
- **Why:** Empty live meeting titles failed IPC validation, while the empty unavailable response made the dock appear stuck.
- **Replaced:** Passing an empty live title through validation and treating every resolved response as an answer.
- **Notes:** The request always leaves its loading state after an unavailable response, so the user can retry immediately.
