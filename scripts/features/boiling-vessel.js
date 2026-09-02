import { MODULE_ID, BOILING_VESSEL_ID, isItem } from "../lib/identifier.js";
import { applyActorDamage, postFlavorChat } from "../lib/hp.js";
import { mutateActor } from "../lib/area.js";

const PREFIX = "Кипящий Сосуд";
const FIRE_DAMAGE = 5;
const handledUses = new Set();
const handledStarts = new Set();
const handledEnds = new Set();
const removing = new Set();

export function registerBoilingVessel() {
  Hooks.on("midi-qol.postActiveEffects", onPostActiveEffects);
  Hooks.on("midi-qol.RollComplete", onMidiRollComplete);
  Hooks.on("combatStart", onCombatStart);
  Hooks.on("combatTurnChange", onCombatTurnChange);
  Hooks.on("updateCombat", onUpdateCombat);
  Hooks.on("deleteCombat", onDeleteCombat);
  Hooks.on("deleteActiveEffect", onDeleteActiveEffect);
}

function onPostActiveEffects(workflow) {
  if (!isItem(workflow?.item, BOILING_VESSEL_ID)) return;
  void applyFromWorkflow(workflow);
}

function onMidiRollComplete(workflow) {
  if (!isItem(workflow?.item, BOILING_VESSEL_ID)) return;
  void applyFromWorkflow(workflow);
}

async function applyFromWorkflow(workflow) {
  const item = workflow?.item;
  const caster = workflow?.actor;
  if (!item || !caster) return;
  if (!isPrimaryHandler(caster)) return;

  const failed = getFailedSaveTokens(workflow);
  const saved = normalizeTokens(workflow.saves);
  if (!failed.length && !saved.length) return;

  const key = `${workflow.id ?? item.uuid}:${caster.uuid}`;
  if (handledUses.has(key)) return;
  handledUses.add(key);
  setTimeout(() => handledUses.delete(key), 4000);

  if (!failed.length) return;

  const dc = saveDc(workflow, item);
  const duration = minuteDuration();
  const origin = item.uuid;

  for (const token of failed) {
    const actor = token.actor;
    if (!actor) continue;
    await applyBoil(actor, {
      item,
      caster,
      dc,
      duration,
      origin
    });
  }
}

async function applyBoil(actor, { item, caster, dc, duration, origin }) {
  await clearBoilsFromCaster(caster.uuid, actor.uuid);
  await clearBoil(actor, caster.uuid);
  const created = await mutateActor(actor, "createEmbeddedDocuments", "ActiveEffect", [{
    name: item.name,
    img: item.img,
    origin,
    transfer: false,
    disabled: false,
    duration,
    changes: disadvantageChanges(),
    flags: {
      [MODULE_ID]: {
        boilingVessel: {
          dc,
          casterUuid: caster.uuid,
          itemId: item.id,
          origin
        }
      },
      dae: { stackable: "noneName" }
    }
  }]);
  const effect = created?.[0];
  await linkConcentration(caster, item, effect);
  await postFlavorChat(actor, `<p><strong>${PREFIX}</strong> — ${actor.name} закипает заживо.</p>`);
}

function disadvantageChanges() {
  const keys = [
    "flags.midi-qol.disadvantage.ability.check.str",
    "flags.midi-qol.disadvantage.ability.check.dex",
    "flags.midi-qol.disadvantage.ability.check.con",
    "flags.midi-qol.disadvantage.ability.save.str",
    "flags.midi-qol.disadvantage.ability.save.dex",
    "flags.midi-qol.disadvantage.ability.save.con",
    "flags.midi-qol.disadvantage.attack.str",
    "flags.midi-qol.disadvantage.attack.dex"
  ];
  return keys.map((key) => ({
    key,
    mode: CONST.ACTIVE_EFFECT_MODES.CUSTOM,
    value: "1",
    priority: 20
  }));
}

async function linkConcentration(caster, item, effect) {
  if (!caster || !effect) return;
  for (let attempt = 0; attempt < 20; attempt++) {
    const conc = getConcentrationEffect(caster, item);
    if (conc) {
      if (typeof conc.addDependent === "function") {
        try {
          await conc.addDependent(effect);
          return;
        } catch (error) {
          console.warn(`${PREFIX} | addDependent failed`, error);
        }
      }
      const dependents = foundry.utils.deepClone(conc.flags?.dnd5e?.dependents ?? []);
      if (!dependents.some((entry) => entry?.uuid === effect.uuid)) {
        dependents.push({ uuid: effect.uuid });
      }
      await mutateActor(caster, "updateEmbeddedDocuments", "ActiveEffect", [{
        _id: conc.id,
        "flags.dnd5e.dependents": dependents
      }]);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function getConcentrationEffect(caster, item) {
  if (!caster) return null;
  const concentrating = CONFIG.specialStatusEffects?.CONCENTRATING;
  for (const effect of caster.effects) {
    const concentratingOn = concentrating
      ? effect.statuses?.has(concentrating)
      : effect.type === "concentration";
    if (!concentratingOn && !caster.concentration?.effects?.has?.(effect)) continue;
    const data = effect.flags?.dnd5e?.item ?? {};
    if (data.id === item.id || data.uuid === item.uuid || data.data?._id === item.id) return effect;
    if (effect.origin === item.uuid) return effect;
  }
  return [...(caster.concentration?.effects ?? [])][0] ?? null;
}

function onCombatStart(combat) {
  onTurnStart(combat, combat.combatant);
}

function onCombatTurnChange(combat, prior, current) {
  const ended = asCombatant(combat, prior) ?? asCombatant(combat, combat.previous);
  const started = asCombatant(combat, current) ?? combat.combatant;
  if (ended) void onTurnEnd(combat, ended);
  if (started) void onTurnStart(combat, started);
}

function onUpdateCombat(combat, changed) {
  if (!("turn" in changed) && !("round" in changed)) return;
  const ended = asCombatant(combat, combat.previous);
  const started = combat.combatant;
  if (ended) void onTurnEnd(combat, ended);
  if (started) void onTurnStart(combat, started);
}

function onDeleteCombat() {
  handledStarts.clear();
  handledEnds.clear();
}

function asCombatant(combat, value) {
  if (!value || !combat) return null;
  if (typeof value === "string") return combat.combatants.get(value) ?? null;
  const id = value.combatantId ?? value._id ?? value.id;
  if (id && combat.combatants.has(id)) return combat.combatants.get(id);
  if (value.actor !== undefined || value.documentName === "Combatant") return value;
  return null;
}

function onTurnStart(combat, combatant) {
  const actor = combatant?.actor;
  if (!actor || !getBoilEffect(actor)) return;
  if (!isPrimaryHandler(actor)) return;
  const key = `${combat?.id ?? "combat"}:${combat?.round ?? 0}:${combat?.turn ?? 0}:${combatant.id}:start`;
  if (handledStarts.has(key)) return;
  handledStarts.add(key);
  setTimeout(() => handledStarts.delete(key), 4000);
  void tickFire(actor);
}

async function onTurnEnd(combat, combatant) {
  const actor = combatant?.actor;
  const effect = getBoilEffect(actor);
  if (!actor || !effect) return;
  if (!isPrimaryHandler(actor)) return;
  const key = `${combat?.id ?? "combat"}:${combat?.previous?.round ?? combat?.round}:${combat?.previous?.turn ?? combat?.turn}:${combatant.id}:end`;
  if (handledEnds.has(key)) return;
  handledEnds.add(key);
  setTimeout(() => handledEnds.delete(key), 4000);

  const dc = Number(effect.flags?.[MODULE_ID]?.boilingVessel?.dc) || 14;
  const saved = await rollSave(actor, "con", dc);
  if (!saved) return;
  await endBoil(actor, effect, { flavor: `<p><strong>${PREFIX}</strong> — ${actor.name} перестаёт кипеть.</p>` });
}

async function tickFire(actor) {
  await applyActorDamage(actor, [{ value: FIRE_DAMAGE, type: "fire" }], {
    [MODULE_ID]: { selfDamage: true }
  });
  await postFlavorChat(actor, `<p><strong>${PREFIX}</strong> — ${FIRE_DAMAGE} урона огнём.</p>`);
}

async function endBoil(actor, effect, { flavor } = {}) {
  const data = effect.flags?.[MODULE_ID]?.boilingVessel ?? {};
  removing.add(effect.uuid);
  try {
    await mutateActor(actor, "deleteEmbeddedDocuments", "ActiveEffect", [effect.id]);
    await endConcentration(data.casterUuid, data.origin, data.itemId);
    if (flavor) await postFlavorChat(actor, flavor);
  } finally {
    setTimeout(() => removing.delete(effect.uuid), 500);
  }
}

async function endConcentration(casterUuid, origin, itemId) {
  if (!casterUuid) return;
  const caster = await fromUuid(casterUuid);
  if (!caster) return;
  if (typeof caster.endConcentration === "function") {
    try {
      await caster.endConcentration(origin);
      return;
    } catch (error) {
      console.warn(`${PREFIX} | endConcentration failed`, error);
    }
  }
  const conc = getConcentrationEffect(caster, { id: itemId, uuid: origin });
  if (!conc) return;
  await mutateActor(caster, "deleteEmbeddedDocuments", "ActiveEffect", [conc.id]);
}

function onDeleteActiveEffect(effect) {
  if (!effect.flags?.[MODULE_ID]?.boilingVessel) return;
  if (removing.has(effect.uuid)) return;
  const actor = effect.parent;
  if (!actor || actor.documentName !== "Actor") return;
  if (!isPrimaryHandler(actor)) return;
  void postFlavorChat(actor, `<p><strong>${PREFIX}</strong> — ${actor.name} перестаёт кипеть.</p>`);
}

async function clearBoilsFromCaster(casterUuid, exceptUuid) {
  for (const other of actorsOnScene()) {
    if (other.uuid === exceptUuid) continue;
    const effect = getBoilEffect(other);
    if (effect?.flags?.[MODULE_ID]?.boilingVessel?.casterUuid !== casterUuid) continue;
    await clearBoil(other, casterUuid);
  }
}

function actorsOnScene() {
  const seen = new Set();
  const actors = [];
  for (const token of canvas.tokens?.placeables ?? []) {
    const actor = token.actor;
    if (!actor || seen.has(actor.uuid)) continue;
    seen.add(actor.uuid);
    actors.push(actor);
  }
  return actors;
}

async function clearBoil(actor, casterUuid) {
  const effects = actor.effects.filter((effect) => {
    const data = effect.flags?.[MODULE_ID]?.boilingVessel;
    if (!data) return false;
    return !casterUuid || data.casterUuid === casterUuid;
  });
  if (!effects.length) return;
  for (const effect of effects) removing.add(effect.uuid);
  await mutateActor(actor, "deleteEmbeddedDocuments", "ActiveEffect", effects.map((effect) => effect.id));
  setTimeout(() => {
    for (const effect of effects) removing.delete(effect.uuid);
  }, 500);
}

function getBoilEffect(actor) {
  if (!actor) return null;
  return (actor.appliedEffects ?? actor.effects ?? []).find((effect) => {
    return !effect.disabled && effect.flags?.[MODULE_ID]?.boilingVessel;
  }) ?? null;
}

function saveDc(workflow, item) {
  const fromWorkflow = Number(workflow?.saveDC ?? workflow?.saveDCs?.[0]);
  if (Number.isFinite(fromWorkflow) && fromWorkflow > 0) return fromWorkflow;
  const activity = workflow?.activity ?? Object.values(item.system?.activities ?? {})[0];
  const formula = Number(activity?.save?.dc?.formula);
  if (Number.isFinite(formula) && formula > 0) return formula;
  return 14;
}

function getFailedSaveTokens(workflow) {
  const failed = normalizeTokens(workflow.failedSaves);
  const savedIds = new Set(normalizeTokens(workflow.saves).map(tokenId));
  if (failed.length) {
    return savedIds.size ? failed.filter((token) => !savedIds.has(tokenId(token))) : failed;
  }
  if (!savedIds.size) return [];
  return normalizeTokens(workflow.targets).filter((token) => !savedIds.has(tokenId(token)));
}

function normalizeTokens(collection) {
  if (!collection) return [];
  const tokens = [];
  for (const entry of collection) {
    const token = asToken(entry);
    if (token?.actor) tokens.push(token);
  }
  return tokens;
}

function asToken(entry) {
  if (!entry) return null;
  if (entry.actor && (entry.document || entry.center)) return entry;
  if (entry.object?.actor) return entry.object;
  if (typeof entry === "string") {
    const doc = fromUuidSync(entry);
    return doc?.object ?? (doc?.actor ? doc : null);
  }
  return null;
}

function tokenId(token) {
  return token.document?.uuid ?? token.uuid ?? token.id;
}

async function rollSave(actor, ability, dc) {
  try {
    if (typeof actor.rollSavingThrow === "function") {
      const result = await actor.rollSavingThrow(
        {
          ability,
          target: dc,
          dc,
          difficultyClass: { value: dc }
        },
        { configure: false },
        { create: true }
      );
      const roll = Array.isArray(result) ? result[0] : result;
      const total = Number(roll?.total ?? roll?._total);
      if (Number.isFinite(total)) return total >= dc;
    }
    if (typeof actor.rollAbilitySave === "function") {
      const result = await actor.rollAbilitySave(ability, {
        targetValue: dc,
        chatMessage: true
      });
      const roll = Array.isArray(result) ? result[0] : result;
      const total = Number(roll?.total ?? roll?._total);
      if (Number.isFinite(total)) return total >= dc;
    }
  } catch (error) {
    console.warn(`${PREFIX} | Save roll failed, rolling silently`, error);
  }
  const bonus = Number(actor.system?.abilities?.[ability]?.save ?? actor.system?.abilities?.[ability]?.mod) || 0;
  const roll = await new Roll(`1d20 + ${bonus}`).evaluate();
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `Спасбросок Выносливости (DC ${dc})`
  });
  return roll.total >= dc;
}

function minuteDuration() {
  return {
    seconds: 60,
    rounds: 10,
    startTime: game.time?.worldTime ?? 0,
    startRound: game.combat?.round ?? 0,
    startTurn: game.combat?.turn ?? 0
  };
}

function isPrimaryHandler(actor) {
  const owners = game.users.filter((user) => user.active && !user.isGM && actor.testUserPermission(user, "OWNER"));
  if (owners.length) return owners[0].id === game.user.id;
  return game.user.isGM;
}
