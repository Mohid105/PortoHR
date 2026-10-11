'use strict';

/** Sign-in protection. Tune here; nothing else hard-codes these numbers. */
const SECURITY = {
  /** Wrong passwords in a row before the account is locked. */
  maxFailedLogins: 5,
  /** How long a locked account stays locked, in minutes. */
  lockMinutes: 15,
  /** Sign-in history is kept this long. */
  eventRetentionDays: 180,
};

module.exports = { SECURITY };
