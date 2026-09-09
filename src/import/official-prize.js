export function parseOfficialFirstPrizeSek(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;

  const match = /^Pris:\s*([0-9]+(?:\.[0-9]{3})*)\s*-/u.exec(text);
  if (!match) return null;

  const amountText = match[1];
  if (amountText.includes('.')) {
    const groups = amountText.split('.');
    if (groups[0].length < 1 || groups[0].length > 3) return null;
    if (groups.slice(1).some((group) => group.length !== 3)) return null;
  }

  const digits = amountText.replaceAll('.', '');
  if (!/^\d+$/.test(digits)) return null;
  const amount = Number(digits);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 999_999_999) return null;
  return amount;
}
