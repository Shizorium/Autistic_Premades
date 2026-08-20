export function percentOfMaxHp(actor, fraction) {
  const max = Number(actor?.system?.attributes?.hp?.max) || 0;
  return Math.ceil(max * fraction);
}

export async function applyActorDamage(actor, damages, options = {}) {
  if (!actor) return null;
  const socket = globalThis.autisticPremades?.socket;
  if (socket && !game.user.isGM) {
    return socket.executeAsGM("applyDamage", actor.uuid, damages, options);
  }
  return actor.applyDamage(damages, options);
}

export async function postFlavorChat(actor, content) {
  if (!actor) return;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content
  });
}
