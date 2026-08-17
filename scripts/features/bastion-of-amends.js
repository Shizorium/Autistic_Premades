import { MODULE_ID, BASTION_OF_AMENDS_ID, isItem } from "../lib/identifier.js";

export function registerBastionOfAmends() {
  Hooks.on("midi-qol.prePreambleComplete", onPreambleComplete);
  Hooks.on("midi-qol.postActiveEffects", onPostActiveEffects);
  Hooks.on("midi-qol.preAttackRollConfig", onPreAttackRollConfig);
}

function onPreambleComplete(workflow) {
  if (!isItem(workflow?.item, BASTION_OF_AMENDS_ID)) return;
  if (workflow.targets?.size) return;
  ui.notifications.warn("Bastion of Amends | Select at least one creature within 30 feet.");
  return false;
}

async function onPostActiveEffects(workflow) {
  if (!isItem(workflow?.item, BASTION_OF_AMENDS_ID)) return;

  const item = workflow.item;
  const paladin = workflow.actor;
  const targets = normalizeTokens(workflow.targets);
  if (!paladin || !targets.length) return;

  const acBonus = Math.min(5, targets.length);
  const duration = effectDuration();
  const origin = item.uuid;
  const sourceTokenUuid = workflow.token?.document?.uuid ?? workflow.token?.uuid ?? "";

  await replaceActorEffects(paladin, (data) => data.acBonus === true, [{
    name: `${item.name} (AC +${acBonus})`,
    img: item.img,
    origin,
    transfer: false,
    disabled: false,
    duration,
    changes: [{
      key: "system.attributes.ac.bonus",
      mode: CONST.ACTIVE_EFFECT_MODES.ADD,
      value: String(acBonus),
      priority: 20
    }],
    flags: {
      [MODULE_ID]: { bastionOfAmends: { acBonus: true } }
    }
  }]);

  const failed = getFailedSaveTokens(workflow);
  for (const token of failed) {
    const actor = token.actor;
    if (!actor) continue;
    await replaceActorEffects(actor, (data) => Boolean(data.marked || data.sourceUuid), [{
      name: item.name,
      img: item.img,
      origin,
      transfer: false,
      disabled: false,
      duration,
      changes: [{
        key: `flags.${MODULE_ID}.bastionOfAmends.marked`,
        mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE,
        value: "1",
        priority: 20
      }],
      flags: {
        [MODULE_ID]: {
          bastionOfAmends: {
            marked: true,
            sourceUuid: paladin.uuid,
            sourceTokenUuid
          }
        }
      }
    }]);
  }
}

function onPreAttackRollConfig(workflow) {
  const sourceUuids = getBastionSourceUuids(workflow?.actor);
  if (!sourceUuids.size) return;

  const targets = normalizeTokens(workflow.targets);
  if (!targets.length) return;

  const onlySource = targets.every((token) => isBastionSource(token, sourceUuids));
  if (onlySource) return;

  workflow.attackRollModifierTracker?.disadvantage?.add(
    BASTION_OF_AMENDS_ID,
    workflow.actor.appliedEffects?.find((effect) => effect.flags?.[MODULE_ID]?.bastionOfAmends)?.name
      ?? "Bastion of Amends"
  );
}

function getFailedSaveTokens(workflow) {
  const failed = normalizeTokens(workflow.failedSaves);
  const savedIds = new Set(normalizeTokens(workflow.saves).map(tokenId));
  if (failed.length) {
    return savedIds.size ? failed.filter((token) => !savedIds.has(tokenId(token))) : failed;
  }
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
    return doc?.object ?? doc?.object?.actor ?? null;
  }
  return null;
}

function tokenId(token) {
  return token.document?.uuid ?? token.uuid ?? token.id;
}

function getBastionSourceUuids(actor) {
  const uuids = new Set();
  if (!actor) return uuids;
  const effects = actor.appliedEffects ?? actor.effects ?? [];
  for (const effect of effects) {
    const data = effect.flags?.[MODULE_ID]?.bastionOfAmends;
    if (!data?.marked && !data?.sourceUuid) continue;
    if (data.sourceUuid) uuids.add(data.sourceUuid);
    if (data.sourceTokenUuid) uuids.add(data.sourceTokenUuid);
    const originDoc = effect.origin ? fromUuidSync(effect.origin) : null;
    const originActor = originDoc?.actor ?? (originDoc?.parent?.documentName === "Actor" ? originDoc.parent : null);
    if (originActor?.uuid) uuids.add(originActor.uuid);
  }
  return uuids;
}

function isBastionSource(token, sourceUuids) {
  const ids = [
    token.actor?.uuid,
    token.document?.uuid,
    token.uuid,
    token.document?.actor?.uuid
  ].filter(Boolean);
  return ids.some((id) => sourceUuids.has(id));
}

function effectDuration() {
  return {
    seconds: 60,
    rounds: 10,
    startTime: game.time?.worldTime ?? 0,
    startRound: game.combat?.round ?? 0,
    startTurn: game.combat?.turn ?? 0
  };
}

async function replaceActorEffects(actor, matches, effectData) {
  const existing = actor.effects.filter((effect) => {
    const data = effect.flags?.[MODULE_ID]?.bastionOfAmends;
    return data && matches(data);
  }).map((effect) => effect.id);

  if (existing.length) {
    await mutateActor(actor, "deleteEmbeddedDocuments", "ActiveEffect", existing);
  }
  await mutateActor(actor, "createEmbeddedDocuments", "ActiveEffect", effectData);
}

async function mutateActor(actor, method, documentName, payload) {
  const socket = globalThis.autisticPremades?.socket;
  if (socket && !game.user.isGM) {
    return socket.executeAsGM(method, actor.uuid, documentName, payload);
  }
  return actor[method](documentName, payload);
}
