import { MODULE_ID, FROM_THE_ASHES_ONDOLOH_ID, FROM_THE_ASHES_DEATH_STATUS_ID, FROM_THE_ASHES_DEATH_ICON, isItem } from "../lib/identifier.js";
import { ignoreNextOndolohUses } from "./sandevistan.js";
import { applyActorDamage } from "../lib/hp.js";
import {
  placeCircleTemplate,
  createAreaAt,
  pickPoint,
  notifyCancelled,
  mutateActor,
  updateTokenPosition
} from "../lib/area.js";

const MOVEMENT_KEYS = ["walk", "burrow", "climb", "fly", "swim"];

const HANDLERS = {
  dim: handleDim,
  distortion: handleDistortion,
  familiar: handleFamiliar,
  collapse: handleCollapse,
  celestial: handleCelestial,
  ondoloh: handleOndoloh,
  life: handleLife,
  death: handleDeath
};

export async function runFromTheAshesAutomation(effectId, payload = {}) {
  const handler = HANDLERS[effectId];
  if (!handler) return;
  try {
    await handler(payload);
  } catch (error) {
    console.error("Из Праха | Automation failed", error);
    ui.notifications.warn("Из Праха | Автоматизация не удалась.");
  }
}

export async function runFromTheAshesPlayerEffect(effectId, payload = {}) {
  if (effectId === "distortion") return teleportCaster(payload);
}

async function handleDim() {
  await placeCircleTemplate({
    label: "Тусклое — область 20 фт.",
    name: "Мрак",
    distance: 20,
    fillColor: "#2a0a40",
    effect: "dim"
  });
}

async function handleDistortion(payload) {
  const origin = payload.origin;
  if (origin) {
    await createAreaAt({
      center: origin,
      scene: await getScene(payload),
      distance: 5,
      fillColor: "#6b3fa0",
      name: "Искажение",
      effect: "distortion"
    });
  }
  await dispatchPlayerEffect(payload.casterUserId, "distortion", payload);
}

async function teleportCaster(payload) {
  const tokenDoc = await getTokenDoc(payload);
  const origin = payload.origin ?? (tokenDoc ? tokenCenter(tokenDoc) : null);
  if (!tokenDoc || !origin) {
    ui.notifications.warn("Из Праха | Нет токена для телепорта.");
    return;
  }
  const point = await pickPoint({
    label: "Искажение — телепорт до 45 фт.",
    origin,
    maxRange: 45
  });
  if (!point) {
    notifyCancelled();
    return;
  }
  await updateTokenPosition(tokenDoc, point);
}

async function handleFamiliar(payload) {
  const placed = await placeCircleTemplate({
    label: "Знакомое — область 300 фт.",
    name: "Знакомое",
    distance: 300,
    fillColor: "#8b6914",
    effect: "familiar",
    target: true,
    visual: false,
    persistTemplate: false
  });
  if (!placed) return;

  const duration = endOfNextTurnDuration();
  for (const token of placed.tokens) {
    const actor = token.actor;
    if (!actor) continue;
    await mutateActor(actor, "createEmbeddedDocuments", "ActiveEffect", [{
      name: "Знакомое",
      img: "icons/magic/control/fear-wave-terror-orange.webp",
      origin: payload.actorUuid ?? "",
      transfer: false,
      disabled: false,
      duration,
      changes: [
        {
          key: "flags.midi-qol.disadvantage.all",
          mode: CONST.ACTIVE_EFFECT_MODES.CUSTOM,
          value: "1",
          priority: 20
        }
      ],
      flags: {
        [MODULE_ID]: { fromTheAshes: "familiar" },
        dae: { specialDuration: ["turnEnd"] }
      }
    }]);
  }
}

async function handleCollapse(payload) {
  const radius = await promptRadius(20);
  if (radius == null) {
    notifyCancelled();
    return;
  }
  const placed = await placeCircleTemplate({
    label: `Коллапс — область ${radius} фт.`,
    name: "Коллапс",
    distance: radius,
    fillColor: "#5c4033",
    effect: "collapse",
    target: true,
    visual: false,
    persistTemplate: false
  });
  if (!placed) return;

  const slotLevel = Math.max(1, Number(payload.slotLevel) || 1);
  const roll = await new Roll(`${1 + slotLevel}d8`).evaluate();
  await roll.toMessage({ flavor: "Коллапс — дробящий" });
  await applyDamageToTokens(placed.tokens, roll.total, "bludgeoning", payload);
}

async function handleCelestial(payload) {
  const time = await promptDayOrNight();
  if (!time) {
    notifyCancelled();
    return;
  }
  const isDay = time === "day";
  const placed = await placeCircleTemplate({
    label: `Небесное — область 20 фт. (${isDay ? "день" : "ночь"})`,
    name: "Небесное",
    distance: 20,
    fillColor: isDay ? "#ffe566" : "#88ccff",
    effect: "celestial",
    target: true,
    visual: false,
    persistTemplate: false
  });
  if (!placed) return;

  const slotLevel = Math.max(1, Number(payload.slotLevel) || 1);
  const amount = 5 + (5 * slotLevel);
  const damageType = isDay ? "radiant" : "cold";
  const duration = casterNextTurnDuration(payload);
  const source = payload.actorUuid ?? "";

  for (const token of placed.tokens) {
    const actor = token.actor;
    if (!actor) continue;
    const saved = await rollConSave(actor, 20);
    if (!saved) {
      await mutateActor(actor, "createEmbeddedDocuments", "ActiveEffect", [
        isDay ? blindedEffect(source, duration) : frozenEffect(source, duration)
      ]);
    }
  }
  await applyDamageToTokens(placed.tokens, amount, damageType, payload);
}

async function handleOndoloh(payload) {
  const actor = await fromUuid(payload.actorUuid);
  if (!actor) {
    ui.notifications.warn("Из Праха | Нет актёра для ондолоХ.");
    return;
  }
  const existing = actor.items.find((item) => isItem(item, FROM_THE_ASHES_ONDOLOH_ID));
  if (existing) {
    if (hasValidOndolohActivity(existing)) {
      ui.notifications.info("Из Праха | ондолоХ уже в чарнике.");
      return;
    }
    await mutateActor(actor, "deleteEmbeddedDocuments", "Item", [existing.id]);
  }
  const data = ondolohItemData();
  const activities = data.system.activities;
  data.system.activities = {};
  ignoreNextOndolohUses(actor.uuid, 3000);
  const created = await mutateActor(actor, "createEmbeddedDocuments", "Item", [data]);
  const item = Array.isArray(created) ? created[0] : created;
  if (item?.id) {
    await mutateActor(actor, "updateEmbeddedDocuments", "Item", [{
      _id: item.id,
      "system.activities": activities
    }]);
  }
  ui.notifications.info("Из Праха | ондолоХ добавлен в чарник.");
}

async function handleLife() {
  await placeCircleTemplate({
    label: "Жизнь — область 20 фт.",
    name: "Жизнь",
    distance: 20,
    fillColor: "#2ecc71",
    effect: "life"
  });
}

async function handleDeath(payload) {
  const confirmed = await confirmTokenSelection();
  if (!confirmed) {
    notifyCancelled();
    return;
  }
  const tokens = canvas.tokens.controlled.filter((token) => token.actor);
  if (!tokens.length) {
    ui.notifications.warn("Из Праха | Нет выделенных токенов.");
    return;
  }
  for (const token of tokens) {
    const actor = token.actor;
    const existing = actor.effects
      .filter((effect) => effect.flags?.[MODULE_ID]?.fromTheAshes === "death")
      .map((effect) => effect.id);
    if (existing.length) {
      await mutateActor(actor, "deleteEmbeddedDocuments", "ActiveEffect", existing);
    }
    await mutateActor(actor, "createEmbeddedDocuments", "ActiveEffect", [{
      name: "Смерть",
      type: "base",
      img: FROM_THE_ASHES_DEATH_ICON,
      icon: FROM_THE_ASHES_DEATH_ICON,
      origin: payload.actorUuid ?? "",
      transfer: false,
      disabled: false,
      duration: {},
      statuses: [FROM_THE_ASHES_DEATH_STATUS_ID],
      changes: [],
      flags: {
        core: { overlay: true, statusId: FROM_THE_ASHES_DEATH_STATUS_ID },
        [MODULE_ID]: { fromTheAshes: "death" }
      }
    }]);
  }
}

function ondolohItemData() {
  const activityId = "apOndolohToggle1";
  return {
    name: "ондолоХ",
    type: "feat",
    img: "icons/magic/lightning/bolt-forked-large-blue.webp",
    system: {
      description: {
        value: "<p>БЕЖАТЬ. БЕЖАТЬ. БЕЖ-… До конца хода ваша скорость увеличивается на 90 фт. Любая цель, рядом с которой вы пронесётесь, получит урон Молнией, равный вашему уровню волшебника (существо не может получить этот урон больше раза в раунд).</p><p>Тоггл. После использования удалите эту особенность с листа вручную.</p>"
      },
      source: { custom: "Autistic Premades", revision: 1, rules: "2014" },
      identifier: FROM_THE_ASHES_ONDOLOH_ID,
      type: { value: "class", subtype: "" },
      uses: { spent: 0, max: "", recovery: [], autoDestroy: false },
      activities: {
        [activityId]: {
          _id: activityId,
          type: "utility",
          name: "Тоггл",
          sort: 0,
          activation: { type: "action", value: 1, condition: "", override: false },
          consumption: { targets: [], scaling: { allowed: false, max: "" }, spellSlot: false },
          duration: { concentration: false, value: "", units: "", special: "", override: false },
          effects: [],
          range: { units: "self", special: "", override: false },
          target: {
            template: { contiguous: false, type: "", size: "", units: "ft" },
            affects: { count: "", type: "self", choice: false, special: "" },
            override: false,
            prompt: false
          },
          uses: { spent: 0, max: "", recovery: [], autoDestroy: false },
          roll: { formula: "", name: "", prompt: false, visible: false }
        }
      }
    },
    effects: [],
    flags: {
      [MODULE_ID]: {
        identifier: FROM_THE_ASHES_ONDOLOH_ID,
        skipUseUntil: Date.now() + 3000
      },
      "midi-qol": { consume: false, forceCEOff: true },
      midiProperties: { nodam: true, noProvokeReaction: true }
    }
  };
}

function hasValidOndolohActivity(item) {
  return Object.values(item.system?.activities ?? {}).some((activity) => {
    const id = String(activity?._id ?? "");
    return id.length === 16 && /^[a-zA-Z0-9]+$/.test(id);
  });
}

async function dispatchPlayerEffect(userId, effectId, payload) {
  const socket = globalThis.autisticPremades?.socket;
  const user = userId ? game.users.get(userId) : null;
  if (userId && userId !== game.user.id && socket && user?.active) {
    try {
      return await socket.executeAsUser("runFromTheAshesPlayerEffect", userId, effectId, payload);
    } catch (error) {
      console.warn("Из Праха | Player socket failed, running locally", error);
    }
  }
  return runFromTheAshesPlayerEffect(effectId, payload);
}

async function promptRadius(defaultRadius = 20) {
  try {
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: "Из Праха — Коллапс" },
      content: `<form><div class="form-group"><label>Радиус (фт.)</label><input type="number" name="radius" value="${defaultRadius}" min="5" step="5" autofocus></div></form>`,
      ok: {
        label: "Выбрать область",
        callback: (event, button) => {
          const value = Number(button.form.elements.radius?.value);
          return Number.isFinite(value) && value > 0 ? value : defaultRadius;
        }
      },
      cancel: { label: "Отмена" },
      rejectClose: false
    });
    return typeof result === "number" ? result : null;
  } catch {
    return null;
  }
}

async function promptDayOrNight() {
  try {
    const chosen = await foundry.applications.api.DialogV2.wait({
      window: { title: "Из Праха — Небесное" },
      content: "<p>Сейчас день или ночь?</p>",
      buttons: [
        { action: "day", label: "День" },
        { action: "night", label: "Ночь" },
        { action: "cancel", label: "Отмена" }
      ],
      rejectClose: false
    });
    if (chosen === "day" || chosen === "night") return chosen;
    return null;
  } catch {
    return null;
  }
}

async function confirmTokenSelection() {
  try {
    const chosen = await foundry.applications.api.DialogV2.wait({
      window: { title: "Из Праха — Смерть" },
      content: "<p>Выделите токены на сцене, затем подтвердите.</p>",
      buttons: [
        { action: "ok", label: "Применить" },
        { action: "cancel", label: "Отмена" }
      ],
      rejectClose: false
    });
    return chosen === "ok";
  } catch {
    return false;
  }
}

async function rollConSave(actor, dc) {
  try {
    if (typeof actor.rollSavingThrow === "function") {
      const result = await actor.rollSavingThrow(
        { ability: "con", target: dc },
        { configure: false },
        { create: false }
      );
      const roll = Array.isArray(result) ? result[0] : result;
      const total = Number(roll?.total ?? roll?._total);
      if (Number.isFinite(total)) return total >= dc;
    }
    if (typeof actor.rollAbilitySave === "function") {
      const result = await actor.rollAbilitySave("con", {
        targetValue: dc,
        fastForward: true,
        chatMessage: false,
        skipDialog: true
      });
      const roll = Array.isArray(result) ? result[0] : result;
      const total = Number(roll?.total ?? roll?._total);
      if (Number.isFinite(total)) return total >= dc;
    }
  } catch (error) {
    console.warn("Из Праха | CON save dialog path failed, rolling silently", error);
  }
  const save = Number(actor.system?.abilities?.con?.save ?? actor.system?.abilities?.con?.mod) || 0;
  const roll = await new Roll(`1d20 + ${save}`).evaluate();
  return roll.total >= dc;
}

function blindedEffect(origin, duration) {
  return {
    name: "Ослеплён",
    img: "icons/magic/perception/eye-ringed-glow-angry-small-red.webp",
    origin,
    transfer: false,
    disabled: false,
    duration,
    statuses: ["blinded"],
    changes: [],
    flags: {
      [MODULE_ID]: { fromTheAshes: "celestial" },
      dae: { specialDuration: ["turnEndSource"] }
    }
  };
}

function frozenEffect(origin, duration) {
  return {
    name: "Заморожен",
    img: "icons/magic/water/ice-crystal-white.webp",
    origin,
    transfer: false,
    disabled: false,
    duration,
    changes: MOVEMENT_KEYS.map((key) => ({
      key: `system.attributes.movement.${key}`,
      mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE,
      value: "0",
      priority: 50
    })),
    flags: {
      [MODULE_ID]: { fromTheAshes: "celestial" },
      dae: { specialDuration: ["turnEndSource"] }
    }
  };
}

function endOfNextTurnDuration() {
  return {
    rounds: 1,
    turns: 1,
    seconds: 12,
    startTime: game.time?.worldTime ?? 0,
    startRound: game.combat?.round ?? 0,
    startTurn: game.combat?.turn ?? 0
  };
}

function casterNextTurnDuration(payload) {
  return {
    rounds: 2,
    seconds: 12,
    startTime: game.time?.worldTime ?? 0,
    startRound: game.combat?.round ?? 0,
    startTurn: game.combat?.turn ?? 0,
    combat: game.combat?.id,
    origin: payload.actorUuid
  };
}

async function applyDamageToTokens(tokens, amount, type, payload) {
  if (!tokens.length || !(amount > 0)) return;
  const tokenObjects = tokens.map((token) => token.object ?? token).filter(Boolean);
  const actor = payload.actorUuid ? await fromUuid(payload.actorUuid) : null;
  const sourceToken = await getTokenDoc(payload);

  if (globalThis.MidiQOL?.applyTokenDamage && tokenObjects.length) {
    await MidiQOL.applyTokenDamage(
      [{ value: amount, type }],
      amount,
      new Set(tokenObjects),
      null,
      new Set(),
      {
        forceApply: true,
        workflow: {
          actor,
          token: sourceToken?.object,
          itemCardUuid: undefined,
          flagTags: undefined
        }
      }
    );
    return;
  }
  for (const token of tokens) {
    if (token.actor) await applyActorDamage(token.actor, [{ value: amount, type }]);
  }
}

async function getScene(payload) {
  if (payload.sceneUuid) {
    const scene = await fromUuid(payload.sceneUuid);
    if (scene) return scene;
  }
  return canvas.scene;
}

async function getTokenDoc(payload) {
  if (payload.tokenUuid) {
    const doc = await fromUuid(payload.tokenUuid);
    if (doc) return doc;
  }
  if (payload.actorUuid) {
    const actor = await fromUuid(payload.actorUuid);
    return actor?.getActiveTokens()?.[0]?.document ?? null;
  }
  return null;
}

function tokenCenter(tokenDoc) {
  const size = canvas.grid?.size || 100;
  return {
    x: tokenDoc.x + ((tokenDoc.width ?? 1) * size) / 2,
    y: tokenDoc.y + ((tokenDoc.height ?? 1) * size) / 2
  };
}
