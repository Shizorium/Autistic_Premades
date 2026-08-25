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

export async function updateActorDocument(actor, changes) {
  if (!actor) return null;
  if (game.user.isGM || actor.isOwner) return actor.update(changes);
  const socket = globalThis.autisticPremades?.socket;
  if (socket) return socket.executeAsGM("updateActor", actor.uuid, changes);
  return actor.update(changes);
}

export async function postFlavorChat(actor, content) {
  if (!actor) return;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content
  });
}
