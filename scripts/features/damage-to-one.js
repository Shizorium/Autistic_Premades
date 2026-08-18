import { MODULE_ID, DAMAGE_TO_ONE_ID, isItem } from "../lib/identifier.js";

export function registerDamageToOne() {
  Hooks.on("createItem", onCreateItem);
  Hooks.on("dnd5e.calculateDamage", onCalculateDamage);
  Hooks.on("dnd5e.preApplyDamage", onPreApplyDamage);
}

function onCreateItem(item) {
  if (!isItem(item, DAMAGE_TO_ONE_ID) || !item.actor) return;
  void cleanupDuplicateEffects(item.actor);
}

function onCalculateDamage(actor, damages) {
  if (!hasDamageToOne(actor) || !(damages?.amount > 0)) return;
  damages.amount = 1;
  let remaining = 1;
  for (const entry of damages) {
    if (!entry || typeof entry.value !== "number") continue;
    if (isHealingEntry(entry)) continue;
    if (entry.value <= 0) continue;
    entry.value = remaining;
    remaining = 0;
  }
}

function onPreApplyDamage(actor, amount, updates) {
  if (!hasDamageToOne(actor) || !(amount > 0) || !updates) return;
  const hp = actor.system?.attributes?.hp;
  if (!hp) return;
  const temp = Number(hp.temp) || 0;
  const value = Number(hp.value) || 0;
  const deltaTemp = Math.min(temp, 1);
  const deltaHP = 1 - deltaTemp;
  updates["system.attributes.hp.temp"] = temp - deltaTemp;
  updates["system.attributes.hp.value"] = value - deltaHP;
}

function hasDamageToOne(actor) {
  if (!actor) return false;
  if (foundry.utils.getProperty(actor, `flags.${MODULE_ID}.damageToOne`)) return true;
  const effects = actor.appliedEffects ?? actor.effects ?? [];
  return effects.some((effect) => !effect.disabled && effect.flags?.[MODULE_ID]?.damageToOne);
}

function isHealingEntry(entry) {
  if (entry.type === "temphp" || entry.type === "healing" || entry.type === "maximum") return true;
  return Boolean(CONFIG.DND5E?.healingTypes?.[entry.type]);
}

async function cleanupDuplicateEffects(actor) {
  const extra = actor.effects
    .filter((effect) => effect.flags?.[MODULE_ID]?.damageToOne && !effect.transfer)
    .map((effect) => effect.id);
  if (!extra.length) return;
  await mutateActor(actor, "deleteEmbeddedDocuments", "ActiveEffect", extra);
}

async function mutateActor(actor, method, documentName, payload) {
  const socket = globalThis.autisticPremades?.socket;
  if (socket && !game.user.isGM) {
    return socket.executeAsGM(method, actor.uuid, documentName, payload);
  }
  return actor[method](documentName, payload);
}
