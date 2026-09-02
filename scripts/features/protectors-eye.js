import { MODULE_ID, PROTECTORS_EYE_ID, isItem } from "../lib/identifier.js";
import { postFlavorChat } from "../lib/hp.js";
import { mutateActor } from "../lib/area.js";

const handledUses = new Set();
const PASSIVE_SKILLS = ["ins", "prc"];
const PASSIVE_SCORE = 20;

export function registerProtectorsEye() {
  Hooks.on("dnd5e.postUseActivity", onPostUseActivity);
  Hooks.on("midi-qol.RollComplete", onMidiRollComplete);
  Hooks.on("deleteItem", onDeleteItem);
  registerPassiveOverride();
}

function onPostUseActivity(activity) {
  handleUsedItem(activity?.item ?? activity);
}

function onMidiRollComplete(workflow) {
  handleUsedItem(workflow?.item);
}

function handleUsedItem(item) {
  if (!item?.actor || !isItem(item, PROTECTORS_EYE_ID)) return;
  if (!isPrimaryHandler(item.actor)) return;
  const key = `${item.uuid}:${item.actor.uuid}`;
  if (handledUses.has(key)) return;
  handledUses.add(key);
  setTimeout(() => handledUses.delete(key), 4000);
  void toggleProtectorsEye(item);
}

function onDeleteItem(item) {
  if (!item?.actor || !isItem(item, PROTECTORS_EYE_ID)) return;
  void removeEyeEffects(item.actor);
}

async function toggleProtectorsEye(item) {
  const actor = item.actor;
  if (!actor) return;
  if (getEyeEffects(actor).length) {
    await removeEyeEffects(actor);
    await postFlavorChat(actor, `<p><strong>${item.name}</strong> — повязка надета.</p>`);
    return;
  }
  await applyEyeEffect(actor, item);
  await postFlavorChat(actor, `<p><strong>${item.name}</strong> — повязка снята.</p>`);
}

async function applyEyeEffect(actor, item) {
  await removeEyeEffects(actor);
  await mutateActor(actor, "createEmbeddedDocuments", "ActiveEffect", [{
    name: item.name,
    img: item.img,
    origin: item.uuid,
    transfer: false,
    disabled: false,
    duration: {},
    changes: [
      {
        key: "system.skills.ins.bonuses.check",
        mode: CONST.ACTIVE_EFFECT_MODES.ADD,
        value: "10",
        priority: 20
      },
      {
        key: "system.skills.prc.bonuses.check",
        mode: CONST.ACTIVE_EFFECT_MODES.ADD,
        value: "10",
        priority: 20
      },
      {
        key: "flags.midi-qol.disadvantage.attack.all",
        mode: CONST.ACTIVE_EFFECT_MODES.CUSTOM,
        value: "1",
        priority: 20
      }
    ],
    flags: {
      [MODULE_ID]: { protectorsEye: true }
    }
  }]);
}

async function removeEyeEffects(actor) {
  const ids = getEyeEffects(actor).map((effect) => effect.id);
  if (!ids.length) return;
  await mutateActor(actor, "deleteEmbeddedDocuments", "ActiveEffect", ids);
}

function getEyeEffects(actor) {
  return actor?.effects?.filter((effect) => effect.flags?.[MODULE_ID]?.protectorsEye) ?? [];
}

function isEyePassiveActive(actor) {
  return getEyeEffects(actor).some((effect) => !effect.disabled);
}

function applyProtectorsEyePassives(actor) {
  if (!isEyePassiveActive(actor)) return;
  for (const key of PASSIVE_SKILLS) {
    const skill = actor.system?.skills?.[key];
    if (skill) skill.passive = PASSIVE_SCORE;
  }
}

function registerPassiveOverride() {
  const wrap = function (wrapped, ...args) {
    const result = wrapped(...args);
    applyProtectorsEyePassives(this);
    return result;
  };
  if (globalThis.libWrapper) {
    const paths = [
      "CONFIG.Actor.documentClass.prototype.prepareDerivedData",
      "foundry.documents.Actor.prototype.prepareDerivedData"
    ];
    for (const target of paths) {
      try {
        libWrapper.register(MODULE_ID, target, wrap, "WRAPPER");
        return;
      } catch {
        // Try the next Foundry 13 path.
      }
    }
  }
  const proto = CONFIG.Actor?.documentClass?.prototype;
  if (!proto?.prepareDerivedData || proto._apProtectorsEyeWrapped) return;
  const original = proto.prepareDerivedData;
  proto.prepareDerivedData = function (...args) {
    return wrap.call(this, original.bind(this), ...args);
  };
  proto._apProtectorsEyeWrapped = true;
}

function isPrimaryHandler(actor) {
  const owners = game.users.filter((user) => user.active && !user.isGM && actor.testUserPermission(user, "OWNER"));
  if (owners.length) return owners[0].id === game.user.id;
  return game.user.isGM;
}
