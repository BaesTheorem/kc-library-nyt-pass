(async () => {
  const TAG = "[KC Library NYT Pass]";
  const ATTEMPT_KEY = "nytpass_submitted";

  // Loop guard. This content script re-runs on every load of the EZproxy
  // login page, including the page EZproxy re-renders after a *failed* login.
  // Without a guard it would refill and resubmit forever, and every retry is a
  // failed login attempt that can lock the library card. Only auto-submit once
  // per browser tab; if we already tried, hand the page back to the user.
  if (sessionStorage.getItem(ATTEMPT_KEY)) {
    const pageText = (document.body?.innerText || "").toLowerCase();
    if (/incorrect|invalid|not recognized|unable|failed/.test(pageText)) {
      console.warn(
        `${TAG} The library rejected the saved card/PIN, so auto-login stopped ` +
          `to avoid locking the card. Open the extension options and re-enter ` +
          `your card number and PIN (watch for a stray space), then click the ` +
          `toolbar icon again.`,
      );
    }
    return;
  }

  const { libraryCard, libraryPin } = await chrome.storage.local.get([
    "libraryCard",
    "libraryPin",
  ]);

  if (!libraryCard || !libraryPin) return;

  const cardSelectors = [
    'input[name="user"]',
    'input[name="username"]',
    'input[name="barcode"]',
    'input[id="user"]',
    'input[id="username"]',
  ];
  const pinSelectors = [
    'input[name="pass"]',
    'input[name="password"]',
    'input[name="pin"]',
    'input[type="password"]',
  ];

  const pick = (selectors) => {
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (el) return el;
    }
    return null;
  };

  const cardEl = pick(cardSelectors);
  const pinEl = pick(pinSelectors);

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

  // Trim defensively. A trailing space or newline saved with the PIN submits
  // verbatim and reads as "card/PIN incorrect" even when the credentials are
  // right — a common cause of a login that fails here but works when typed by
  // hand on the library site.
  setValue(cardEl, String(libraryCard).trim());
  setValue(pinEl, String(libraryPin).trim());

  // Mark the attempt BEFORE submitting so the post-failure reload is guarded.
  sessionStorage.setItem(ATTEMPT_KEY, "1");

  // Activate the real submit control when present (closest to a human click),
  // and fall back to form.submit() if there isn't one.
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
