# Focus – personal target tracker

A small installable browser app for tracking personal priorities over a focus period.

## What it does

- Tracks 4–10 personal targets such as flossing, physio or eating well
- Supports weekly targets or a single target for the whole focus period
- Shows progress, remaining repetitions, current run rate and the rate needed from now
- Shows totals for the current focus period, current calendar year and all time
- Keeps past focus periods
- Works offline after the first visit
- Saves data locally in the browser
- Exports and imports a JSON backup

## Put it live with GitHub Pages — no command line required

1. Create a free GitHub account at github.com.
2. Click **New repository**.
3. Name it `focus-tracker`.
4. Choose **Public**, tick **Add a README file**, then create the repository.
5. In the repository, click **Add file → Upload files**.
6. Drag in all the files and the `icons` folder from this package. Commit the upload.
7. Open **Settings → Pages**.
8. Under **Build and deployment**, choose:
   - Source: **Deploy from a branch**
   - Branch: **main**
   - Folder: **/(root)**
9. Click **Save**.
10. GitHub will show the live address after publishing. It will usually be:
    `https://YOUR-GITHUB-USERNAME.github.io/focus-tracker/`

## Install it on Android

1. Open the live address in Chrome.
2. Tap Chrome's three-dot menu.
3. Tap **Install app** or **Add to Home screen**.
4. The Focus icon will appear with your other apps.

## Important limitation

The app has no account or cloud database. Your data is stored in the browser on the device you use. Export a backup from **Manage → Data and backup** before changing phones, clearing Chrome data, or testing a new version.

## Updating it later

Upload replacement files to the same repository. GitHub Pages republishes the site. The service worker caches the app for offline use, so after an update you may need to close and reopen the installed app once or twice.

## Sensible next upgrade

For automatic sync between phone and computer, add a small hosted database and sign-in service such as Supabase or Firebase. That is a second-stage change rather than a requirement for the first working version.
