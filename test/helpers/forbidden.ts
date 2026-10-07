// Parent spec §10 and C1 spec §4: a confirmation is never a signature, an approval or proof of payment,
// and hours are never clock records.
export const FORBIDDEN: [string, RegExp][] = [
  ['verified approval', /verified approval/i], ['signature', /\bsignature\b/i], ['signed by', /\bsigned by\b/i],
  ['clock in', /\bclock[- ]?in\b/i], ['clock out', /\bclock[- ]?out\b/i], ['proof of payment', /proof of payment/i],
  ['approved by', /\bapproved by\b/i],
]
