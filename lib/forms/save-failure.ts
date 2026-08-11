/** What to tell somebody whose save was rejected by the transport. Shared. */

/**
 * What to tell somebody whose save was REJECTED BY THE TRANSPORT rather than
 * answered by the server.
 *
 * This used to print `cause.message` verbatim, on the reasoning that the
 * server's own words beat a paraphrase — which is right for OUR errors and
 * wrong for these. A rejected `saveSelfDraft()` promise never carries an
 * application message: every failure the action itself can produce comes back
 * as `{ ok: false, error }`, not as a throw. So the only thing that reaches
 * here is Next.js's internal Server Action transport error, and an employee
 * was being shown "An unexpected response was received from the server" —
 * true, unactionable, and indistinguishable from the app being broken.
 *
 * The three cases are genuinely different repairs, so they get different
 * sentences (§0.7, §13.4).
 */
export function describeSaveFailure(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause ?? "");

  // Next's E394: the POST got a real HTTP response that was not RSC — an error
  // page or a redirect. In this app that is overwhelmingly a lapsed session.
  if (/unexpected response|Failed to find Server Action|text\/x-component/i.test(message)) {
    return "Your sign-in may have expired while you were filling this in. Open the app in a new tab, sign in again, then come back here and press Save draft.";
  }

  // A genuine network failure: fetch rejects rather than resolving.
  if (/fetch|network|load failed|connection/i.test(message)) {
    return "The connection dropped before your answers reached us. Check your signal and press Save draft again.";
  }

  return "Your answers could not be saved just now. Press Save draft to try again.";
}

/*
 * SHARED BY BOTH RATING FORMS, and extracted rather than copied.
 *
 * It lived inside the employee's form. The manager's screen needed the same
 * sentences, and a second copy is how the two drift — one gets a new case and
 * the other keeps telling somebody to do the wrong thing. There is one place a
 * transport failure is explained, and both forms read it.
 */
