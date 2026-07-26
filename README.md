# Focus 2.1

An installable, local-first browser app for tracking personal priorities over a focus period.

## Version 2 features

- Calm editorial design
- Health, Personal and Work themes, plus custom themes
- Total-over-period goals and frequency goals such as 3 times per week across 90 days
- Recoverability status based on the pace needed from today
- A selective written briefing with Auto / Always / Never inclusion controls
- Optional daily context tracking for work stress, alcohol units and illness
- Context comparisons for the same day and each of the following seven days, with sample sizes
- Current-focus, annual and all-time totals
- Automatic local recovery snapshot on the first opening each day, retaining up to 30
- Manual JSON export/import
- Automatic migration from the original Version 1 app and its backups
- Offline use after first load

## Important data notes

The app still stores working data on the device, under the same browser-storage key as Version 1. Replacing the site files at the same GitHub Pages address should preserve and migrate existing records automatically.

Export a Version 1 backup before updating. Do not clear Chrome site data or uninstall the app as part of the update.

Daily recovery points are also local to the device. They help with accidental edits but do not protect against loss, reset, or clearing browser data. Manual exports remain the no-cloud safety copy.

## Replace the existing GitHub Pages version

1. Export a backup from the current app.
2. Extract the `focus_tracker_v2_github_upload.zip` package.
3. In the existing GitHub repository, choose **Add file → Upload files**.
4. Upload all files from the extracted folder. They must sit in the repository root, alongside `index.html`.
5. Commit the changes to `main`.
6. Keep GitHub Pages set to deploy from `main` and `/(root)`.
7. Wait for Pages to finish publishing.
8. Open the live app. The first open may still show the old cached version; close and reopen it or refresh once more.
9. Open **Manage** and confirm it says **Focus 2.0**. Check your targets and totals, then export a fresh Version 2 backup.


## Context analysis window

Focus 2.1 checks each selected target on the same day as a context record and at +1, +2, +3, +4, +5, +6 and +7 days. Longer windows are deliberately not used by default because overlapping stress, illness and drinking episodes become increasingly difficult to interpret.
