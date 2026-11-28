
export function __oxabl_stash_panic(message) {
  try {
    globalThis.__oxablPanicMessage = message;
  } catch (_) {
    // A frozen or exotic global is not worth trapping over inside a panic hook:
    // the website falls back to a fixed no-message diagnostic.
  }
}
