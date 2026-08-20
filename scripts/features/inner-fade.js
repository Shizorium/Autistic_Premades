import { INNER_FADE_ID, isItem } from "../lib/identifier.js";
import { applyActorDamage, percentOfMaxHp, postFlavorChat } from "../lib/hp.js";

const handledKills = new Set();
const handledTurnEnds = new Set();
const turnStartPos = new Map();
const movedThisTurn = new Set();
const pendingTurnPos = new WeakMap();

export function registerInnerFade() {
  Hooks.on("combatStart", onCombatStart);
  Hooks.on("combatTurnChange", onCombatTurnChange);
  Hooks.on("updateCombat", onUpdateCombat);
  Hooks.on("deleteCombat", onDeleteCombat);
  Hooks.on("preUpdateToken", onPreUpdateToken);
  Hooks.on("updateToken", onUpdateToken);
  Hooks.on("midi-qol.RollComplete", onMidiRollComplete);
}

export async function healFromKill(killer, victim) {
  if (!killer || !hasInnerFade(killer)) return;
  if (victim && victim === killer) return;
  const amount = percentOfMaxHp(killer, 0.15);
  if (amount <= 0) return;
  await applyActorDamage(killer, [{ value: amount, type: "healing" }]);
  await postFlavorChat(killer, `<p><strong>Тепло.</strong> +${amount} ПЗ</p>`);
}

function hasInnerFade(actor) {
  return Boolean(actor?.items?.some((item) => isItem(item, INNER_FADE_ID)));
}

function isPrimaryGm() {
  return !game.users.activeGM || game.user.isGM;
}

function onCombatStart(combat) {
  if (!isPrimaryGm()) return;
  onTurnStart(combat.combatant);
}

function onCombatTurnChange(combat, prior, current) {
  if (!isPrimaryGm()) return;
  const ended = asCombatant(combat, prior) ?? asCombatant(combat, combat.previous);
  const started = asCombatant(combat, current) ?? combat.combatant;
  if (ended) void onTurnEnd(combat, ended);
  if (started) onTurnStart(started);
}

function onUpdateCombat(combat, changed) {
  if (!isPrimaryGm()) return;
  if (!("turn" in changed) && !("round" in changed)) return;
  const ended = asCombatant(combat, combat.previous);
  const started = combat.combatant;
  if (ended) void onTurnEnd(combat, ended);
  if (started) onTurnStart(started);
}

function asCombatant(combat, value) {
  if (!value || !combat) return null;
  if (typeof value === "string") return combat.combatants.get(value) ?? null;
  const id = value.combatantId ?? value._id ?? value.id;
  if (id && combat.combatants.has(id)) return combat.combatants.get(id);
  if (value.actor !== undefined || value.documentName === "Combatant") return value;
  return null;
}

function onDeleteCombat() {
  turnStartPos.clear();
  movedThisTurn.clear();
  handledTurnEnds.clear();
}

function onTurnStart(combatant) {
  const actor = combatant?.actor;
  if (!actor || !hasInnerFade(actor)) return;
  const token = combatant.token ?? actor.getActiveTokens()?.[0]?.document;
  if (!token) return;
  turnStartPos.set(actor.uuid, { x: token.x, y: token.y });
  movedThisTurn.delete(actor.uuid);
}

async function onTurnEnd(combat, combatant) {
  const actor = combatant?.actor;
  if (!actor || !hasInnerFade(actor)) return;
  const key = `${combat?.id ?? "combat"}:${combat?.previous?.round ?? combat?.round}:${combat?.previous?.turn ?? combat?.turn}:${combatant.id}`;
  if (handledTurnEnds.has(key)) return;
  handledTurnEnds.add(key);
  setTimeout(() => handledTurnEnds.delete(key), 4000);

  const start = turnStartPos.get(actor.uuid);
  const token = combatant.token ?? actor.getActiveTokens()?.[0]?.document;
  const moved = movedThisTurn.has(actor.uuid)
    || Boolean(start && token && (token.x !== start.x || token.y !== start.y));
  movedThisTurn.delete(actor.uuid);
  turnStartPos.delete(actor.uuid);
  const fraction = moved ? 0.05 : 0.30;
  const amount = percentOfMaxHp(actor, fraction);
  if (amount <= 0) return;
  await applyActorDamage(actor, amount);
  await postFlavorChat(
    actor,
    `<p>${moved ? "−5%" : "−30%"} ПЗ (${amount})${moved ? "" : ", без движения"}</p>`
  );
}

function onPreUpdateToken(tokenDoc, changes) {
  if (!("x" in changes) && !("y" in changes)) return;
  pendingTurnPos.set(tokenDoc, { x: tokenDoc.x, y: tokenDoc.y });
}

function onUpdateToken(tokenDoc, changes) {
  if (!isPrimaryGm()) return;
  if (!("x" in changes) && !("y" in changes)) return;
  const actor = tokenDoc.actor;
  if (!actor || !hasInnerFade(actor)) return;
  if (!isActorsTurn(actor)) return;
  const previous = pendingTurnPos.get(tokenDoc);
  pendingTurnPos.delete(tokenDoc);
  const oldX = previous?.x ?? tokenDoc.x;
  const oldY = previous?.y ?? tokenDoc.y;
  if (oldX === tokenDoc.x && oldY === tokenDoc.y) return;
  movedThisTurn.add(actor.uuid);
}

function isActorsTurn(actor) {
  const combat = game.combat;
  if (!combat?.started) return false;
  return combat.combatant?.actor?.uuid === actor.uuid;
}

function onMidiRollComplete(workflow) {
  if (game.users.activeGM && !game.user.isGM) return;
  const killer = workflow?.actor;
  if (!hasInnerFade(killer)) return;
  const list = workflow.damageList ?? [];
  for (const entry of list) {
    if (!(entry.oldHP > 0 && entry.newHP <= 0)) continue;
    if (!(entry.hpDamage > 0 || entry.healingAdjustedTotalDamage > 0 || entry.totalDamage > 0)) continue;
    const victimUuid = entry.actorUuid ?? entry.uuid;
    const key = `${workflow.id ?? workflow.itemUuid ?? "roll"}:${victimUuid}`;
    if (handledKills.has(key)) continue;
    handledKills.add(key);
    setTimeout(() => handledKills.delete(key), 8000);
    const victim = victimUuid ? fromUuidSync(victimUuid) : null;
    if (victim?.documentName === "Token") {
      void healFromKill(killer, victim.actor);
    } else {
      void healFromKill(killer, victim);
    }
  }
}
