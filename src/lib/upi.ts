// UPI helpers shared by the payment card and the scam shield. Pure.

/** UPI id: name@handle, handle letters only (no dot), as in "meera@upi" or "98765.43210@ybl". */
export function isUpiId(s: string): boolean {
  return /^[\w.\-]{2,256}@[a-zA-Z]{2,64}$/.test(s.trim());
}

/** Indian mobile: 10 digits starting 6-9; accepts +91 / 91 / 0091 / 0 prefixes, spaces, dashes, dots. Returns the 10 digits or null. */
export function isIndianPhone(s: string): string | null {
  const t = s.trim();
  if (/[^\d\s\-.()+]/.test(t) || (t.includes("+") && !t.startsWith("+"))) return null;
  const d = t.replace(/\D/g, "");
  const m = /^(?:91|0091|0)?([6-9]\d{9})$/.exec(d);
  return m ? m[1] : null;
}

/** upi://pay deep link; amount in rupees with 2 decimals. */
export function upiLink(p: { upiId: string; payee: string; amountPaise: number; orderNo: number }): string {
  const am = (p.amountPaise / 100).toFixed(2);
  return `upi://pay?pa=${encodeURIComponent(p.upiId)}&pn=${encodeURIComponent(p.payee)}&am=${am}&cu=INR&tn=${encodeURIComponent(`Dibs order ${p.orderNo}`)}`;
}
