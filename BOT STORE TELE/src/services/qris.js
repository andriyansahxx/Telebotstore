export function qrisPreviewUrl(text) {
  // Large QR code for full scanning capability (no cropping)
  // 800x800 is large enough to be scanned easily
  const base = "https://api.qrserver.com/v1/create-qr-code/";
  return `${base}?size=800x800&data=${encodeURIComponent(text)}`;
}