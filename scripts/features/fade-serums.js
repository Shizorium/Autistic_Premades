import {
  MODULE_ID,
  FADE_SERUMS_ID,
  FADE_SERUM_FIRE_ID,
  FADE_SERUM_BLOOD_ID,
  FADE_SERUM_TEARS_ID,
  FADE_SERUM_HEAL_ID,
  isItem
} from "../lib/identifier.js";
import { applyActorDamage, postFlavorChat } from "../lib/hp.js";

const inFlight = new Set();
const PACK = "Compendium.Autistic_Premades.ap-class-features.Item";
const SERUMS = [
  { identifier: FADE_SERUM_FIRE_ID, uuid: `${PACK}.apFadeSerumFire01`, name: "9827-диротфирТ" },
  { identifier: FADE_SERUM_BLOOD_ID, uuid: `${PACK}.apFadeSerumBlood1`, name: "себеН ьворК" },
  { identifier: FADE_SERUM_TEARS_ID, uuid: `${PACK}.apFadeSerumTears1`, name: "ыцирЖ ызелС" },
  { identifier: FADE_SERUM_HEAL_ID, uuid: `${PACK}.apFadeSerumHeal01`, name: "иретаМ еинащорП" }
];
const SERUM_IDS = SERUMS.map((serum) => serum.identifier);

export function registerFadeSerums() {
  Hooks.on("dnd5e.postUseActivity", onPostUseActivity);
}

function onPostUseActivity(activity) {
  handleUsedItem(activity?.item ?? activity);
}

function handleUsedItem(item) {
  if (!item?.actor) return;
  if (!isPrimaryHandler(item.actor)) return;

  if (isItem(item, FADE_SERUMS_ID)) {
    const key = `draw:${item.actor.uuid}`;
    if (inFlight.has(key)) return;
    inFlight.add(key);
    void drawSerum(item).finally(() => inFlight.delete(key));
    return;
  }
  if (isItem(item, FADE_SERUM_HEAL_ID)) {
    const key = `heal:${item.uuid}:${item.actor.uuid}`;
    if (inFlight.has(key)) return;
    inFlight.add(key);
    void healToFull(item.actor).finally(() => inFlight.delete(key));
  }
}

function isPrimaryHandler(actor) {
  const owners = game.users.filter((user) => user.active && !user.isGM && actor.testUserPermission(user, "OWNER"));
  if (owners.length) return owners[0].id === game.user.id;
  return game.user.isGM;
}

async function drawSerum(item) {
  const actor = item.actor;
  if (!actor) return;

  const remaining = getRemaining(actor);
  const chosen = await rollUntilAvailable(actor, remaining);
  if (!chosen) return;

  const next = remaining.filter((id) => id !== chosen.identifier);
  await actor.setFlag(MODULE_ID, "fadeSerums.remaining", next.length ? next : [...SERUM_IDS]);

  try {
    await grantSerum(actor, chosen);
  } catch (error) {
    console.error("????? ????? | Failed to grant serum", error);
    ui.notifications.error("????? ????? | Не удалось добавить сыворотку.");
  }
}

function getRemaining(actor) {
  const stored = actor.getFlag(MODULE_ID, "fadeSerums.remaining");
  if (Array.isArray(stored) && stored.length) {
    const valid = stored.filter((id) => SERUM_IDS.includes(id));
    if (valid.length) return valid;
  }
  return [...SERUM_IDS];
}

async function rollUntilAvailable(actor, remaining) {
  const remainingSet = new Set(remaining);
  if (remaining.length === 1) {
    const serum = SERUMS.find((entry) => remainingSet.has(entry.identifier));
    if (!serum) return null;
    await postFlavorChat(
      actor,
      `<p>Последняя сыворотка круга — ${escapeHtml(serum.name)}</p>`
    );
    return serum;
  }

  for (let attempt = 0; attempt < 16; attempt++) {
    const roll = await new Roll("1d4").evaluate();
    const serum = SERUMS[roll.total - 1];
    if (!remainingSet.has(serum.identifier)) continue;
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `<p><strong>1d4:</strong> ${roll.total} — ${escapeHtml(serum.name)}</p>`
    });
    return serum;
  }
  return SERUMS.find((serum) => remainingSet.has(serum.identifier)) ?? null;
}

async function grantSerum(actor, serum) {
  const source = await fromUuid(serum.uuid);
  if (!source) throw new Error(`Serum not found: ${serum.uuid}`);

  const data = source.toObject();
  delete data._id;
  delete data._key;
  delete data._stats;
  data.folder = null;
  data.sort = 0;
  data.system ??= {};
  data.system.uses = {
    spent: 0,
    max: "1",
    recovery: [],
    autoDestroy: true
  };
  data.flags ??= {};
  data.flags[MODULE_ID] = {
    ...(data.flags[MODULE_ID] ?? {}),
    identifier: serum.identifier
  };

  await mutateActor(actor, "createEmbeddedDocuments", "Item", [data]);
  ui.notifications.info(`????? ????? | ${source.name}`);
}

async function healToFull(actor) {
  const hp = actor.system?.attributes?.hp;
  if (!hp) return;
  const missing = Math.max(0, (Number(hp.max) || 0) - (Number(hp.value) || 0));
  if (missing <= 0) return;
  await applyActorDamage(actor, [{ value: missing, type: "healing" }]);
  await postFlavorChat(actor, `<p>Полное восстановление ПЗ (+${missing})</p>`);
}

async function mutateActor(actor, method, documentName, payload) {
  const socket = globalThis.autisticPremades?.socket;
  if (socket && !game.user.isGM) {
    return socket.executeAsGM(method, actor.uuid, documentName, payload);
  }
  return actor[method](documentName, payload);
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
