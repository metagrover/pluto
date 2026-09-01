### Keep person roles evidence-backed

- **Issue:** [#713](https://github.com/metagrover/pluto/issues/713)
- **PR:** [#714](https://github.com/metagrover/pluto/pull/714)
- **Changed:** Person roles now require an exact transcript quote connecting the named person to a job title or function, and values matching another person are rejected.
- **Why:** Model extraction could mistake a nearby attendee's name for someone else's role and preserve that mistake indefinitely on the People page.
- **Replaced:** Ungrounded optional role strings accepted directly from model output.
- **Repaired:** Pluto removes existing bad roles only when another person has that name and a meeting link proves the role came from the extraction path; unrelated metadata and ambiguous records remain untouched.
- **Trust:** Missing evidence omits only the role, never the person.
- **Notes:** Repair is idempotent and logs only a content-free count.
