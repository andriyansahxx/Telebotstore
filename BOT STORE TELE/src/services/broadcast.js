import { incBroadcastFail, resetBroadcastFail } from "../db/user.js";

export async function broadcastSafe({ telegram, userIds, sendFn, batchSize, delayMs }) {
  let ok = 0, fail = 0;

  for (let i = 0; i < userIds.length; i += batchSize) {
    const chunk = userIds.slice(i, i + batchSize);

    for (const uid of chunk) {
      try {
        await sendFn(uid);
        ok++;
        resetBroadcastFail(uid);
      } catch (e) {
        fail++;
        incBroadcastFail(uid);
      }
    }

    if (i + batchSize < userIds.length) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return { ok, fail };
}