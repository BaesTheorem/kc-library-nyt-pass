// KC Library NYT Pass — background service worker.
//
// Safeguard against the EZproxy intruder-lockout failure mode: auto-login is a
// one-shot. On any failed attempt — card/PIN rejected, or the server dropping
// the connection (ERR_EMPTY_RESPONSE) — it disables itself for the rest of the
// browser session, so it can never hammer the library login into a lockout.
// Manual sign-in still works: the toolbar always opens the login page; only the
// auto-fill is suppressed. Re-entering credentials in options re-enables it.
// The disabled flag lives in chrome.storage.session, so it survives
// service-worker restarts and clears when the browser closes ("the session").

const REDEEM_URL =
  "https://kclibrary.idm.oclc.org/login?url=http://ezmyaccount.nytimes.com/grouppass/redir";

// Load errors that mean the request actually failed. ERR_ABORTED and friends
// fire during normal redirect chains and must NOT count as a failure.
const HARD_ERROR = /EMPTY_RESPONSE|CONNECTION|TIMED_OUT|ADDRESS_UNREACHABLE|ERR_FAILED/i;

function setBadge(on) {
  chrome.action.setBadgeText({ text: on ? "!" : "" });
  if (on) chrome.action.setBadgeBackgroundColor({ color: "#b00020" });
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
const isEzproxyBase = (url) => hostOf(url) === "kclibrary.idm.oclc.org";

async function disableAutoLogin(reason) {
  await chrome.storage.session.set({ autoLoginDisabled: true });
  setBadge(true);
  chrome.action.setTitle({
    title:
      `NYT pass: auto-login disabled for this session (${reason}). Click to open ` +
      `the login page and sign in manually; re-enter your card/PIN in options to ` +
      `re-enable auto-login.`,
  });
}

async function enableAutoLogin() {
  await chrome.storage.session.set({ autoLoginDisabled: false });
  setBadge(false);
  chrome.action.setTitle({ title: "Redeem NYT pass" });
}

// Keep the badge in sync with the session flag whenever the worker spins up.
// On a fresh browser session storage.session is empty, so the badge clears.
chrome.storage.session
  .get(["autoLoginDisabled"])
  .then(({ autoLoginDisabled }) => setBadge(!!autoLoginDisabled));

chrome.action.onClicked.addListener(async () => {
  const { libraryCard, libraryPin } = await chrome.storage.local.get([
    "libraryCard",
    "libraryPin",
  ]);
  if (!libraryCard || !libraryPin) {
    chrome.runtime.openOptionsPage();
    return;
  }

  // Always open the login page — manual sign-in must stay possible. If
  // auto-login is disabled, the content script just won't touch the form.
  const tab = await chrome.tabs.create({ url: REDEEM_URL });
  await chrome.storage.session.set({ redeemTabId: tab.id });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "auto-login-allowed") {
    chrome.storage.session.get(["autoLoginDisabled"]).then(({ autoLoginDisabled }) => {
      sendResponse({ allowed: !autoLoginDisabled });
    });
    return true; // keep the channel open for the async response
  }
  if (msg?.type === "login-failed") {
    // The EZproxy login page showed an error (card/PIN rejected).
    disableAutoLogin("card/PIN rejected");
  } else if (msg?.type === "creds-updated") {
    // New credentials saved — give auto-login another chance.
    enableAutoLogin();
  }
});

// EZproxy dropped the connection (ERR_EMPTY_RESPONSE and friends) — the content
// script can't see this (there's no page), so catch it here and disable too.
chrome.webNavigation.onErrorOccurred.addListener(async (details) => {
  if (details.frameId !== 0) return;
  if (!HARD_ERROR.test(details.error || "")) return;
  const { redeemTabId } = await chrome.storage.session.get(["redeemTabId"]);
  if (details.tabId !== redeemTabId) return;
  if (!isEzproxyBase(details.url)) return;
  await disableAutoLogin((details.error || "").replace(/^net::/, ""));
});
