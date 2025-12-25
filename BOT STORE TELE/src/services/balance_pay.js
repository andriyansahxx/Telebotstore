import { getBalance, deductBalance } from "../db/balance.js";
import { fulfillOrder } from "../services/order_fulfill.js";

export async function payWithBalance({ userId, total, order }) {
  // SECURITY: double-check balance before deducting
  const bal = getBalance(userId);
  if (bal < total) {
    console.warn(`INSUFFICIENT_BALANCE: user=${userId}, balance=${bal}, needed=${total}`);
    return false;
  }

  // Deduct balance (SQL has built-in guard: AND balance >= ?)
  deductBalance(userId, total);
  
  // Verify deduction succeeded
  const newBal = getBalance(userId);
  if (newBal < 0) {
    console.error(`NEGATIVE_BALANCE_DETECTED: user=${userId}, balance=${newBal}`);
    throw new Error("NEGATIVE_BALANCE");
  }

  try {
    await fulfillOrder(order);
  } catch (e) {
    console.error("FULFILL_ORDER_ERR:", e);
    throw e;
  }

  return true;
}