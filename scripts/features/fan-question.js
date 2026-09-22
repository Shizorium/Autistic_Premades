import {
  MODULE_ID,
  FAN_QUESTION_ID,
  ASHEN_SPARK_ID,
  isItem
} from "../lib/identifier.js";
import { applyActorDamage, postFlavorChat, updateActorDocument } from "../lib/hp.js";
import {
  distanceFeet,
  mutateActor,
  pickPoint,
  tokensInCircle,
  updateTokenPosition
} from "../lib/area.js";

const PREFIX = "Веер?";
const SPARK_PREFIX = "Пепельная Искра";
const PHOENIX_ACTIVITY_ID = "apFanPhoenix0001";
const GEMINI_ACTIVITY_ID = "apFanGemini00001";
const CIPHER_ACTIVITY_ID = "apFanCipher00001";
const SPARK_UUID = `Compendium.${MODULE_ID}.ap-class-features.Item.apAshenSpark0001`;
const HP_COST = 4;
const PHOENIX_RADIUS = 25;
const inFlight = new Set();

export function registerFanQuestion() {
  Hooks.on("dnd5e.postUseActivity", onPostUseActivity);
  Hooks.on("midi-qol.RollComplete", onMidiRollComplete);
  Hooks.on("updateItem", onUpdateItem);
  Hooks.on("createItem", onCreateItem);
  Hooks.on("deleteItem", onDeleteItem);
  Hooks.on("dnd5e.restCompleted", onRestCompleted);
}

function onPostUseActivity(activity) {
  handleUsedActivity(activity);
}

function onMidiRollComplete(workflow) {
  handleUsedActivity(workflow?.activity ?? { item: workflow?.item, _id: workflow?.activity?.id }, {
    token: workflow?.token,
    completedAttack: Boolean(workflow?.attackRoll || workflow?.attackTotal != null)
  });
}

function handleUsedActivity(activity, extra = {}) {
  const item = activity?.item;
  if (!item?.actor) return;
  if (!isPrimaryHandler(item.actor)) return;

  if (isItem(item, FAN_QUESTION_ID)) {
    const id = activity?._id ?? activity?.id ?? "";
    if (![PHOENIX_ACTIVITY_ID, GEMINI_ACTIVITY_ID, CIPHER_ACTIVITY_ID].includes(id)) return;
    const key = `${id}:${item.uuid}:${item.actor.uuid}`;
    if (inFlight.has(key)) return;
    inFlight.add(key);
    const task = id === PHOENIX_ACTIVITY_ID ? activatePhoenix(item, extra)
      : id === GEMINI_ACTIVITY_ID ? activateGemini(item)
      : id === CIPHER_ACTIVITY_ID ? activateCipher(item)
      : Promise.resolve();
    void task.finally(() => {
      setTimeout(() => inFlight.delete(key), 4000);
    });
    return;
  }

  if (isItem(item, ASHEN_SPARK_ID) && extra.completedAttack) {
    const key = `spark:${item.uuid}:${item.actor.uuid}`;
    if (inFlight.has(key)) return;
    inFlight.add(key);
    void teleportSpark(item, extra).finally(() => {
      setTimeout(() => inFlight.delete(key), 4000);
    });
  }
}

async function activatePhoenix(item, extra = {}) {
  const actor = item.actor;
  if (!actor) return;
  const maxLevel = getMaxSlotLevel(actor);
  const hpPay = maxLevel <= 0;
  const slotLevel = hpPay ? 0 : await chooseSlotLevel(maxLevel);
  if (slotLevel == null) {
    await refundActivityUse(item, PHOENIX_ACTIVITY_ID);
    return;
  }
  if (hpPay) await applyHpCost(actor, item);

  const origin = getCastToken(actor, extra.token);
  const tokens = origin
    ? tokensInCircle(origin.center ?? tokenCenter(origin), PHOENIX_RADIUS)
    : [];
  const enemies = [];
  const allies = [];
  for (const token of tokens) {
    const kind = classifyToken(token, origin, actor);
    if (kind === "enemy") enemies.push(token);
    else if (kind === "ally") allies.push(token);
  }
  if (!allies.some((token) => token.actor === actor)) {
    const selfToken = origin?.actor === actor ? origin : actor.getActiveTokens?.()?.[0];
    if (selfToken) allies.unshift(selfToken);
    else allies.push({ actor, name: actor.name });
  }

  const damageDice = 3 + slotLevel;
  const healDice = 2 + slotLevel;
  const damageRoll = await rollDamage(`${damageDice}d6[fire]`, actor, "fire");
  const healRoll = await rollDamage(`${healDice}d8[healing]`, actor, "healing");
  await damageRoll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `${PREFIX} — Созвездие Феникса, урон огнём`
  });
  await healRoll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `${PREFIX} — Созвездие Феникса, лечение`
  });

  const damageTotal = Number(damageRoll.total) || 0;
  const healTotal = Number(healRoll.total) || 0;
  await applyTokenDamage(enemies, item, damageTotal, "fire");
  for (const token of allies) {
    if (!token.actor) continue;
    await applyActorDamage(token.actor, [{ value: healTotal, type: "healing" }]);
  }

  const slotNote = hpPay
    ? `ячейки недоступны, −${HP_COST} макс. ПЗ`
    : `ячейка ${slotLevel || "?"}`;
  await postFlavorChat(
    actor,
    `<p><strong>${PREFIX} — Созвездие Феникса</strong> (${slotNote}): ${damageTotal} огня врагам, ${healTotal} лечения вам и союзникам в ${PHOENIX_RADIUS} фт.</p>`
  );
}

async function applyHpCost(actor, item) {
  const existing = actor.effects.find((effect) => effect.flags?.[MODULE_ID]?.fanQuestionHpCost);
  if (existing) {
    const current = Number(existing.changes?.[0]?.value) || 0;
    await mutateActor(actor, "updateEmbeddedDocuments", "ActiveEffect", [{
      _id: existing.id,
      changes: [{
        key: "system.attributes.hp.max",
        mode: CONST.ACTIVE_EFFECT_MODES.ADD,
        value: String(current - HP_COST),
        priority: 20
      }]
    }]);
  } else {
    await mutateActor(actor, "createEmbeddedDocuments", "ActiveEffect", [{
      name: `${PREFIX} — плата здоровьем`,
      img: item.img,
      origin: item.uuid,
      transfer: false,
      disabled: false,
      duration: {},
      changes: [{
        key: "system.attributes.hp.max",
        mode: CONST.ACTIVE_EFFECT_MODES.ADD,
        value: String(-HP_COST),
        priority: 20
      }],
      flags: {
        [MODULE_ID]: { fanQuestionHpCost: true },
        dae: { specialDuration: ["longRest"], stackable: "noneName" }
      }
    }]);
  }
  const hp = actor.system?.attributes?.hp;
  const max = Number(hp?.max) || 0;
  const value = Number(hp?.value) || 0;
  if (max > 0 && value > max) {
    await updateActorDocument(actor, { "system.attributes.hp.value": max });
  }
}

async function activateGemini(item) {
  await postFlavorChat(
    item.actor,
    `<p><strong>${PREFIX} — Созвездие Близнецов</strong> — появляется временная копия на два часа.</p>`
  );
}

async function activateCipher(item) {
  const table = getLieTable();
  if (!table) {
    await refundActivityUse(item, CIPHER_ACTIVITY_ID);
    ui.notifications.warn(`${PREFIX} | Импортируйте «Таблицу Лжи» из компендиума в мир.`);
    return;
  }

  await table.draw({ displayChat: true });
}

function getLieTable() {
  return game.tables?.find((table) =>
    table.getFlag?.(MODULE_ID, "identifier") === "lie-table"
    || table.name === "Таблица Лжи"
  ) ?? null;
}

async function teleportSpark(item, extra = {}) {
  const actor = item.actor;
  if (!actor) return;
  const tokenDoc = getCastToken(actor, extra.token)?.document
    ?? getCastToken(actor, extra.token)
    ?? actor.getActiveTokens?.()?.[0]?.document;
  const origin = tokenCenter(tokenDoc) ?? extra.origin;
  if (!tokenDoc || !origin) {
    ui.notifications.warn(`${SPARK_PREFIX} | Нет токена для телепорта.`);
    return;
  }
  const range = teleportRange(actor);
  const point = await pickPoint({
    label: `${SPARK_PREFIX} — телепорт до ${range} фт.`,
    origin,
    maxRange: range,
    notifyPrefix: SPARK_PREFIX
  });
  if (!point) return;
  await updateTokenPosition(tokenDoc, point, { animate: false });
  await postFlavorChat(
    actor,
    `<p><strong>${SPARK_PREFIX}</strong> — телепорт на ${Math.round(distanceFeet(origin, point))} фт.</p>`
  );
}

function teleportRange(actor) {
  const level = Number(actor.system?.details?.level ?? actor.system?.details?.cr ?? 1) || 1;
  const extra = level >= 17 ? 3 : level >= 11 ? 2 : level >= 5 ? 1 : 0;
  return 10 + extra * 5;
}

function onUpdateItem(item, changed) {
  if (!isItem(item, FAN_QUESTION_ID) || !item.actor) return;
  const attuned = foundry.utils.getProperty(changed, "system.attuned");
  if (attuned === undefined) return;
  if (!isPrimaryHandler(item.actor)) return;
  if (attuned) void grantSpark(item);
  else void removeSpark(item);
}

function onCreateItem(item) {
  if (!isItem(item, FAN_QUESTION_ID) || !item.actor) return;
  if (!item.system?.attuned) return;
  if (!isPrimaryHandler(item.actor)) return;
  void grantSpark(item);
}

function onDeleteItem(item) {
  if (!isItem(item, FAN_QUESTION_ID) || !item.actor) return;
  if (!isPrimaryHandler(item.actor)) return;
  void removeSpark(item);
}

function onRestCompleted(actor, result, config) {
  if (!actor || !isLongRest(result, config)) return;
  if (!actor.isOwner) return;
  const ids = actor.effects
    .filter((effect) => effect.flags?.[MODULE_ID]?.fanQuestionHpCost)
    .map((effect) => effect.id);
  if (!ids.length) return;
  void mutateActor(actor, "deleteEmbeddedDocuments", "ActiveEffect", ids);
}

async function grantSpark(fan) {
  const actor = fan.actor;
  if (!actor) return;
  if (actor.items.some((item) => isGrantedSpark(item, fan))) return;
  const source = await fromUuid(SPARK_UUID).catch(() => null);
  const data = source ? source.toObject() : ashenSparkFallback(fan);
  delete data._id;
  delete data._key;
  delete data._stats;
  data.folder = null;
  data.sort = 0;
  data.system ??= {};
  data.system.method = "atwill";
  data.system.prepared = typeof data.system.prepared === "number" ? 2 : true;
  if (data.system.preparation && typeof data.system.preparation === "object") {
    data.system.preparation.mode = "atwill";
    data.system.preparation.prepared = true;
  }
  data.flags ??= {};
  data.flags[MODULE_ID] = {
    ...(data.flags[MODULE_ID] ?? {}),
    identifier: ASHEN_SPARK_ID,
    grantedByFan: fan.uuid
  };
  await mutateActor(actor, "createEmbeddedDocuments", "Item", [data]);
}

async function removeSpark(fan) {
  const actor = fan.actor;
  if (!actor) return;
  const ids = actor.items.filter((item) => isGrantedSpark(item, fan)).map((item) => item.id);
  if (ids.length) await mutateActor(actor, "deleteEmbeddedDocuments", "Item", ids);
}

function isGrantedSpark(item, fan) {
  if (!isItem(item, ASHEN_SPARK_ID)) return false;
  const granted = item.flags?.[MODULE_ID]?.grantedByFan;
  return !granted || granted === fan.uuid;
}

function ashenSparkFallback(fan) {
  return {
    name: "Пепельная Искра",
    type: "spell",
    img: fan?.img ?? "icons/magic/lightning/bolt-forked-large-blue.webp",
    system: {
      description: {
        value: "<p>Заговор. Бросок атаки, 1d12 урона молнией. Телепортирует вас на 10 фт в любом исходе.</p>"
      },
      source: { custom: "Autistic Premades", revision: 1, rules: "2014" },
      identifier: ASHEN_SPARK_ID,
      level: 0,
      school: "evo",
      method: "atwill",
      prepared: 2,
      activities: {}
    },
    flags: {
      [MODULE_ID]: { identifier: ASHEN_SPARK_ID }
    }
  };
}

async function rollDamage(formula, actor, type) {
  const DamageRoll = CONFIG.Dice.DamageRoll ?? globalThis.DamageRoll ?? Roll;
  const roll = await new DamageRoll(formula, actor.getRollData?.() ?? {}, {
    type,
    isCritical: false
  }).evaluate();
  await globalThis.MidiQOL?.displayDSNForRoll?.(roll, "damageRoll");
  return roll;
}

async function applyTokenDamage(tokens, item, total, type) {
  const live = tokens.filter((token) => token?.actor);
  if (!live.length || !(total > 0)) return;
  const entries = [{ damage: total, value: total, type }];
  if (globalThis.MidiQOL?.applyTokenDamage) {
    await globalThis.MidiQOL.applyTokenDamage(entries, total, new Set(live), item, new Set(), { forceApply: true });
    return;
  }
  for (const token of live) {
    await applyActorDamage(token.actor, [{ value: total, type }]);
  }
}

function classifyToken(token, origin, caster) {
  if (!token?.actor) return "neutral";
  if (token.actor === caster) return "ally";
  if (origin && (token.id === origin.id || token.document?.id === origin.id || token.document?.id === origin.document?.id)) {
    return "ally";
  }
  const a = Number(token.document?.disposition ?? token.disposition);
  const b = Number(origin?.document?.disposition ?? origin?.disposition ?? 1);
  if (a && b && a === b) return "ally";
  if (a && b && Math.sign(a) !== Math.sign(b)) return "enemy";
  return "neutral";
}

function getMaxSlotLevel(actor) {
  if (!actor) return 0;
  let maxLevel = 0;
  const spells = actor.system?.spells ?? {};
  for (let level = 1; level <= 9; level++) {
    if ((Number(spells[`spell${level}`]?.max) || 0) > 0) maxLevel = level;
  }
  if ((Number(spells.pact?.max) || 0) > 0) {
    maxLevel = Math.max(maxLevel, Number(spells.pact?.level) || 1);
  }
  return maxLevel;
}

async function chooseSlotLevel(maxLevel) {
  try {
    return await foundry.applications.api.DialogV2.wait({
      window: { title: `${PREFIX} — Созвездие Феникса` },
      position: { width: 420 },
      content: "<p>Выберите уровень ячейки. Ячейка не будет потрачена.</p>",
      buttons: Array.from({ length: maxLevel }, (_, index) => {
        const level = index + 1;
        return {
          action: String(level),
          label: `${level} уровень`,
          callback: () => level
        };
      }),
      rejectClose: false
    });
  } catch {
    return null;
  }
}

async function refundActivityUse(item, activityId) {
  const activity = item.system?.activities?.get?.(activityId)
    ?? item.system?.activities?.[activityId];
  const spent = Number(activity?.uses?.spent) || 0;
  if (spent <= 0) return;
  await item.update({ [`system.activities.${activityId}.uses.spent`]: spent - 1 });
}

function getCastToken(actor, hint) {
  if (hint?.center) return hint;
  if (hint?.object?.center) return hint.object;
  if (hint?.document) return hint;
  return actor?.getActiveTokens?.()?.[0]
    ?? canvas.tokens?.controlled?.find((token) => token.actor === actor)
    ?? null;
}

function tokenCenter(token) {
  if (!token) return null;
  if (token.center) return { x: token.center.x, y: token.center.y };
  const doc = token.document ?? token;
  const size = canvas.grid?.size || 100;
  if (!Number.isFinite(Number(doc.x)) || !Number.isFinite(Number(doc.y))) return null;
  return {
    x: Number(doc.x) + ((Number(doc.width) || 1) * size) / 2,
    y: Number(doc.y) + ((Number(doc.height) || 1) * size) / 2
  };
}

function isLongRest(result, config) {
  return Boolean(
    result?.longRest
    || result?.type === "long"
    || config?.type === "long"
    || config?.restType === "long"
  );
}

function isPrimaryHandler(actor) {
  const owners = game.users.filter((user) => user.active && !user.isGM && actor.testUserPermission(user, "OWNER"));
  if (owners.length) return owners[0].id === game.user.id;
  return game.user.isGM;
}
