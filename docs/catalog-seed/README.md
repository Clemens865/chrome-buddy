# Chrome Buddy Catalog

The public marketplace for [Chrome Buddy](https://github.com/Clemens865/chrome-buddy)
artifacts — **apps, skills, and workflows you can install with one tap**.

Everything here is **data, not code**: app *configs*, skill *prompts*, workflow
*definitions*. Any JavaScript (Tier-2/3 apps) runs only inside Chrome Buddy's
opaque-origin sandbox (no `chrome.*`, no key access), behind a permission bridge,
a first-run review gate, and a confirm-before-any-consequential-action gate. So
installing from this catalog can't run privileged code on your machine.

## Layout

```
index.json          The manifest: every entry's metadata + path to its data file.
apps/<id>.json      An app bundle: { "schemaVersion": 2, "apps": [AppConfig] }.
skills/<id>.md      A skill (Claude SKILL.md format).
workflows/<id>.json A workflow definition.
```

## index.json entry

```json
{
  "id": "email-polisher",
  "name": "Email Polisher",
  "description": "One line shown on the card.",
  "kind": "app",            // app | skill | workflow
  "tier": 1,                // apps: 1 declarative · 2 sandboxed code · 3 sandbox-UI
  "version": "1.0.0",       // bump to ship an update; users see "Update available"
  "author": "Chrome Buddy",
  "permissions": [],        // apps Tier-2/3: declared bridge caps, shown before install
  "screenshot": "https://…", // optional preview image
  "dataPath": "apps/email-polisher.json"
}
```

## Adding an app

1. Build it in Chrome Buddy → **Export** (or hand-write the bundle).
2. Drop the bundle at `apps/<id>.json` and add an entry to `index.json`.
3. Open a PR. Review = curation. Prefer **Tier-1** (pure form+prompt, no code)
   where possible — it's the simplest and safest to deliver.

The extension fetches `index.json` over plain HTTPS (no auth) and re-validates
every installed app through its tier parser (ids reassigned, capabilities
allow-listed, `reviewed` forced false → the review gate runs before first use).
