import { MODULE_ID, ECSTASY_OF_MUTUAL_SUFFERING_ID, isItem } from "../lib/identifier.js";
import { applyActorDamage, postFlavorChat } from "../lib/hp.js";
import { mutateActor } from "../lib/area.js";

const PREFIX = "Экстаз Обоюдных Страданий";
const handledUses = new Set();
const appliedShares = new Set();
const clearing = new Set();

export function registerEcstasyOfMutualSuffering() {
  Hooks.on("midi-qol.postActiveEffects", onPostActiveEffects);
  Hooks.on("midi-qol.RollComplete", onMidiRollComplete);
  Hooks.on("dnd5e.calculateDamage", onCalculateDamage);
  Hooks.on("dnd5e.preApplyDamage", onPreApplyDamage);
  Hooks.on("dnd5e.applyDamage", onApplyDamage);
  Hooks.on("deleteActiveEffect", onDeleteActiveEffect);
}

function onPostActiveEffects(workflow) {
  if (!isItem(workflow?.item, ECSTASY_OF_MUTUAL_SUFFERING_ID)) return;
  void applyFromWorkflow(workflow);
}

function onMidiRollComplete(workflow) {
  if (!isItem(workflow?.item, ECSTASY_OF_MUTUAL_SUFFERING_ID)) return;
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

  const target = failed.find((token) => token.actor && token.actor.uuid !== caster.uuid);
  if (!target?.actor) return;

  await applyBond(caster, target.actor, item);
}

async function applyBond(caster, target, item) {
  await clearCasterBond(caster);
  const duration = roundDuration(3);
  const pairId = foundry.utils.randomID();
  const origin = item.uuid;

  await mutateActor(target, "createEmbeddedDocuments", "ActiveEffect", [{
    name: item.name,
    img: item.img,
    origin,
    transfer: false,
    disabled: false,
    duration,
    changes: [],
    flags: {
      [MODULE_ID]: {
        ecstasyOfMutualSuffering: {
          pairId,
          role: "bound",
          partnerUuid: caster.uuid
        }
      },
      dae: { stackable: "noneName" }
    }
  }]);

  await mutateActor(caster, "createEmbeddedDocuments", "ActiveEffect", [{
    name: `${item.name} (связь)`,
    img: item.img,
    origin,
    transfer: false,
    disabled: false,
    duration,
    changes: [{
      key: "flags.midi-qol.advantage.all",
      mode: CONST.ACTIVE_EFFECT_MODES.CUSTOM,
      value: "1",
      priority: 20
    }],
    flags: {
      [MODULE_ID]: {
        ecstasyOfMutualSuffering: {
          pairId,
          role: "source",
          partnerUuid: target.uuid
        }
      },
      dae: { stackable: "noneName" }
    }
  }]);

  await postFlavorChat(
    caster,
    `<p><strong>${PREFIX}</strong> — связь с ${target.name}. Урон делится, ведьма с преимуществом.</p>`
  );
}

async function clearCasterBond(caster) {
  const current = getBond(caster);
  if (!current) return;
  clearing.add(current.pairId);
  try {
    await deleteBondEffects(caster, current.pairId);
    const partner = await actorFromUuid(current.partnerUuid);
    if (partner) await deleteBondEffects(partner, current.pairId);
  } finally {
    setTimeout(() => clearing.delete(current.pairId), 500);
  }
}

function onDeleteActiveEffect(effect) {
  const data = effect.flags?.[MODULE_ID]?.ecstasyOfMutualSuffering;
  if (!data?.pairId || !data.partnerUuid) return;
  if (clearing.has(data.pairId)) return;
  const actor = effect.parent;
  if (!actor || actor.documentName !== "Actor") return;
  if (!isPrimaryHandler(actor)) return;
  clearing.add(data.pairId);
  void actorFromUuid(data.partnerUuid)
    .then((partner) => partner ? deleteBondEffects(partner, data.pairId) : null)
    .finally(() => {
      setTimeout(() => clearing.delete(data.pairId), 500);
    });
}

async function deleteBondEffects(actor, pairId) {
  const ids = actor.effects
    .filter((effect) => effect.flags?.[MODULE_ID]?.ecstasyOfMutualSuffering?.pairId === pairId)
    .map((effect) => effect.id);
  if (ids.length) await mutateActor(actor, "deleteEmbeddedDocuments", "ActiveEffect", ids);
}

function onCalculateDamage(actor, damages, options = {}) {
  prepareShare(actor, damages, options);
}

function onPreApplyDamage(actor, damagesOrAmount, updates, options = {}) {
  if (options?.[MODULE_ID]?.shared) return;
  const stashed = damagesOrAmount && typeof damagesOrAmount === "object"
    ? damagesOrAmount.__apEcstasyShare
    : null;
  if (stashed) {
    options[MODULE_ID] ??= {};
    options[MODULE_ID].partnerShare ??= stashed;
  } else if (!options?.[MODULE_ID]?.partnerShare) {
    prepareShare(actor, damagesOrAmount, options);
    const share = options?.[MODULE_ID]?.partnerShare;
    if (share && typeof damagesOrAmount === "number" && !share.self && updates) {
      applyKeptHpUpdates(actor, updates, Math.ceil(damagesOrAmount / 2));
    }
  }
  queueShare(options);
}

function onApplyDamage(_actor, _damages, _updates, options = {}) {
  queueShare(options);
}

function prepareShare(actor, damagesOrAmount, options = {}) {
  if (!options || options[MODULE_ID]?.shared || options[MODULE_ID]?.partnerShare) return;
  if (damagesOrAmount && typeof damagesOrAmount === "object" && damagesOrAmount.__apEcstasySplit) return;
  const bond = getBond(actor);
  if (!bond) return;

  let total;
  let type = "none";
  if (typeof damagesOrAmount === "number") {
    total = damagesOrAmount;
  } else {
    total = damagingTotal(damagesOrAmount);
    type = firstDamageType(damagesOrAmount);
  }
  if (!(total > 0)) return;

  const self = isSelfInflicted(actor, options);
  const partnerAmount = self ? total : Math.floor(total / 2);
  const kept = self ? total : Math.ceil(total / 2);
  if (!(partnerAmount > 0)) return;

  options[MODULE_ID] ??= {};
  options[MODULE_ID].partnerShare = {
    id: foundry.utils.randomID(),
    uuid: bond.partnerUuid,
    amount: partnerAmount,
    type,
    self
  };
  if (damagesOrAmount && typeof damagesOrAmount === "object") {
    damagesOrAmount.__apEcstasySplit = true;
    damagesOrAmount.__apEcstasyShare = options[MODULE_ID].partnerShare;
  }

  if (!self && typeof damagesOrAmount !== "number") {
    scaleDamage(damagesOrAmount, kept, total);
  }
}

function queueShare(options) {
  const share = options?.[MODULE_ID]?.partnerShare;
  if (!share?.id || !(share.amount > 0)) return;
  if (appliedShares.has(share.id)) return;
  appliedShares.add(share.id);
  setTimeout(() => appliedShares.delete(share.id), 4000);
  queueMicrotask(() => void applyPartnerShare(share));
}

async function applyPartnerShare(share) {
  const partner = await actorFromUuid(share.uuid);
  if (!partner || !getBond(partner)) return;
  await applyActorDamage(partner, [{ value: share.amount, type: share.type || "none" }], {
    [MODULE_ID]: { shared: true }
  });
}

function applyKeptHpUpdates(actor, updates, kept) {
  const hp = actor.system?.attributes?.hp;
  if (!hp || !updates) return;
  const temp = Number(hp.temp) || 0;
  const value = Number(hp.value) || 0;
  const deltaTemp = Math.min(temp, kept);
  const deltaHP = kept - deltaTemp;
  updates["system.attributes.hp.temp"] = temp - deltaTemp;
  updates["system.attributes.hp.value"] = Math.max(0, value - deltaHP);
}

function getBond(actor) {
  if (!actor) return null;
  const effect = (actor.appliedEffects ?? actor.effects ?? []).find((entry) => {
    return !entry.disabled && entry.flags?.[MODULE_ID]?.ecstasyOfMutualSuffering?.partnerUuid;
  });
  if (!effect) return null;
  return { effect, ...effect.flags[MODULE_ID].ecstasyOfMutualSuffering };
}

function isSelfInflicted(actor, options = {}) {
  if (options?.[MODULE_ID]?.selfDamage) return true;
  const midi = options.midi ?? options.workflow;
  const attacker = midi?.actor ?? midi?.token?.actor;
  if (attacker?.uuid && attacker.uuid === actor.uuid) return true;
  return false;
}

function damagingTotal(damages) {
  let total = 0;
  const entries = iterableEntries(damages);
  for (const entry of entries) {
    if (!entry || isHealingEntry(entry)) continue;
    const n = Number(entry.value ?? entry.total) || 0;
    if (n > 0) total += n;
  }
  if (total > 0) return total;
  const amount = Number(damages?.amount);
  return amount > 0 ? amount : 0;
}

function firstDamageType(damages) {
  for (const entry of iterableEntries(damages)) {
    if (!entry || isHealingEntry(entry)) continue;
    if ((Number(entry.value ?? entry.total) || 0) > 0) return entry.type || "none";
  }
  return "none";
}

function scaleDamage(damages, kept, original) {
  if (!damages || !(original > 0) || kept === original) return;
  if (typeof damages.amount === "number") damages.amount = kept;
  const entries = iterableEntries(damages).filter((entry) => {
    return entry && !isHealingEntry(entry) && (Number(entry.value ?? entry.total) || 0) > 0;
  });
  let remaining = kept;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const current = Number(entry.value ?? entry.total) || 0;
    const portion = i === entries.length - 1
      ? remaining
      : Math.floor(current * kept / original);
    remaining -= portion;
    if (typeof entry.value === "number") entry.value = portion;
    if (typeof entry.total === "number") entry.total = portion;
  }
}

function iterableEntries(damages) {
  if (!damages) return [];
  if (typeof damages[Symbol.iterator] === "function") return [...damages];
  return [];
}

function isHealingEntry(entry) {
  if (entry.type === "temphp" || entry.type === "healing" || entry.type === "maximum") return true;
  return Boolean(CONFIG.DND5E?.healingTypes?.[entry.type]);
}

async function actorFromUuid(uuid) {
  if (!uuid) return null;
  const doc = await fromUuid(uuid);
  if (!doc) return null;
  if (doc.documentName === "Actor") return doc;
  return doc.actor ?? null;
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

function roundDuration(rounds) {
  return {
    rounds,
    turns: 0,
    seconds: rounds * 6,
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
