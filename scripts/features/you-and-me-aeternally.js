import {
  MODULE_ID,
  YOU_AND_ME_AETERNALLY_ID,
  SOUL_FLAME_MAIN_ID,
  isItem
} from "../lib/identifier.js";
import { applyTempHp, postFlavorChat } from "../lib/hp.js";
import { mutateActor } from "../lib/area.js";

const PREFIX = "You and Me, Aeternally";
const inFlight = new Set();
const replacing = new Set();
const handledTurns = new Set();

export function registerYouAndMeAeternally() {
  Hooks.on("dnd5e.postUseActivity", onPostUseActivity);
  Hooks.on("midi-qol.RollComplete", onMidiRollComplete);
  Hooks.on("combatStart", onCombatStart);
  Hooks.on("combatTurnChange", onCombatTurnChange);
  Hooks.on("updateCombat", onUpdateCombat);
  Hooks.on("deleteCombat", onDeleteCombat);
  Hooks.on("deleteActiveEffect", onDeleteActiveEffect);
}

function onPostUseActivity(activity) {
  handleUsedItem(activity?.item);
}

function onMidiRollComplete(workflow) {
  handleUsedItem(workflow?.item);
}

function handleUsedItem(item) {
  if (!item?.actor || !isItem(item, YOU_AND_ME_AETERNALLY_ID)) return;
  if (!isPrimaryHandler(item.actor)) return;
  const key = `${item.uuid}:${item.actor.uuid}`;
  if (inFlight.has(key)) return;
  inFlight.add(key);
  void activate(item).finally(() => {
    setTimeout(() => inFlight.delete(key), 4000);
  });
}

async function activate(item) {
  const actor = item.actor;
  if (!actor) return;
  replacing.add(actor.uuid);
  try {
    await clearEffect(actor);
    await mutateActor(actor, "createEmbeddedDocuments", "ActiveEffect", [{
      name: item.name,
      img: item.img,
      origin: item.uuid,
      transfer: false,
      disabled: false,
      duration: minuteDuration(),
      changes: effectChanges(),
      flags: {
        [MODULE_ID]: { youAndMeAeternally: true },
        dae: { stackable: "noneName" }
      }
    }]);
  } finally {
    replacing.delete(actor.uuid);
  }

  const amount = 5 + warlockLevel(actor);
  await applyTempHp(actor, amount);
  const restored = await restoreCharge(actor, { silent: true });
  const chargeNote = restored ? ", восстановлен 1 заряд We, both Flame and Light" : "";
  await postFlavorChat(
    actor,
    `<p><strong>${PREFIX}</strong> — ${amount} временных хитов, сопротивление холоду, иммунитет к Испуганный и Очарованный на минуту${chargeNote}.</p>`
  );
}

function effectChanges() {
  return [
    {
      key: "system.traits.dr.value",
      mode: CONST.ACTIVE_EFFECT_MODES.ADD,
      value: "cold",
      priority: 20
    },
    {
      key: "system.traits.ci.value",
      mode: CONST.ACTIVE_EFFECT_MODES.ADD,
      value: "frightened",
      priority: 20
    },
    {
      key: "system.traits.ci.value",
      mode: CONST.ACTIVE_EFFECT_MODES.ADD,
      value: "charmed",
      priority: 20
    }
  ];
}

async function clearEffect(actor) {
  const ids = actor.effects
    .filter((effect) => effect.flags?.[MODULE_ID]?.youAndMeAeternally)
    .map((effect) => effect.id);
  if (ids.length) await mutateActor(actor, "deleteEmbeddedDocuments", "ActiveEffect", ids);
}

function hasEffect(actor) {
  return Boolean(actor?.effects?.some((effect) => effect.flags?.[MODULE_ID]?.youAndMeAeternally));
}

function onCombatStart(combat) {
  onTurnStart(combat, combat.combatant);
}

function onCombatTurnChange(combat, _prior, current) {
  const started = asCombatant(combat, current) ?? combat.combatant;
  onTurnStart(combat, started);
}

function onUpdateCombat(combat, changed) {
  if (!("turn" in changed) && !("round" in changed)) return;
  onTurnStart(combat, combat.combatant);
}

function onDeleteCombat() {
  handledTurns.clear();
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
  if (!actor || !hasEffect(actor)) return;
  if (!isPrimaryHandler(actor)) return;
  const key = `${combat?.id ?? "combat"}:${combat?.round ?? 0}:${combat?.turn ?? 0}:${combatant.id}`;
  if (handledTurns.has(key)) return;
  handledTurns.add(key);
  setTimeout(() => handledTurns.delete(key), 4000);
  void restoreCharge(actor);
}

async function restoreCharge(actor, { silent = false } = {}) {
  const item = actor.items.find((entry) => isItem(entry, SOUL_FLAME_MAIN_ID));
  if (!item) return false;
  const spent = Number(item.system?.uses?.spent) || 0;
  if (spent < 1) return false;
  await mutateActor(actor, "updateEmbeddedDocuments", "Item", [{
    _id: item.id,
    "system.uses.spent": spent - 1
  }]);
  if (!silent) {
    await postFlavorChat(
      actor,
      `<p><strong>${PREFIX}</strong> — восстановлен 1 заряд We, both Flame and Light.</p>`
    );
  }
  return true;
}

function onDeleteActiveEffect(effect) {
  if (!effect.flags?.[MODULE_ID]?.youAndMeAeternally) return;
  const actor = effect.parent;
  if (!actor || actor.documentName !== "Actor") return;
  if (replacing.has(actor.uuid)) return;
  if (!isPrimaryHandler(actor)) return;
  void postFlavorChat(actor, `<p><strong>${PREFIX}</strong> — растворилось.</p>`);
}

function warlockLevel(actor) {
  if (!actor) return 0;
  const fromClass = classLevels(actor.classes?.warlock)
    || classLevels(actor.classes?.get?.("warlock"));
  if (fromClass) return fromClass;

  const classes = actor.itemTypes?.class ?? actor.items?.filter?.((item) => item.type === "class") ?? [];
  const warlock = classes.find((item) => {
    const id = String(item.identifier ?? item.system?.identifier ?? "").toLowerCase();
    const name = String(item.name ?? "").toLowerCase();
    return id === "warlock" || name.includes("warlock") || name.includes("колдун");
  });
  const fromItem = classLevels(warlock);
  if (fromItem) return fromItem;

  if (actor.items.find((entry) => isItem(entry, SOUL_FLAME_MAIN_ID))) {
    return Number(actor.system?.details?.level) || 0;
  }
  return 0;
}

function classLevels(cls) {
  return Number(cls?.levels ?? cls?.system?.levels) || 0;
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
