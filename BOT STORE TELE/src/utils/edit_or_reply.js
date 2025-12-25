export async function editOrReply(ctx, text, extra = {}) {
  // Kalau berasal dari inline keyboard → edit
  if (ctx.updateType === "callback_query") {
    try {
      return await ctx.editMessageText(text, extra);
    } catch {}
  }
  // Kalau berasal dari reply keyboard / text → reply
  return ctx.reply(text, extra);
}