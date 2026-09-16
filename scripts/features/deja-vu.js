import { MODULE_ID, DEJA_VU_ID, isItem } from "../lib/identifier.js";
import { postFlavorChat } from "../lib/hp.js";
import { mutateActor } from "../lib/area.js";

const PREFIX = "Дежавю́";
const AC_ICON = "icons/magic/defensive/shield-barrier-flaming-diamond-blue.webp";
const SOCKET_PROMPT = "dejaVuPrompt";
const inFlight = new Set();
const replacing = new Set();
const saveBonusPrompted = new Set();
const pendingSaveBonuses = new Set();
const concRolls = new Set();
const concForcedSuccess = new Set();
const concPromptWaiters = new Map();

export function registerDejaVu() {
  registerRollWrappers();
  Hooks.on("dnd5e.postUseActivity", onPostUseActivity);
  Hooks.on("midi-qol.RollComplete", onMidiRollComplete);
  Hooks.on("midi-qol.preAttackRollConfig", onPreAttackRollConfig);
  Hooks.on("midi-qol.hitsChecked", onHitsChecked);
  Hooks.on("midi-qol.postCheckSaves", onPostCheckSaves);
  Hooks.on("dnd5e.preRollSavingThrow", injectPendingSaveBonus);
  Hooks.on("dnd5e.preRollSavingThrowV2", injectPendingSaveBonus);
  Hooks.on("dnd5e.preRollConcentration", injectPendingSaveBonus);
  Hooks.on("dnd5e.preRollConcentrationV2", injectPendingSaveBonus);
  Hooks.on("dnd5e.preRollDeathSave", injectPendingSaveBonus);
  Hooks.on("dnd5e.preRollDeathSaveV2", injectPendingSaveBonus);
  Hooks.on("dnd5e.postBuildSavingThrowRollConfig", onPostBuildSaveRollConfig);
  Hooks.on("dnd5e.postBuildConcentrationRollConfig", onPostBuildSaveRollConfig);
  Hooks.on("dnd5e.postBuildDeathSaveRollConfig", onPostBuildSaveRollConfig);
  Hooks.on("updateCombat", onUpdateCombat);
  Hooks.on("deleteActiveEffect", onDeleteActiveEffect);
}

function registerRollWrappers() {
  wrapActorMethod("rollSavingThrow", wrapSavingThrow);
  wrapActorMethod("rollDeathSave", wrapSavingThrow);
  wrapActorMethod("rollConcentration", wrapConcentration);
  wrapActorMethod("endConcentration", wrapEndConcentration);
  wrapPath("CONFIG.Dice.D20Roll.build", wrapD20RollBuild);
}

function wrapActorMethod(method, wrapper) {
  wrapPath(`CONFIG.Actor.documentClass.prototype.${method}`, wrapper, CONFIG.Actor?.documentClass?.prototype, method);
}

function wrapPath(path, wrapper, fallbackHost, fallbackMethod) {
  if (globalThis.libWrapper) {
    try {
      libWrapper.register(MODULE_ID, path, wrapper, "WRAPPER");
      return;
    } catch (error) {
      console.warn(`Autistic Premades | ${PREFIX} wrap ${path} failed`, error);
    }
  }
  const host = fallbackHost
    ?? foundry.utils.getProperty(globalThis, path.split(".").slice(0, -1).join("."));
  const method = fallbackMethod ?? path.split(".").at(-1);
  if (!host?.[method] || host[`_apDejaVu${method}`]) return;
  const original = host[method];
  host[method] = function (...args) {
    return wrapper.call(this, original.bind(this), ...args);
  };
  host[`_apDejaVu${method}`] = true;
}

function onPostUseActivity(activity) {
  handleUsedItem(activity?.item);
}

function onMidiRollComplete(workflow) {
  handleUsedItem(workflow?.item);
}

function handleUsedItem(item) {
  if (!item?.actor || !isItem(item, DEJA_VU_ID)) return;
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
    await clearDejaVu(actor);
    const duration = minuteDuration();
    await mutateActor(actor, "createEmbeddedDocuments", "ActiveEffect", [
      {
        name: item.name,
        img: item.img,
        origin: item.uuid,
        transfer: false,
        disabled: false,
        duration: { ...duration },
        changes: [],
        flags: {
          [MODULE_ID]: { dejaVu: { missUsedCombatId: "" } },
          dae: { stackable: "noneName" }
        }
      },
      acEffectData(actor, item, { ...duration }, 0)
    ]);
  } finally {
    replacing.delete(actor.uuid);
  }
  await postFlavorChat(
    actor,
    `<p><strong>${PREFIX}</strong> — двойственность окружения на минуту. КБ +0.</p>`
  );
}

function acEffectData(actor, item, duration, bonus) {
  return {
    name: acEffectName(bonus),
    img: AC_ICON,
    origin: item?.uuid ?? actor?.uuid,
    transfer: false,
    disabled: false,
    duration,
    changes: acChanges(bonus),
    flags: {
      [MODULE_ID]: { dejaVuAc: { bonus } },
      dae: { stackable: "noneName" }
    }
  };
}

function acEffectName(bonus) {
  return `${PREFIX} (КБ +${bonus})`;
}

function acChanges(bonus) {
  return [{
    key: "system.attributes.ac.bonus",
    mode: CONST.ACTIVE_EFFECT_MODES.ADD,
    value: String(bonus),
    priority: 20
  }];
}

async function clearDejaVu(actor) {
  const ids = actor.effects
    .filter((effect) => isDejaVuEffect(effect) || isDejaVuAcEffect(effect))
    .map((effect) => effect.id);
  if (ids.length) await mutateActor(actor, "deleteEmbeddedDocuments", "ActiveEffect", ids);
}

async function onPreAttackRollConfig(workflow) {
  const attacker = workflow?.actor;
  if (!attacker) return;
  const targets = [...(workflow.targets ?? [])]
    .map(asToken)
    .filter((token) => token?.actor && hasDejaVu(token.actor));
  if (!targets.length) return;

  let applyDisadvantage = false;
  for (const token of targets) {
    const defender = token.actor;
    if (hasDisadvantageMark(attacker, defender)) {
      applyDisadvantage = true;
      continue;
    }
    if (!canSee(defender, attacker)) continue;
    const accepted = await promptOwner(
      defender,
      `Дать ${attacker.name} помеху на все броски атаки по тебе до конца его хода?`,
      "Помеха"
    );
    if (!accepted) continue;
    await applyDisadvantageMark(attacker, defender);
    applyDisadvantage = true;
    await postFlavorChat(
      defender,
      `<p><strong>${PREFIX}</strong> — ${attacker.name} получает помеху на атаки по ${defender.name} до конца хода.</p>`
    );
  }

  if (applyDisadvantage) addAttackDisadvantage(workflow);
}

function addAttackDisadvantage(workflow) {
  if (workflow.attackRollModifierTracker?.disadvantage?.add) {
    workflow.attackRollModifierTracker.disadvantage.add(DEJA_VU_ID, PREFIX);
    return;
  }
  workflow.disadvantage = true;
}

function hasDisadvantageMark(attacker, defender) {
  return Boolean(getDisadvantageMark(attacker, defender));
}

function getDisadvantageMark(attacker, defender) {
  const targetUuid = defender?.uuid;
  if (!attacker || !targetUuid) return null;
  return (attacker.appliedEffects ?? attacker.effects ?? []).find((effect) => {
    return effect.flags?.[MODULE_ID]?.dejaVuDisadvantage?.targetUuid === targetUuid;
  }) ?? null;
}

async function applyDisadvantageMark(attacker, defender) {
  const existing = getDisadvantageMark(attacker, defender);
  if (existing) return;
  const source = getDejaVuItem(defender) ?? getDejaVuEffect(defender);
  await mutateActor(attacker, "createEmbeddedDocuments", "ActiveEffect", [{
    name: `${PREFIX}: помеха (${defender.name})`,
    img: source?.img ?? "icons/magic/perception/third-eye-blue-red.webp",
    origin: source?.uuid ?? defender.uuid,
    transfer: false,
    disabled: false,
    duration: {
      rounds: 1,
      turns: 1,
      startRound: game.combat?.round ?? 0,
      startTurn: game.combat?.turn ?? 0
    },
    changes: [],
    flags: {
      [MODULE_ID]: { dejaVuDisadvantage: { targetUuid: defender.uuid } },
      dae: { specialDuration: ["turnEnd"] }
    }
  }]);
}

async function onHitsChecked(workflow) {
  const handled = new Set();
  const hits = [...(workflow.hitTargets ?? []), ...(workflow.hitTargetsEC ?? [])];
  for (const entry of hits) {
    const defender = asToken(entry)?.actor;
    if (!defender || !hasDejaVu(defender) || handled.has(defender.uuid)) continue;
    handled.add(defender.uuid);
    if (missAlreadyUsed(defender)) continue;
    const attackerName = workflow.actor?.name ?? "атакующего";
    const accepted = await promptOwner(
      defender,
      `Заставить промахнуться атаку ${attackerName}? (1/бой)`,
      "Промах"
    );
    if (!accepted) continue;
    removeHit(workflow, defender);
    await markMissUsed(defender);
    await postFlavorChat(
      defender,
      `<p><strong>${PREFIX}</strong> — атака ${attackerName} промахивается.</p>`
    );
  }
}

function removeHit(workflow, actor) {
  for (const collection of [workflow.hitTargets, workflow.hitTargetsEC]) {
    if (!collection) continue;
    for (const entry of [...collection]) {
      if (asToken(entry)?.actor?.uuid === actor.uuid) collection.delete(entry);
    }
  }
}

function missAlreadyUsed(actor) {
  const effect = getDejaVuEffect(actor);
  const used = effect?.flags?.[MODULE_ID]?.dejaVu?.missUsedCombatId;
  if (!used) return false;
  return used === currentCombatKey();
}

async function markMissUsed(actor) {
  const effect = getDejaVuEffect(actor);
  if (!effect) return;
  await mutateActor(actor, "updateEmbeddedDocuments", "ActiveEffect", [{
    _id: effect.id,
    [`flags.${MODULE_ID}.dejaVu.missUsedCombatId`]: currentCombatKey()
  }]);
}

function currentCombatKey() {
  return game.combat?.id || "none";
}

async function wrapSavingThrow(wrapped, config = {}, dialog = {}, message = {}) {
  if (isConcentrationConfig(config)) markConcentrationRoll(this);
  return wrapped(config, dialog, message);
}

async function wrapConcentration(wrapped, config = {}, dialog = {}, message = {}) {
  markConcentrationRoll(this);
  return wrapped(config, dialog, message);
}

async function wrapD20RollBuild(wrapped, config = {}, dialog = {}, message = {}) {
  if (isSaveRollConfig(config)) await maybeOfferSaveBonus(config.subject, config);
  return wrapped(config, dialog, message);
}

function isSaveRollConfig(config = {}) {
  const hooks = config.hookNames ?? [];
  return hooks.some((name) => ["SavingThrow", "concentration", "deathSave", "save"].includes(name));
}

async function wrapEndConcentration(wrapped, ...args) {
  if (concForcedSuccess.has(this.uuid)) return [];
  if (!hasDejaVu(this) || !concRolls.has(this.uuid)) return wrapped(...args);
  const accepted = await offerConcentrationSuccess(this);
  if (accepted) return [];
  return wrapped(...args);
}

async function maybeOfferSaveBonus(actor, config) {
  if (!hasDejaVu(actor)) return;
  if (wasRecently(saveBonusPrompted, actor.uuid)) return;
  markRecent(saveBonusPrompted, actor.uuid, 2000);
  const accepted = await promptOwner(actor, "Добавить +5 к спасброску?", "+5");
  if (!accepted) return;
  pendingSaveBonuses.add(actor.uuid);
  setTimeout(() => pendingSaveBonuses.delete(actor.uuid), 4000);
  addSaveBonus(config);
  await postFlavorChat(actor, `<p><strong>${PREFIX}</strong> — +5 к спасброску.</p>`);
}

function injectPendingSaveBonus(config) {
  const actor = config?.subject;
  if (!actor || !pendingSaveBonuses.has(actor.uuid)) return;
  addSaveBonus(config);
}

function onPostBuildSaveRollConfig(config, rollConfig) {
  const actor = config?.subject;
  if (!actor || !pendingSaveBonuses.has(actor.uuid) || !rollConfig) return;
  rollConfig.parts ??= [];
  if (!rollConfig.parts.includes("5") && !rollConfig.parts.includes("+5")) rollConfig.parts.push("5");
}

function addSaveBonus(config = {}) {
  const rolls = Array.isArray(config.rolls) ? config.rolls : [];
  if (!rolls.length) {
    config.rolls = [{ parts: ["5"] }];
  } else {
    for (const roll of rolls) {
      roll.parts ??= [];
      if (!roll.parts.includes("5") && !roll.parts.includes("+5")) roll.parts.push("5");
    }
  }
  config.midiOptions ??= {};
  config.midiOptions.parts ??= [];
  if (!config.midiOptions.parts.includes("5")) config.midiOptions.parts.push("5");
}

function isConcentrationConfig(config = {}) {
  if (config.midiOptions?.isConcentrationCheck) return true;
  if (config.hookNames?.includes?.("concentration")) return true;
  return false;
}

function markConcentrationRoll(actor) {
  if (!actor?.uuid) return;
  concRolls.add(actor.uuid);
  setTimeout(() => concRolls.delete(actor.uuid), 8000);
}

async function onPostCheckSaves(workflow) {
  if (!isConcentrationWorkflow(workflow)) return;
  const failed = [...(workflow.failedSaves ?? [])]
    .map(asToken)
    .filter((token) => token?.actor && hasDejaVu(token.actor));
  for (const token of failed) {
    const accepted = await offerConcentrationSuccess(token.actor);
    if (!accepted) continue;
    workflow.failedSaves?.delete?.(token);
    workflow.saves?.add?.(token);
  }
}

function isConcentrationWorkflow(workflow) {
  return Boolean(
    workflow?.item?.flags?.["midi-qol"]?.isConcentrationCheck
    || workflow?.item?.system?.identifier === "concentration-check-midi-qol"
  );
}

async function offerConcentrationSuccess(actor) {
  if (!actor || !hasDejaVu(actor)) return false;
  if (concForcedSuccess.has(actor.uuid)) return true;
  const pending = concPromptWaiters.get(actor.uuid);
  if (pending) return pending;
  const promise = (async () => {
    const accepted = await promptOwner(
      actor,
      "Провал проверки концентрации. Преуспеть?",
      "Преуспеть"
    );
    if (!accepted) return false;
    markRecent(concForcedSuccess, actor.uuid, 8000);
    await postFlavorChat(actor, `<p><strong>${PREFIX}</strong> — проверка концентрации успешна.</p>`);
    return true;
  })();
  concPromptWaiters.set(actor.uuid, promise);
  try {
    return await promise;
  } finally {
    setTimeout(() => concPromptWaiters.delete(actor.uuid), 2000);
  }
}

function onUpdateCombat(combat, changed) {
  if (!("round" in changed)) return;
  for (const combatant of combat.combatants) {
    const actor = combatant.actor;
    if (!actor || !hasDejaVu(actor) || !isPrimaryHandler(actor)) continue;
    void bumpArmorClass(actor);
  }
}

async function bumpArmorClass(actor) {
  const effect = getDejaVuAcEffect(actor);
  if (!effect) return;
  const current = Number(effect.flags?.[MODULE_ID]?.dejaVuAc?.bonus) || 0;
  const cap = Number(actor.system?.attributes?.prof) || 0;
  if (current >= cap) return;
  const bonus = current + 1;
  await mutateActor(actor, "updateEmbeddedDocuments", "ActiveEffect", [{
    _id: effect.id,
    name: acEffectName(bonus),
    changes: acChanges(bonus),
    [`flags.${MODULE_ID}.dejaVuAc.bonus`]: bonus
  }]);
  await postFlavorChat(actor, `<p><strong>${PREFIX}</strong> — КБ +${bonus}.</p>`);
}

function onDeleteActiveEffect(effect) {
  if (!isDejaVuEffect(effect)) return;
  const actor = effect.parent;
  if (!actor || actor.documentName !== "Actor") return;
  if (replacing.has(actor.uuid)) return;
  if (!isPrimaryHandler(actor)) return;
  void finishDejaVu(actor);
}

async function finishDejaVu(actor) {
  const ids = actor.effects
    .filter((effect) => isDejaVuAcEffect(effect))
    .map((effect) => effect.id);
  if (ids.length) await mutateActor(actor, "deleteEmbeddedDocuments", "ActiveEffect", ids);
  await postFlavorChat(actor, `<p><strong>${PREFIX}</strong> — ощущение двойственности отступает.</p>`);
}

async function promptOwner(actor, content, yesLabel) {
  const socket = globalThis.autisticPremades?.socket;
  const owner = ownerUser(actor);
  if (owner && owner.id !== game.user.id && socket) {
    try {
      return await socket.executeAsUser(SOCKET_PROMPT, owner.id, { content, yesLabel });
    } catch (error) {
      console.warn(`Autistic Premades | ${PREFIX} prompt relay failed`, error);
    }
  }
  return showPrompt({ content, yesLabel });
}

function ownerUser(actor) {
  const owners = game.users.filter((user) => user.active && !user.isGM && actor.testUserPermission(user, "OWNER"));
  return owners[0] ?? (game.user.isGM ? game.user : game.users.activeGM);
}

export async function showDejaVuPrompt(data = {}) {
  return showPrompt(data);
}

async function showPrompt({ content, yesLabel = "Да" } = {}) {
  try {
    const chosen = await foundry.applications.api.DialogV2.wait({
      window: { title: PREFIX },
      content: `<p>${content}</p>`,
      buttons: [
        { action: "ok", label: yesLabel, default: true },
        { action: "skip", label: "Нет" }
      ],
      rejectClose: false
    });
    return chosen === "ok";
  } catch {
    return false;
  }
}

function hasDejaVu(actor) {
  return Boolean(getDejaVuEffect(actor));
}

function getDejaVuEffect(actor) {
  return findActorEffect(actor, isDejaVuEffect);
}

function getDejaVuAcEffect(actor) {
  return findActorEffect(actor, isDejaVuAcEffect);
}

function findActorEffect(actor, test) {
  if (!actor) return null;
  for (const list of [actor.appliedEffects, actor.effects]) {
    const match = list?.find?.((effect) => test(effect) && !effect.disabled);
    if (match) return match;
  }
  return null;
}

function isDejaVuEffect(effect) {
  return Boolean(effect?.flags?.[MODULE_ID]?.dejaVu);
}

function isDejaVuAcEffect(effect) {
  return Boolean(effect?.flags?.[MODULE_ID]?.dejaVuAc);
}

function getDejaVuItem(actor) {
  return actor?.items?.find((item) => isItem(item, DEJA_VU_ID)) ?? null;
}

function canSee(observer, target) {
  const observerToken = observer?.getActiveTokens?.()?.[0];
  const targetToken = target?.getActiveTokens?.()?.[0];
  if (!observerToken || !targetToken) return true;
  if (typeof globalThis.MidiQOL?.canSee === "function") return Boolean(MidiQOL.canSee(observerToken, targetToken));
  if (typeof globalThis.MidiQOL?.canSense === "function") return Boolean(MidiQOL.canSense(observerToken, targetToken));
  return true;
}

function asToken(entry) {
  if (!entry) return null;
  if (entry.actor && (entry.document || entry.center)) return entry;
  if (entry.object?.actor) return entry.object;
  if (typeof entry === "string") {
    const doc = fromUuidSync(entry);
    return doc?.object ?? doc ?? null;
  }
  return null;
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

function wasRecently(set, key) {
  return set.has(key);
}

function markRecent(set, key, ms) {
  set.add(key);
  setTimeout(() => set.delete(key), ms);
}
