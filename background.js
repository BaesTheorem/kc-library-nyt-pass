// KC Library NYT Pass — background service worker.
//
// Safeguards against the EZproxy intruder-lockout failure mode. A burst of
// failed logins trips EZproxy's abuse protection, which then drops the
// connection (ERR_EMPTY_RESPONSE) for the card or IP for a long cooldown. To
// make that impossible to trigger, we never auto-resubmit rejected credentials
// and we impose our own short cooldown after any failure, well below EZproxy's
// own threshold. State lives in chrome.storage.local so the limits hold across
// tabs, toolbar clicks, and service-worker restarts.

const REDEEM_URL =
  "https://kclibrary.idm.oclc.org/login?url=http://ezmyaccount.nytimes.com/grouppass/redir";

// After this many failures, pause auto-login for COOLDOWN_MS. Kept low so we
// back off long before EZproxy's intruder counter (commonly ~5) is reached.
const MAX_FAILS = 2;
const COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

// Only these load errors count as a server-side failure. ERR_ABORTED and the
// like fire during normal redirect chains and must NOT be treated as failures.
const HARD_ERROR = /EMPTY_RESPONSE|CONNECTION|TIMED_OUT|ADDRESS_UNREACHABLE|ERR_FAILED/i;

const DEFAULT_STATE = {
  failCount: 0,
  lastFailAt: 0,
  cooldownUntil: 0,
  redeemTabId: null,
};

async function getState() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_STATE));
  return { ...DEFAULT_STATE, ...stored };
}

function setBadge(text) {
  chrome.action.setBadgeText({ text });
  if (text) chrome.action.setBadgeBackgroundColor({ color: "#b00020" });
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
const isNytHost = (url) =>
  /(^|\.)nytimes\.com$/.test(hostOf(url)) || /-nytimes-com\./.test(hostOf(url));
const isEzproxyBase = (url) => hostOf(url) === "kclibrary.idm.oclc.org";

// Count any failed login attempt (credentials rejected or the server dropping
// the connection). After MAX_FAILS we pause auto-login to stay clear of
// EZproxy's intruder lockout.
async function recordFailure(reason) {
  const s = await getState();
  const failCount = s.failCount + 1;
  const patch = { failCount, lastFailAt: Date.now() };
  if (failCount >= MAX_FAILS) patch.cooldownUntil = Date.now() + COOLDOWN_MS;
  await chrome.storage.local.set(patch);
  setBadge("!");
  chrome.action.setTitle({
    title: patch.cooldownUntil
      ? `NYT pass paused ${Math.round(COOLDOWN_MS / 60000)} min after repeated login ` +
        `failures (${reason}). This avoids locking your card; re-check your card/PIN ` +
        `in options.`
      : `NYT pass: login failed (${reason}). One more failure pauses auto-login.`,
  });
}

async function recordSuccess() {
  await chrome.storage.local.set({ failCount: 0, lastFailAt: 0, cooldownUntil: 0 });
  setBadge("");
  chrome.action.setTitle({ title: "Redeem NYT pass" });
}

chrome.action.onClicked.addListener(async () => {
  const { libraryCard, libraryPin } = await chrome.storage.local.get([
    "libraryCard",
    "libraryPin",
  ]);
  if (!libraryCard || !libraryPin) {
    chrome.runtime.openOptionsPage();
    return;
  }

  const s = await getState();
  const now = Date.now();

  // Honor our own cooldown — do NOT open another login attempt while paused.
  if (s.cooldownUntil && now < s.cooldownUntil) {
    const mins = Math.ceil((s.cooldownUntil - now) / 60000);
    setBadge("!");
    chrome.action.setTitle({
      title:
        `NYT pass paused ${mins} min after repeated login failures. ` +
        `Re-check your card/PIN in options, then wait for it to clear.`,
    });
    return;
  }

  setBadge("");
  chrome.action.setTitle({ title: "Redeem NYT pass" });
  const tab = await chrome.tabs.create({ url: REDEEM_URL });
  await chrome.storage.local.set({ redeemTabId: tab.id });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "login-failed") {
    // The EZproxy login page showed an error (card/PIN rejected). Count it
    // toward the cooldown like any other failure.
    recordFailure("card/PIN rejected");
  } else if (msg?.type === "creds-updated") {
    // New credentials saved — clear the failure counters for a fresh attempt.
    chrome.storage.local.set({ failCount: 0, lastFailAt: 0, cooldownUntil: 0 });
    setBadge("");
    chrome.action.setTitle({ title: "Redeem NYT pass" });
  }
});

// EZproxy dropped the connection (ERR_EMPTY_RESPONSE and friends) — this is what
// an intruder lockout looks like. Back off hard.
chrome.webNavigation.onErrorOccurred.addListener(async (details) => {
  if (details.frameId !== 0) return;
  if (!HARD_ERROR.test(details.error || "")) return;
  const s = await getState();
  if (details.tabId !== s.redeemTabId) return;
  if (!isEzproxyBase(details.url)) return;
  await recordFailure((details.error || "").replace(/^net::/, ""));
});

// The tab reached NYT — redemption worked. Clear the failure counters.
chrome.webNavigation.onCompleted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  const s = await getState();
  if (details.tabId !== s.redeemTabId) return;
  if (isNytHost(details.url)) await recordSuccess();
});
