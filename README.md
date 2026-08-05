# Focus 3.2

Focus 3.2 is a small refinement release for the existing installable browser app. It keeps the same storage key and data schema as Focus 3.1, so existing targets, logs, context records, bedtime data, history and backups remain compatible.

## Changes in 3.2

- Removes the visible word **Recoverability** from individual target rows. The useful status remains: Comfortable, Recoverable, Needs attention or At risk.
- Adds **Low-level illness** to daily context.
- Refines the illness scale to:
  - Well
  - Low-level illness
  - Mildly ill
  - Ill — activity affected
  - Very ill
- Existing illness values are retained. This is a presentation and choice refinement rather than a destructive data conversion.
- Removes the global **Expand all / Collapse all** control.
- Themes are still opened and closed individually using their own heading or arrow, and the app remembers each theme’s state.
- Places **Add today’s context** directly beneath the summary card.
- Places **Log previous date** immediately beneath the context button.
- Uses newly versioned app files and a fresh offline cache.

## Upload over the current version

1. Open the working app and use **Manage → Export backup**.
2. Extract `focus_tracker_v3_2_github_upload.zip`.
3. Open the existing GitHub repository that hosts Focus.
4. Choose **Add file → Upload files**.
5. Upload these eight extracted files to the repository root:
   - `index.html`
   - `app-v3-2.js`
   - `styles-v3-2.css`
   - `service-worker-v3-2.js`
   - `manifest.webmanifest`
   - `icon-192.png`
   - `icon-512.png`
   - `README.md`
6. Commit directly to `main`.
7. Leave GitHub Pages settings unchanged.
8. Wait a few minutes, close Focus and its Chrome tab completely, then reopen the normal app address.

Old versioned JavaScript, CSS and service-worker files may remain in the repository. Focus 3.2 does not refer to them.

## Quick check

Open **Manage → About** and confirm:

`Focus 3.2.0 · Data schema 4`

Then check that:

- existing targets and counts are visible;
- Add today’s context appears above Log previous date;
- the context form includes Low-level illness;
- each theme still expands and collapses independently;
- pressing `+` increases a target count.

Do not clear Chrome site data or uninstall the app during the update.
