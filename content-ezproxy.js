(async () => {
  const TAG = "[KC Library NYT Pass]";
  const ATTEMPT_KEY = "nytpass_submitted";

  const pageText = (document.body?.innerText || "").toLowerCase();
  const loginRejected = /incorrect|invalid|not recognized|unable|failed/.test(pageText);

  const { libraryCard, libraryPin } = await chrome.storage.local.get([
    "libraryCard",
    "libraryPin",
  ]);

  // This is the page EZproxy re-renders after a failed login. Tell the
  // background to disable auto-login for the session, then leave the form so the
  // user can sign in manually. Never resubmit.
  if (loginRejected && libraryCard && libraryPin) {
    chrome.runtime.sendMessage({ type: "login-failed" });
    console.warn(
      `${TAG} The library rejected the saved card/PIN. Auto-login is now off for ` +
        `this session — sign in manually here, and re-enter your card/PIN in the ` +
        `extension options to re-enable it.`,
    );
    return;
  }

  if (!libraryCard || !libraryPin) return;

  // Per-tab guard: auto-submit at most once per tab, even across reloads.
  if (sessionStorage.getItem(ATTEMPT_KEY)) return;

  // Respect the session-level disable set after any failed attempt. When off,
  // leave the form untouched so the user can sign in manually.
  const resp = await chrome.runtime.sendMessage({ type: "auto-login-allowed" });
  if (!resp || !resp.allowed) {
    console.warn(
      `${TAG} Auto-login is disabled for this session. Sign in manually, or ` +
        `re-enter your card/PIN in options to re-enable it.`,
    );
    return;
  }

  const pick = (selectors) => {
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (el) return el;
    }
    return null;
  };

  const cardEl = pick([
    'input[name="user"]',
    'input[name="username"]',
    'input[name="barcode"]',
    'input[id="user"]',
    'input[id="username"]',
  ]);
  const pinEl = pick([
    'input[name="pass"]',
    'input[name="password"]',
    'input[name="pin"]',
    'input[type="password"]',
  ]);

  if (!cardEl || !pinEl) {
    console.warn(`${TAG} Could not find login form fields.`);
    return;
  }

  const setValue = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };

  // Trim defensively. A trailing space saved with the PIN submits verbatim and
  // reads as "card/PIN incorrect" even when the credentials are right.
  setValue(cardEl, String(libraryCard).trim());
  setValue(pinEl, String(libraryPin).trim());

  // Mark the attempt BEFORE submitting so the post-failure reload is guarded.
  sessionStorage.setItem(ATTEMPT_KEY, "1");

  const form = cardEl.closest("form");
  const submitEl =
    (form &&
      form.querySelector(
        'input[type="submit"], button[type="submit"], button:not([type])',
      )) ||
    document.querySelector('input[type="submit"], button[type="submit"]');

  if (submitEl) {
    submitEl.click();
  } else if (form) {
    form.submit();
  }
})();
