export function fmtWIB(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d) + " WIB";
}

export function remainingWIB(isoEnd) {
  if (!isoEnd) return "-";
  const end = new Date(isoEnd).getTime();
  const now = Date.now();
  const diff = end - now;
  if (diff <= 0) return "0 menit";

  const totalMin = Math.floor(diff / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;

  const parts = [];
  if (days) parts.push(`${days} hari`);
  if (hours) parts.push(`${hours} jam`);
  parts.push(`${mins} menit`);
  return parts.join(" ");
}