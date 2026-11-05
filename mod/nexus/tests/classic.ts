// Many tests describe the Classic dashboard. A first run now opens Orbit, so they start from a
// store written by the previous version (v3), which stays on Classic with its own settings.
export const CLASSIC = { prefs: { version: 3 } }

/** `stored`, plus a v3 `prefs` when the test did not bring its own. */
export const classic = <T extends Record<string, unknown>>(stored: T = {} as T): T & typeof CLASSIC => ('prefs' in stored ? stored : { ...stored, ...CLASSIC }) as T & typeof CLASSIC
