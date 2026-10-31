// Scripts for the screens served by the Worker (login, setup, consent), loaded by src/views/layout.tsx.

// A form marked data-single-submit is sent only once. The consent form needs this: its POST uses up the
// consent transaction, so a second click (a double click, or a click while the first POST is running)
// cancels the first navigation and the second POST is rejected with an error page.
// The buttons are not disabled, because a disabled submitter drops its name and value
// (decision=approve) from the form data that is built after this event.
document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.hasAttribute("data-single-submit")) return;
  if (form.hasAttribute("data-submitting")) {
    event.preventDefault();
    return;
  }
  form.setAttribute("data-submitting", "");
  form.setAttribute("aria-busy", "true");
});

// A page restored from the back-forward cache keeps the mark; let its forms be sent again.
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  for (const form of document.querySelectorAll("form[data-submitting]")) {
    form.removeAttribute("data-submitting");
    form.removeAttribute("aria-busy");
  }
});
