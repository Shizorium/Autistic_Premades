import { MODULE_ID, FIRE_INCARNATE_ID, isItem } from "../lib/identifier.js";
import { postFlavorChat } from "../lib/hp.js";
import { mutateActor } from "../lib/area.js";

const PREFIX = "Fire Incarnate";
const SKIP_TYPES = new Set(["cold", "healing", "temphp", "none", "midi-none"]);
const inFlight = new Set();
const replacing = new Set();

export function registerFireIncarnate() {
  Hooks.on("dnd5e.postUseActivity", onPostUseActivity);
  Hooks.on("midi-qol.RollComplete", onMidiRollComplete);
}

function onPostUseActivity(activity) {
  handleUsedItem(activity?.item);
}

function onMidiRollComplete(workflow) {
  handleUsedItem(workflow?.item);
}

function handleUsedItem(item) {
  if (!item?.actor || !isItem(item, FIRE_INCARNATE_ID)) return;
  if (!isPrimaryHandler(item.actor)) return;
  const key = `${item.uuid}:${item.actor.uuid}`;
  if (inFlight.has(key)) return;
  inFlight.add(key);
  void activateFireIncarnate(item).finally(() => {
    setTimeout(() => inFlight.delete(key), 4000);
  });
}

async function activateFireIncarnate(item) {
  const actor = item.actor;
  if (!actor) return;
  replacing.add(actor.uuid);
  try {
    await clearFireIncarnate(actor);
    await mutateActor(actor, "createEmbeddedDocuments", "ActiveEffect", [{
      name: item.name,
      img: item.img,
      origin: item.uuid,
      transfer: false,
      disabled: false,
      duration: minuteDuration(),
      changes: resistanceChanges(),
      flags: {
        [MODULE_ID]: { fireIncarnate: true },
        dae: { stackable: "noneName" }
      }
    }]);
  } finally {
    replacing.delete(actor.uuid);
  }
  await postFlavorChat(
    actor,
    `<p><strong>${PREFIX}</strong> — сопротивление всему урону, кроме холода, на минуту.</p>`
  );
}

function resistanceChanges() {
  const types = Object.keys(CONFIG.DND5E?.damageTypes ?? {
    acid: true,
    bludgeoning: true,
    fire: true,
    force: true,
    lightning: true,
    necrotic: true,
    piercing: true,
    poison: true,
    psychic: true,
    radiant: true,
    slashing: true,
    thunder: true
  });
  return types
    .filter((type) => !SKIP_TYPES.has(type))
    .map((type) => ({
      key: "system.traits.dr.value",
      mode: CONST.ACTIVE_EFFECT_MODES.ADD,
      value: type,
      priority: 20
    }));
}

async function clearFireIncarnate(actor) {
  const ids = actor.effects
    .filter((effect) => effect.flags?.[MODULE_ID]?.fireIncarnate)
    .map((effect) => effect.id);
  if (ids.length) await mutateActor(actor, "deleteEmbeddedDocuments", "ActiveEffect", ids);
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
