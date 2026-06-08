# KC Library NYT Pass

Chrome extension that redeems the Kansas City Public Library's New York Times
group pass with one click. The library's "Access Now" link routes through OCLC
EZproxy, which requires a library card number + PIN; this extension auto-fills
that form, then NYT signs you in via your existing Google session.

## Setup

1. Visit `chrome://extensions`, enable **Developer mode**, click **Load
   unpacked**, and select this directory.
2. Click the extension's toolbar icon — the options page opens.
3. Enter your library card number and PIN. Click **Save**.
4. Click the toolbar icon again to redeem.

Credentials live only in `chrome.storage.local` on this machine. Nothing leaves
the browser.

## Flow

1. Toolbar click → opens `https://kclibrary.idm.oclc.org/login?url=http://ezmyaccount.nytimes.com/grouppass/redir`
2. Content script auto-fills the EZproxy login form and submits it.
3. EZproxy redirects to `ezmyaccount.nytimes.com/grouppass/redir`, which
   redeems the pass.
4. NYT redirects to its sign-in flow; click **Continue with Google** (or it
   auto-signs in if you've used it before).

## Files

- `manifest.json` — MV3 manifest, scopes host permissions to the EZproxy and
  NYT domains only.
- `background.js` — service worker; toolbar click handler plus the lockout
  safeguards (cooldown, failure/success tracking, toolbar badge).
- `content-ezproxy.js` — runs on the EZproxy login page, fills the form once,
  and refuses to resubmit rejected credentials.
- `options.html` / `options.js` — credential entry form.

## Lockout safeguards

EZproxy has its own intruder protection: too many failed logins and it drops the
connection (`ERR_EMPTY_RESPONSE`) for your card or IP for a long cooldown. To
make that impossible to trigger, auto-login is a one-shot that backs off and
hands control back to you:

- **One submit per tab.** The content script auto-submits at most once per tab,
  so a reloaded login page never resubmits in a loop.
- **Any failure disables auto-login for the session.** A rejected card/PIN
  (detected on the page) or a dropped connection (detected in the background)
  switches auto-fill off for the rest of the browser session. The flag lives in
  `chrome.storage.session`, so it survives service-worker restarts and clears
  when the browser closes.
- **Manual sign-in always works.** The toolbar icon always opens the login page.
  When auto-login is disabled the form is simply left untouched, so you can type
  your card/PIN and click through yourself.
- **Re-enable by re-saving credentials.** Entering your card/PIN in options
  turns auto-login back on for a fresh attempt.
- **Toolbar badge.** A red `!` on the icon means auto-login is disabled for the
  session; hover the icon for the reason.

## Troubleshooting

**Stuck in a login loop / "card or PIN incorrect" even though the credentials
work on the library site.** The content script auto-submits once per tab and
then stops — it will not keep resubmitting rejected credentials (each retry is a
failed login attempt that can temporarily lock the card). If the saved card/PIN
are rejected:

1. Open the extension's options page (right-click the toolbar icon → Options).
2. Re-enter the card number and PIN. Both are trimmed on save, but re-type
   rather than paste to avoid a hidden trailing space — that whitespace is the
   usual reason a login that works when typed by hand fails here.
3. Click the toolbar icon again to retry. The loop guard resets per browser tab.

## Customizing for a different library

Change `REDEEM_URL` in `background.js` and the `host_permissions` /
`content_scripts.matches` in `manifest.json` to your library's EZproxy host.
The form-field selectors in `content-ezproxy.js` cover the common OCLC
defaults but may need adjusting.

## Icons

The New York Times masthead "T" (black on transparent) lives in `icons/` at 16,
32, 48, and 128px, wired into `manifest.json` via `action.default_icon` and the
top-level `icons` block. Swap in your own PNGs at those sizes to rebrand.
