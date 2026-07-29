# Focus 3.1

Focus is an installable, offline-first personal target tracker. Version 3.1 replaces Focus 3.0 at the same GitHub Pages address and preserves the existing browser data.

## New in 3.1

- Adds an optional bedtime question to daily context: **What time did you get into bed for the night?**
- Includes a one-tap **Use current time** button for completing context in bed.
- If Focus is opened shortly after midnight, it defaults to the previous evening and clearly shows which night will receive the entry.
- Retrospective context can store and edit bedtime in the same way as alcohol, stress and illness.
- Bedtime is analysed as both a same-evening factor and across the following seven days.
- Bedtime comparisons are relative to the user’s own usual bedtime, calculated from the median of logged nights.
- Bedtime records are included in JSON exports, local recovery points and app-health checks.
- Existing Focus 3.0 data migrates to schema 4 without requiring bedtime on older records.

All Focus 3.0 features remain, including themes, total and frequency goals, historical target recommendations, exact alcohol units, retrospective context, mobile-friendly insights, verified logging and local recovery points.

## Before replacing the live version

1. Open the current working Focus app.
2. Go to **Manage → Export backup**.
3. Confirm the JSON file appears in Downloads.
4. Do not clear Chrome data or uninstall the app.

## Upload to the existing GitHub repository

1. Extract `focus_tracker_v3_1_github_upload.zip` on the phone.
2. Open the existing Focus GitHub repository.
3. Choose **Add file → Upload files**. On the compact mobile view this may be under the three-dot menu; Desktop site can also be used.
4. Upload every extracted file to the repository root:
   - `index.html`
   - `app-v3-1.js`
   - `styles-v3-1.css`
   - `service-worker-v3-1.js`
   - `manifest.webmanifest`
   - `icon-192.png`
   - `icon-512.png`
   - `README.md`
5. Commit directly to `main` with a message such as `Upgrade Focus to 3.1`.
6. Leave the existing GitHub Pages settings unchanged.

Older JavaScript, CSS and service-worker files can remain in the repository. The new `index.html` no longer refers to them.

## After GitHub republishes

1. Close Focus and its Chrome tab completely.
2. Reopen the normal Focus address.
3. Refresh once if the previous version is still visible.
4. Open **Manage → About** and confirm it says `Focus 3.1.0 · Data schema 4`.
5. Open **Manage → App health** and check for **Everything looks healthy**.
6. Open daily context and confirm the bedtime field and **Use current time** button appear.
7. Save one test context entry, reopen it and check the bedtime is still present.
8. Export a fresh Version 3.1 backup.

## After-midnight behaviour

Before 04:00, the homepage context button defaults to the previous evening. The context form shows a notice such as **Focus is treating this as Wednesday night’s context**, with an option to use the current calendar day instead. This prevents a bedtime such as 00:20 being attached to the wrong evening.

## Data safety

Focus keeps the same main storage key as previous versions. Before schema migration it stores a pre-Version-3.1 copy and continues to maintain last-known-good and daily recovery copies. Bedtime is optional, so all existing context records remain valid.

The app remains local-only. Recovery points are stored on the same phone and do not protect against losing or resetting the phone or clearing Chrome site data. Exported JSON remains the no-cloud safety copy.
