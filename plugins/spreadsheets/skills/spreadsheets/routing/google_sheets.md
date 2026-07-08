# Google Sheets Routing

**Default**: this skill builds and verifies a local `.xlsx`.

**When the target is a Google Sheet**: first produce and verify a local `.xlsx` with this skill, then have the user upload it to Google Sheets (File → Import → Upload), or import it via whatever Google integration tool is available in the environment. Do not drive a blank Google Sheet with browser automation — a local `.xlsx` imported into Sheets yields higher quality.

If the final deliverable is a Google Sheet link, treat the local `.xlsx` as a build artifact.

**Editing an existing Google Sheet**: use an available Google Sheets integration tool; do not round-trip through a local `.xlsx`.
