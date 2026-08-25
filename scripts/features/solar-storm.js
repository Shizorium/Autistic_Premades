import {
  MODULE_ID,
  SOLAR_STORM_ID,
  SOLAR_STORM_RAY_ID,
  isItem
} from "../lib/identifier.js";
import { applyActorDamage, postFlavorChat } from "../lib/hp.js";
import { mutateActor, pickTokenFromList } from "../lib/area.js";

const PREFIX = "Solar Storm";
const OPTIONAL_KEY = "apSolarStorm";
const RAY_FORMULA = "2d6[radiant]";
const inFlight = new Set();
const replacing = new Set();

export function registerSolarStorm() {
  Hooks.on("dnd5e.postUseActivity", onPostUseActivity);
  Hooks.on("midi-qol.RollComplete", onMidiRollComplete);
  Hooks.on("deleteActiveEffect", onDeleteActiveEffect);
  Hooks.on("updateActor", onUpdateActor);
  Hooks.on("combatTurnChange", onCombatTurnChange);
  suppressBonusRollCards();
}

function suppressBonusRollCards() {
  if (!game.user.isGM) return;
  const actors = new Set(game.actors);
  for (const token of canvas.tokens?.placeables ?? []) {
    if (token.actor) actors.add(token.actor);
  }
  for (const actor of actors) {
    const effect = actor.effects.find((entry) => entry.flags?.[MODULE_ID]?.solarStorm);
    if (!effect) continue;
    const weapon = actor.items.get(effect.flags[MODULE_ID].weaponId);
    if (!weapon) continue;
    if (weapon.getFlag("midi-qol", `optional.${OPTIONAL_KEY}.displayBonusRolls`) === false) continue;
    void mutateActor(actor, "updateEmbeddedDocuments", "Item", [{
      _id: weapon.id,
      [`flags.midi-qol.optional.${OPTIONAL_KEY}.displayBonusRolls`]: false
    }]);
  }
}

function onPostUseActivity(activity) {
  handleUsedItem(activity?.item);
}

function onMidiRollComplete(workflow) {
  handleUsedItem(workflow?.item);
}

function handleUsedItem(item) {
  if (!item?.actor || !isItem(item, SOLAR_STORM_ID)) return;
  if (!isPrimaryHandler(item.actor)) return;
  const key = `${item.uuid}:${item.actor.uuid}`;
  if (inFlight.has(key)) return;
  inFlight.add(key);
  void activateSolarStorm(item).finally(() => {
    setTimeout(() => inFlight.delete(key), 4000);
  });
}

async function activateSolarStorm(item) {
  const actor = item.actor;
  if (!actor) return;

  const weapon = await pickWeapon(actor);
  if (!weapon) {
    await refundUse(item);
    ui.notifications.warn(`${PREFIX} | Нужно выбрать оружие.`);
    return;
  }

  replacing.add(actor.uuid);
  try {
    await clearSolarStorm(actor);
    await applyWeaponBonus(actor, weapon);
    await createStormEffect(actor, item, weapon);
    await grantSolarRay(actor, item);
  } finally {
    replacing.delete(actor.uuid);
  }

  await postFlavorChat(
    actor,
    `<p><strong>${PREFIX}</strong> — свет Уробороса охватывает <em>${escapeHtml(weapon.name)}</em> на минуту.</p>`
  );
  await promptFirstRay(actor, item);
}

async function pickWeapon(actor) {
  const equipped = actor.items.filter((item) => item.type === "weapon" && item.system?.equipped);
  const pool = equipped.length ? equipped : actor.items.filter((item) => item.type === "weapon");
  if (!pool.length) return null;
  if (pool.length === 1) return pool[0];

  try {
    const chosen = await foundry.applications.api.DialogV2.wait({
      window: { title: PREFIX },
      position: { width: 420 },
      content: "<p>Выберите оружие, которое охватит свет Уробороса.</p>",
      buttons: pool.map((item) => ({
        action: item.id,
        label: item.name + (item.system?.equipped ? "" : " (не экипировано)")
      })),
      rejectClose: false
    });
    if (!chosen) return null;
    return pool.find((item) => item.id === chosen) ?? null;
  } catch {
    return null;
  }
}

async function applyWeaponBonus(actor, weapon) {
  await mutateActor(actor, "updateEmbeddedDocuments", "Item", [{
    _id: weapon.id,
    [`flags.midi-qol.optional.${OPTIONAL_KEY}.label`]: PREFIX,
    [`flags.midi-qol.optional.${OPTIONAL_KEY}.count`]: "each-turn",
    [`flags.midi-qol.optional.${OPTIONAL_KEY}.damage.all`]: RAY_FORMULA,
    [`flags.midi-qol.optional.${OPTIONAL_KEY}.displayBonusRolls`]: false,
    [`flags.midi-qol.optional.${OPTIONAL_KEY}.activation`]: `workflow.item.id == "${weapon.id}" && workflow.activity.activation.type == "action" && !workflow.AoO`
  }]);
  await mutateActor(weapon, "createEmbeddedDocuments", "ActiveEffect", [{
    name: PREFIX,
    img: "icons/magic/light/beam-rays-yellow-blue-large.webp",
    origin: weapon.uuid,
    transfer: false,
    disabled: false,
    duration: minuteDuration(),
    changes: [],
    flags: {
      [MODULE_ID]: { solarStormWeapon: true }
    }
  }]);
}

async function createStormEffect(actor, item, weapon) {
  await mutateActor(actor, "createEmbeddedDocuments", "ActiveEffect", [{
    name: item.name,
    img: item.img,
    origin: item.uuid,
    transfer: false,
    disabled: false,
    duration: minuteDuration(),
    changes: [],
    flags: {
      [MODULE_ID]: {
        solarStorm: true,
        weaponUuid: weapon.uuid,
        weaponId: weapon.id
      },
      dae: { stackable: "noneName" }
    }
  }]);
}

async function grantSolarRay(actor, source) {
  if (actor.items.some((item) => isItem(item, SOLAR_STORM_RAY_ID))) return;
  await mutateActor(actor, "createEmbeddedDocuments", "Item", [solarRayItemData(source)]);
}

function solarRayItemData(source) {
  const activityId = "apSolarRayDmg001";
  return {
    name: "Solar Ray",
    type: "feat",
    img: source?.img ?? "icons/magic/light/beam-rays-yellow-blue-large.webp",
    system: {
      description: {
        value: "<p>Бонусным действием вы призываете солнечный луч, наносящий 2d6 лучистого урона.</p>"
      },
      source: { custom: "Autistic Premades", revision: 1, rules: "2014" },
      identifier: SOLAR_STORM_RAY_ID,
      type: { value: "feat", subtype: "" },
      uses: { spent: 0, max: "", recovery: [] },
      activities: {
        [activityId]: {
          _id: activityId,
          type: "damage",
          name: "",
          sort: 0,
          activation: { type: "bonus", value: 1, condition: "", override: false },
          consumption: { targets: [], scaling: { allowed: false, max: "" }, spellSlot: false },
          description: { chatFlavor: "" },
          duration: { concentration: false, value: "", units: "inst", special: "", override: false },
          effects: [],
          range: { units: "any", special: "", override: false },
          target: {
            template: { contiguous: false, type: "", size: "", units: "ft" },
            affects: { count: "1", type: "creature", choice: false, special: "" },
            override: false,
            prompt: true
          },
          uses: { spent: 0, max: "", recovery: [] },
          damage: {
            critical: { allow: false, bonus: "" },
            parts: [{
              number: 2,
              denomination: 6,
              bonus: "",
              types: ["radiant"],
              custom: { enabled: false, formula: "" },
              scaling: { mode: "", number: 1, formula: "" }
            }]
          }
        }
      }
    },
    flags: {
      [MODULE_ID]: {
        identifier: SOLAR_STORM_RAY_ID,
        solarStormRay: true
      }
    }
  };
}

async function promptFirstRay(actor, item) {
  const selfIds = new Set(actor.getActiveTokens?.().map((token) => token.id) ?? []);
  const tokens = (canvas.tokens?.placeables ?? []).filter((token) => token.actor && !selfIds.has(token.id));
  const targeted = tokens.filter((token) => token.targeted?.has(game.user) || game.user.targets?.has(token));
  const chosen = await pickTokenFromList(targeted.length ? targeted : tokens, {
    title: PREFIX,
    label: "Призвать солнечный луч? 2d6 лучистого. Наведите на имя, чтобы подсветить токен.",
    skipLabel: "Не призывать",
    autoPickSingle: false
  });
  if (!chosen) return;
  await applyRayDamage(actor, item, chosen);
}

async function applyRayDamage(actor, item, token) {
  const DamageRoll = CONFIG.Dice.DamageRoll ?? globalThis.DamageRoll;
  const roll = await new DamageRoll(RAY_FORMULA, actor.getRollData?.() ?? {}, {
    type: "radiant",
    isCritical: false,
    critical: { multiplier: 2, multiplyNumeric: false, bonusDice: 0 }
  }).evaluate();
  await globalThis.MidiQOL?.displayDSNForRoll?.(roll, "damageRoll");
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `${PREFIX} — солнечный луч`
  });
  const total = Number(roll.total) || 0;
  const entries = [{ damage: total, value: total, type: "radiant" }];
  if (globalThis.MidiQOL?.applyTokenDamage) {
    await globalThis.MidiQOL.applyTokenDamage(
      entries,
      total,
      new Set([token]),
      item,
      new Set(),
      { forceApply: true }
    );
  } else if (token.actor) {
    await applyActorDamage(token.actor, [{ value: total, type: "radiant" }]);
  }
  await postFlavorChat(
    actor,
    `<p><strong>${PREFIX}</strong> — ${escapeHtml(token.name)}: ${total} лучистого.</p>`
  );
}

function onDeleteActiveEffect(effect) {
  if (!effect.flags?.[MODULE_ID]?.solarStorm) return;
  const actor = effect.parent;
  if (!actor || actor.documentName !== "Actor") return;
  if (replacing.has(actor.uuid)) return;
  if (!game.user.isGM && !isPrimaryHandler(actor)) return;
  void clearSolarStorm(actor, { skipEffect: true, weaponId: effect.flags[MODULE_ID].weaponId });
}

function onUpdateActor(actor, changed) {
  const action = foundry.utils.getProperty(changed, "flags.midi-qol.actions.action");
  if (action !== false) return;
  void refreshStormBonus(actor);
}

function onCombatTurnChange(combat, _prior, current) {
  const actor = current?.actor
    ?? (typeof current === "string" ? combat.combatants.get(current)?.actor : null)
    ?? combat.combatant?.actor;
  if (!actor) return;
  void refreshStormBonus(actor);
}

function refreshStormBonus(actor) {
  if (!actor.effects.some((effect) => effect.flags?.[MODULE_ID]?.solarStorm)) return;
  if (!actor.getFlag("midi-qol", `optional.${OPTIONAL_KEY}.used`)) return;
  if (!game.user.isGM && !isPrimaryHandler(actor)) return;
  return actor.unsetFlag("midi-qol", `optional.${OPTIONAL_KEY}.used`);
}

async function clearSolarStorm(actor, { skipEffect = false, weaponId } = {}) {
  const effect = actor.effects.find((entry) => entry.flags?.[MODULE_ID]?.solarStorm);
  const id = weaponId ?? effect?.flags?.[MODULE_ID]?.weaponId;
  const weapon = id ? actor.items.get(id) : null;
  if (weapon) {
    const effectIds = weapon.effects
      .filter((entry) => entry.flags?.[MODULE_ID]?.solarStormWeapon)
      .map((entry) => entry.id);
    if (effectIds.length) await mutateActor(weapon, "deleteEmbeddedDocuments", "ActiveEffect", effectIds);
    await mutateActor(actor, "updateEmbeddedDocuments", "Item", [{
      _id: weapon.id,
      "flags.midi-qol.optional.-=apSolarStorm": null
    }]);
  }
  if (actor.getFlag("midi-qol", `optional.${OPTIONAL_KEY}.used`)) {
    try {
      await actor.unsetFlag("midi-qol", `optional.${OPTIONAL_KEY}.used`);
    } catch {
      // ignore
    }
  }
  if (!skipEffect) {
    const ids = actor.effects
      .filter((entry) => entry.flags?.[MODULE_ID]?.solarStorm)
      .map((entry) => entry.id);
    if (ids.length) await mutateActor(actor, "deleteEmbeddedDocuments", "ActiveEffect", ids);
  }
  const rays = actor.items.filter((item) => isItem(item, SOLAR_STORM_RAY_ID)).map((item) => item.id);
  if (rays.length) await mutateActor(actor, "deleteEmbeddedDocuments", "Item", rays);
}

async function refundUse(item) {
  const spent = Number(item.system?.uses?.spent) || 0;
  if (spent < 1) return;
  await item.update({ "system.uses.spent": spent - 1 });
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

function escapeHtml(value) {
  const html = foundry.utils.escapeHTML?.(String(value ?? ""));
  if (html) return html;
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
