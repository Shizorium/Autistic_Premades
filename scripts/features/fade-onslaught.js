import { MODULE_ID, FADE_ONSLAUGHT_ID, isItem } from "../lib/identifier.js";
import { applyActorDamage, percentOfMaxHp, postFlavorChat } from "../lib/hp.js";

const handledUses = new Set();
const ATTACK_BONUSES = ["mwak", "rwak", "msak", "rsak"];

export function registerFadeOnslaught() {
  const none = CONFIG.DND5E?.damageTypes?.none;
  if (none) none.label = "Без типа";
  Hooks.on("dnd5e.postUseActivity", onPostUseActivity);
  Hooks.on("midi-qol.RollComplete", onMidiRollComplete);
  migrateExistingEffects();
}

function onPostUseActivity(activity) {
  handleUsedItem(activity?.item ?? activity);
}

function onMidiRollComplete(workflow) {
  handleUsedItem(workflow?.item);
}

function handleUsedItem(item) {
  if (!isItem(item, FADE_ONSLAUGHT_ID) || !item.actor) return;
  if (!isPrimaryHandler(item.actor)) return;
  const key = `${item.uuid}:${item.actor.uuid}`;
  if (handledUses.has(key)) return;
  handledUses.add(key);
  setTimeout(() => handledUses.delete(key), 4000);
  void activateOnslaught(item);
}

function isPrimaryHandler(actor) {
  const owners = game.users.filter((user) => user.active && !user.isGM && actor.testUserPermission(user, "OWNER"));
  if (owners.length) return owners[0].id === game.user.id;
  return game.user.isGM;
}

async function activateOnslaught(item) {
  const actor = item.actor;
  if (!actor) return;
  const amount = hpCost(actor);
  if (amount > 0) {
    await applyActorDamage(actor, amount);
    await postFlavorChat(actor, `<p>−25% ПЗ (${amount})</p>`);
  }
  await applyOnslaughtEffect(actor, item);
}

function hpCost(actor) {
  const wanted = percentOfMaxHp(actor, 0.25);
  const hp = Number(actor.system?.attributes?.hp?.value) || 0;
  const temp = Number(actor.system?.attributes?.hp?.temp) || 0;
  const maxLoss = Math.max(0, hp + temp - 1);
  return Math.min(wanted, maxLoss);
}

async function applyOnslaughtEffect(actor, item) {
  const existing = actor.effects
    .filter((effect) => effect.flags?.[MODULE_ID]?.fadeOnslaught)
    .map((effect) => effect.id);
  if (existing.length) {
    await mutateActor(actor, "deleteEmbeddedDocuments", "ActiveEffect", existing);
  }

  const damageChanges = ATTACK_BONUSES.map((type) => ({
    key: `system.bonuses.${type}.damage`,
    mode: CONST.ACTIVE_EFFECT_MODES.ADD,
    value: "1d4[none]",
    priority: 20
  }));

  await mutateActor(actor, "createEmbeddedDocuments", "ActiveEffect", [{
    name: item.name,
    img: item.img,
    origin: item.uuid,
    transfer: false,
    disabled: false,
    duration: {
      seconds: 60,
      rounds: 10,
      startTime: game.time?.worldTime ?? 0,
      startRound: game.combat?.round ?? 0,
      startTurn: game.combat?.turn ?? 0
    },
    changes: [
      {
        key: "system.attributes.ac.bonus",
        mode: CONST.ACTIVE_EFFECT_MODES.ADD,
        value: "5",
        priority: 20
      },
      ...damageChanges
    ],
    flags: {
      [MODULE_ID]: { fadeOnslaught: true }
    }
  }]);
}

async function mutateActor(actor, method, documentName, payload) {
  const socket = globalThis.autisticPremades?.socket;
  if (socket && !game.user.isGM) {
    return socket.executeAsGM(method, actor.uuid, documentName, payload);
  }
  return actor[method](documentName, payload);
}

function migrateExistingEffects() {
  if (!game.user.isGM) return;
  for (const actor of game.actors) {
    for (const effect of actor.effects) {
      if (!effect.flags?.[MODULE_ID]?.fadeOnslaught) continue;
      let changed = false;
      const changes = effect.changes.map((change) => {
        if (change.value !== "1d4[midi-none]") return change;
        changed = true;
        return { ...change, value: "1d4[none]" };
      });
      if (changed) void effect.update({ changes });
    }
  }
}
