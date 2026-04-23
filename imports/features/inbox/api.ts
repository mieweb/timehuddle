// Dev inbox — email capture removed in Phase 10 (Meteor server removed).
// The DevMailDoc type is kept for the InboxPage UI shell.

export interface DevMailDoc {
  _id?: string;
  to: string;
  from: string;
  subject: string;
  text?: string;
  html?: string;
  sentAt: Date;
}

/** Extract bare email from "Name <email>" or plain "email" format. */
export function extractEmailAddress(addr: string): string {
  const m = addr.match(/<([^>]+)>/);
  return (m ? m[1] : addr).trim().toLowerCase();
}
