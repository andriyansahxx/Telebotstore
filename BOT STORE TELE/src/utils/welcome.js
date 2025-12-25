export function makeWelcomeValueMedia(file_id, caption) {
  return JSON.stringify({ file_id, caption: caption || "" });
}

export function parseWelcomeValueMedia(value) {
  try {
    const obj = JSON.parse(value);
    if (obj && obj.file_id) return obj;
  } catch {}
  return null;
}
