# macOS Code Signing & Notarization

Without this, macOS shows **"…is damaged and can't be opened"** on every download.
That message means "unsigned and I refuse to run it" — the file is fine.

Config is already done (`electron-builder.json`). What remains is one-time setup
of a certificate and credentials.

---

## 1. Create the certificate (one time)

You need a **Developer ID Application** certificate — *not* "Apple Development"
and *not* "Mac App Store". Only Developer ID works for apps shipped outside the
App Store.

Easiest route, via Xcode:

1. Install Xcode, then **Xcode → Settings → Accounts**.
2. Add your Apple ID, select the team, click **Manage Certificates…**.
3. Press **+** → **Developer ID Application**.
4. It is created and installed into your login keychain automatically.

Without Xcode: create a CSR via Keychain Access
(*Certificate Assistant → Request a Certificate From a Certificate Authority*),
upload it at <https://developer.apple.com/account/resources/certificates/add>,
choose **Developer ID Application**, download the `.cer` and double-click it.

Verify it landed:

```bash
security find-identity -v -p codesigning
```

You should see a line containing `Developer ID Application: Your Name (TEAMID)`.
Until this prints at least one identity, signed builds cannot work.

---

## 2. Notarization credentials

Apple must scan each build before macOS will trust it.

1. **App-specific password** — go to <https://appleid.apple.com> →
   *Sign-In and Security* → *App-Specific Passwords* → generate one.
   This is **not** your Apple ID password.
2. **Team ID** — 10 characters, at <https://developer.apple.com/account> →
   *Membership*.

Then:

```bash
cp .env.signing.example .env.signing
# fill in APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID
```

`.env.signing` is gitignored. These are account credentials — never commit them.

---

## 3. Build

```bash
npm run dist:mac:signed
```

This loads the credentials, builds, signs with the keychain certificate, and
submits to Apple's notary service. Notarization typically takes 2–15 minutes;
electron-builder waits and then staples the ticket to the DMG.

To build locally without touching certificates:

```bash
npm run dist:mac:unsigned
```

---

## 4. Verify before shipping

```bash
# Should report: "source=Notarized Developer ID"  and  "accepted"
spctl -a -vvv -t install "release/mac-arm64/PathMaker4u-AI.app"

# Confirm the notarization ticket is stapled to the DMG
xattr -p com.apple.quarantine release/*.dmg 2>/dev/null   # expect: no such xattr
stapler validate release/*.dmg
```

The real test: download the DMG through a browser on a Mac that has never seen
the app, and open it. No warning means it worked.

---

## Notes

- **Both architectures need signing.** `arm64` and `x64` DMGs are separate
  artifacts and each is signed and notarized in turn.
- **`hardenedRuntime: true` is mandatory** for notarization, and it is why
  `entitlements.plist` grants `allow-jit`, `allow-unsigned-executable-memory`
  and `disable-library-validation` — Electron's V8 will not start under the
  hardened runtime without them.
- **Notarization can fail on entitlements.** If Apple rejects the build, read the
  log it returns; it names the offending binary or entitlement precisely.
- **Windows is separate.** SmartScreen keeps warning until you buy a Windows
  code-signing certificate (an OV/EV cert from a CA, roughly $200–400/year).
  Nothing in this document affects it.

---

## 5. CI (GitHub Actions)

`.github/workflows/release.yml` builds all three platforms on a `v*` tag push.
CI runners start with an empty keychain, so the certificate has to be handed to
them explicitly. Export it once:

```bash
# Keychain Access → My Certificates → right-click your
# "Developer ID Application" cert → Export… → save as certificate.p12
base64 -i certificate.p12 | pbcopy
```

Then add these **repository secrets** (Settings → Secrets and variables → Actions):

| Secret | Value |
| ------ | ----- |
| `MAC_CSC_LINK` | the base64 string just copied |
| `MAC_CSC_KEY_PASSWORD` | the password you set when exporting the .p12 |
| `APPLE_ID` | your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password |
| `APPLE_TEAM_ID` | 10-character Team ID |
| `RELEASE_GH_TOKEN` | PAT with write access to the releases repo |

`RELEASE_GH_TOKEN` is needed because `secrets.GITHUB_TOKEN` only grants access to
the repo running the workflow, and `electron-builder.json` publishes to a
*separate* releases repo.

Cut a release with:

```bash
npm version patch     # bumps package.json and creates the tag
git push && git push --tags
```

Without `MAC_CSC_LINK` the macOS job still succeeds, but produces an **unsigned**
build — users get "damaged and can't be opened" again. Check the job log for
`signing ... identityName=Developer ID Application` to confirm it worked.
