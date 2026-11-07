# GitHub Release Guide

Follow these steps whenever you publish a new version of Helium Inline Translator on GitHub.

## 1. Prepare your workspace

```powershell
cd path\to\helium-inline-translator
```

Use the folder that contains `manifest.json`. The project has no runtime dependencies, so no install step is required.

## 2. Bump the version

Update the version in both files; they must match:

- `manifest.json`
- `package.json`

Optionally add the release notes to `CHANGELOG.md` and update `docs/StoreListing.md`.

## 3. Run verification

```powershell
npm run verify
```

This checks the manifest, referenced files, locale and flag parity, popup translations, script order, JavaScript syntax, and the shared-registry tests. Fix any failure before continuing.

## 4. Check repository status

```powershell
git status
```

Review the list of modified files. If there are changes you do not want to publish, revert or adjust them before continuing.

## 5. Commit your changes

```powershell
git add .
git commit -m "feat: describe the main change here"
```

Choose a descriptive commit message. Use `git status` again to confirm the working tree is clean.

## 6. Tag the release (optional)

```powershell
git tag v1.2.0
```

Replace `v1.2.0` with the actual version from `manifest.json`.

## 7. Push to GitHub

```powershell
git push origin main
```

If you created a tag:

```powershell
git push origin v1.2.0
```

## 8. Create a GitHub release

1. Open the repository page in your browser.
2. Go to **Releases** → **Draft a new release**.
3. Select the tag (or create one), add release notes, and publish the release.
4. Optionally attach a packaged ZIP. Build it from the extension root so `manifest.json` sits at the top of the archive:

   ```powershell
   Compress-Archive -Path manifest.json,src,ui,icons,_locales,LICENSE,README.md `
     -DestinationPath helium-inline-translator-1.2.0.zip -Force
   ```

   Do not include `.git`, test files, scripts, docs, or store keys.

## 9. Update the Chrome/Edge store links

Once the stores approve the submission, edit the README and documentation to include the live URLs.

## Tips

- Keep the repository free of generated ZIPs or PEM keys. Store them outside the repo.
- Increment the version in `manifest.json` and `package.json` before each public release.
- Re-run `npm run verify` after resolving merge conflicts.
- Use the Chrome Web Store and Edge dashboards to monitor approval status.
- If you maintain multiple branches, replace `main` in the commands with the appropriate branch name.
