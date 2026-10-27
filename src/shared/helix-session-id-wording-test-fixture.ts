/** Detect address used as a noun for Helix session identity; exclude verbs and distinct run:/dispatch:/group mailboxes. */
export const HELIX_SESSION_ID_AS_ADDRESS =
  /\b(?:orchestration|session|Helix|coordinator's|your(?: own)?) address\b|caller\.address|naming its address/i
