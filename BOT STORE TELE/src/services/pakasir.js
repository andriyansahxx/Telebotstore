const BASE = "https://app.pakasir.com";

// get pakasir config: from tenant if set, fallback to .env
export function getPakasirConfig(tenantConfig) {
  // tenantConfig can be { pakasir_slug, pakasir_api_key, qris_only } from tenant record
  // or null to use defaults
  const slug = tenantConfig?.pakasir_slug || process.env.PAKASIR_SLUG;
  const apiKey = tenantConfig?.pakasir_api_key || process.env.PAKASIR_API_KEY;
  const qrisOnly = tenantConfig?.qris_only ?? (process.env.PAKASIR_QRIS_ONLY === "1");
  
  if (!slug || !apiKey) return null;
  return { slug, apiKey, qrisOnly };
}

export function payUrl({ slug, amount, orderId, qrisOnly }) {
  // docs: /pay/{slug}/{amount}?order_id=... (&qris_only=1)
  const url = new URL(`${BASE}/pay/${encodeURIComponent(slug)}/${encodeURIComponent(amount)}`);
  url.searchParams.set("order_id", orderId);
  if (qrisOnly) url.searchParams.set("qris_only", "1");
  return url.toString();
}

export async function transactionDetail({ slug, apiKey, amount, orderId }) {
  // docs: GET /api/transactiondetail?project={slug}&amount={amount}&order_id={order_id}&api_key={api_key}
  const url = new URL(`${BASE}/api/transactiondetail`);
  url.searchParams.set("project", slug);
  url.searchParams.set("amount", String(amount));
  url.searchParams.set("order_id", String(orderId));
  url.searchParams.set("api_key", String(apiKey));

  try {
    const res = await fetch(url.toString(), { method: "GET" });
    if (!res.ok) {
      const text = await res.text();
      console.warn(`Pakasir transactiondetail HTTP ${res.status}: ${text.slice(0, 200)}`);
      if (res.status === 404) {
        // transaction not found yet - API hasn't received payment yet
        return null;
      }
      throw new Error(`Pakasir transactiondetail HTTP ${res.status}`);
    }
    return await res.json();
  } catch (e) {
    console.error("transactionDetail fetch error:", e.message);
    throw e;
  }
}

// get pakasir config by tenant id (fetch tenant record, fallback to env)
export function getPakasirConfigByTenant(tenantId = 0) {
  if (tenantId) {
    try {
      const { getTenant } = require("../db/tenant.js");
      const t = getTenant(tenantId);
      if (t?.pakasir_slug && t?.pakasir_api_key) {
        return {
          slug: t.pakasir_slug,
          apiKey: t.pakasir_api_key,
          qrisOnly: !!t.qris_only,
        };
      }
    } catch (e) {
      // ignore and fallback
    }
  }

  // fallback to global env
  const slug = process.env.PAKASIR_SLUG;
  const apiKey = process.env.PAKASIR_API_KEY;
  const qrisOnly = process.env.PAKASIR_QRIS_ONLY === "1";
  if (!slug || !apiKey) return null;
  return { slug, apiKey, qrisOnly };
}

export async function createQrisTx({ slug, apiKey, orderId, amount }) {
  // Create QRIS transaction via Pakasir API
  // Returns response with qr_string and expired timestamp
  const res = await fetch("https://app.pakasir.com/api/transactioncreate/qris", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project: slug,
      order_id: orderId,
      amount: Number(amount),
      api_key: apiKey,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Pakasir createQrisTx HTTP ${res.status}: ${text.slice(0, 200)}`);
    throw new Error(`Pakasir createQrisTx HTTP ${res.status}`);
  }

  const data = await res.json();
  if (!data.success && data.error) {
    console.error("Pakasir createQrisTx error:", data.error);
    throw new Error(`Pakasir: ${data.error}`);
  }

  // Log full response untuk debug
  console.log("📦 createQrisTx FULL RESPONSE:", JSON.stringify(data).slice(0, 500));
  
  return data;
}