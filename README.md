# Focus 2.3 — verified logging repair

This release repairs the case where the app displayed a “logged” message but did not increase a target count.

## What changed

- Target and event IDs are normalised before comparison, including data migrated from Version 1.
- New entries are explicitly linked to the current focus period as well as carrying their calendar date.
- The app writes each change to browser storage and immediately verifies the stored entry count before confirming success.
- The toast now reports the resulting current-focus total, for example `Floss: 3 completed`.
- Manage → About shows the app version, total stored entries and current-focus entries.
- Existing entries with compatible dates are assigned to the correct focus during migration.
- Core app files use new filenames and a network-first service worker to avoid stale JavaScript.

## Upload

1. Export a backup from the current app first.
2. Extract this ZIP.
3. In the existing `Focus-tracker` GitHub repository choose **Add file → Upload files**.
4. Upload all eight extracted files to the repository root and commit to `main`.
5. Keep GitHub Pages configured to publish `main` from `/(root)`.
6. Wait a few minutes, close the Focus browser tab or installed app fully, then reopen the normal address and refresh once.
7. Open **Manage → About** and confirm it says **Focus 2.3.0**.
8. Test one target. The toast should say, for example, `Floss: 1 completed`, and the count should rise immediately.

Do not clear Chrome site data or uninstall the app during the update. The same storage key and Version 1/2 migration support are retained.
