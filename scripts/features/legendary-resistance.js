import { LEGENDARY_RESISTANCE_ID, isItem } from "../lib/identifier.js";
import { percentOfMaxHp, applyActorDamage, postFlavorChat } from "../lib/hp.js";

const pendingSpend = new WeakMap();

export function registerLegendaryResistance() {
  globalThis.autisticPremades ??= {};
  globalThis.autisticPremades.spendLegendaryResistanceHp = spendLegendaryResistanceHp;
  Hooks.on("preUpdateItem", onPreUpdateItem);
  Hooks.on("updateItem", onUpdateItem);
  migrateExistingEffects();
}

async function spendLegendaryResistanceHp(scope = {}) {
  const actor = scope.actor ?? scope;
  if (!actor?.system?.attributes?.hp) return;
  const amount = percentOfMaxHp(actor, 0.15);
  if (amount <= 0) return;
  await applyActorDamage(actor, amount);
  await postFlavorChat(actor, `<p>Легендарное сопротивление: −${amount} ПЗ</p>`);
}

function onPreUpdateItem(item, changes) {
  if (!isItem(item, LEGENDARY_RESISTANCE_ID)) return;
  const next = foundry.utils.getProperty(changes, "system.uses.spent");
  if (!Number.isNumeric(next)) return;
  const prev = Number(item.system?.uses?.spent) || 0;
  if (Number(next) > prev) pendingSpend.set(item, true);
}

function onUpdateItem(item) {
  if (!pendingSpend.has(item)) return;
  pendingSpend.delete(item);
  if (game.users.activeGM && !game.user.isGM) return;
  void spendLegendaryResistanceHp(item.actor);
}

function migrateExistingEffects() {
  if (!game.user.isGM) return;
  const strip = (effect) => {
    const changes = effect.changes.filter((change) => change.key !== "flags.midi-qol.optional.apFadeLR.macroToCall");
    if (changes.length === effect.changes.length) return;
    void effect.update({ changes });
  };
  for (const actor of game.actors) {
    actor.effects.forEach(strip);
    for (const item of actor.items) item.effects.forEach(strip);
  }
}
