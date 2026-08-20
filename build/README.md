# build/ — packaging resources

## `rcedit-x64.exe` — a vendored third-party binary

This is a **foreign executable checked into the repository**, which in a project
whose whole claim is "you can read the source and check" deserves saying out
loud rather than leaving for someone to find.

- **What it is:** [rcedit](https://github.com/electron/rcedit), Electron's own
  tool for editing Windows executable resources. MIT licensed.
- **What it does here:** stamps the packaged `Nexus Reader.exe` with the app
  icon and version metadata. See `scripts/after-pack.cjs` for why
  electron-builder cannot do this itself on a normal Windows account.
- **What it does not do:** it does not sign anything. There is no code-signing
  certificate for this project.
- **When it runs:** only during `npm run package`. It is not shipped inside the
  installer and never runs on a user's machine.
- **SHA-256:** `AB53500D556FD824636621BCA7DBECD8583BA181891C3E9EFDCF16B72A28B0CD`

Verify it yourself:

```powershell
(Get-FileHash build\rcedit-x64.exe -Algorithm SHA256).Hash
```

It is vendored rather than downloaded during the build so that packaging works
offline and does not silently pull an executable from the network at build time.

## The icons

`icon.png` (1024px) and `icon.ico` (seven sizes down to 16px) are both generated
by `node scripts/make-icon.mjs`. The `.ico` exists because letting Windows
downscale one large image turns a hairline mark to mush at the sizes it matters
most. `_icon-main.cjs` is the drawing itself.
