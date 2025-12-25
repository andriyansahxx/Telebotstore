const cache = new Map(); // fileId -> {buf, exp}

export async function loadTelegramFileBuffer(telegram, fileId) {
  if (!fileId) {
    console.log("⚠️ LOGO_LOADER: fileId is null/empty");
    return null;
  }

  try {
    const now = Date.now();
    const cached = cache.get(fileId);
    if (cached && cached.exp > now) {
      console.log("✅ LOGO_LOADER: Using cached buffer for", fileId, `(${cached.buf.length} bytes)`);
      return cached.buf;
    }

    console.log("📥 LOGO_LOADER: Downloading", fileId);
    const link = await telegram.getFileLink(fileId);
    console.log("🔗 LOGO_LOADER: File link:", link.href.substring(0, 100) + "...");
    
    const res = await fetch(link.href);
    if (!res.ok) {
      console.error("❌ LOGO_LOADER: Fetch failed with status", res.status);
      throw new Error(`logo_download_failed: ${res.status}`);
    }

    const arr = await res.arrayBuffer();
    const buf = Buffer.from(arr);
    
    console.log("✅ LOGO_LOADER: Downloaded", fileId, `(${buf.length} bytes)`);

    // cache 10 menit
    cache.set(fileId, { buf, exp: now + 10 * 60 * 1000 });
    return buf;
  } catch (e) {
    console.error("❌ LOGO_LOADER_ERROR:", fileId, e?.message);
    return null;
  }
}