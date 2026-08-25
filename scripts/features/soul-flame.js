import {
  MODULE_ID,
  SOUL_FLAME_MAIN_ID,
  SOUL_FLAME_BLAZE_ID,
  SOUL_FLAME_CRYSTAL_ID,
  SOUL_FLAME_SERPENT_ID,
  SOUL_FLAME_CRYSTAL_ESCAPE_ID,
  LEGENDARY_RESISTANCE_ID,
  isItem
} from "../lib/identifier.js";
import { applyActorDamage, postFlavorChat, updateActorDocument } from "../lib/hp.js";
import {
  distanceFeet,
  pickLineTemplate,
  pickTokenFromList,
  tokensInLine,
  tokenRadiusFeet,
  mutateActor
} from "../lib/area.js";

const PREFIX = "The Lovers";
const MOVEMENT_KEYS = ["walk", "burrow", "climb", "fly", "swim"];
const JUMP_RANGE = 30;
const MAX_TARGETS = 3;
const SERPENT_COST = 5;
const PRISON_COST = 3;
const SCALE_DICE = [6, 8, 10];
const SERPENT_DICE = [8, 10, 12];
const LINE_WIDTH = [5, 10, 15];
const LINE_LENGTH = [60, 120, 180, 1000];
const PRISON_DC = [20, 25, 30];

const inFlight = new Set();

const skipWeaponDamageUuids = new Set();

export function registerSoulFlame() {
  Hooks.on("midi-qol.spreDamageRoll", onPreDamageRoll);
  Hooks.on("midi-qol.preDamageRoll", onPreDamageRoll);
  Hooks.on("midi-qol.sDamageRollComplete", onDamageRollComplete);
  Hooks.on("midi-qol.DamageRollComplete", onDamageRollComplete);
  Hooks.on("midi-qol.preApplyDynamicEffects", onPreApplyDynamicEffects);
  Hooks.on("midi-qol.preTargetDamageApplication", onPreTargetDamageApplication);
  Hooks.on("midi-qol.RollComplete", onRollComplete);
  Hooks.on("midi-qol.preTargeting", onPreTargeting);
  Hooks.on("midi-qol.preTargetingV2", onPreTargeting);
  Hooks.on("midi-qol.preItemRoll", onPreItemRoll);
  Hooks.on("dnd5e.preUseActivity", onPreUseActivity);
  Hooks.on("dnd5e.preRollFormulaV2", onPreRollFormula);
  Hooks.on("dnd5e.preRollFormula", onPreRollFormula);
  Hooks.on("dnd5e.preApplyDamage", onPreApplyDamage);
  Hooks.on("dnd5e.calculateDamage", onCalculateDamage);
  Hooks.on("dnd5e.postUseActivity", onPostUseActivity);
  Hooks.on("deleteCombat", onDeleteCombat);
  Hooks.on("dnd5e.restCompleted", onRestCompleted);
  Hooks.on("deleteActiveEffect", onDeletePrisonEffect);
}

function onPreTargeting(payload) {
  const item = payload?.activity?.item
    ?? payload?.item
    ?? payload?.usage?.workflow?.item
    ?? payload?.workflow?.item;
  if (!isItem(item, SOUL_FLAME_CRYSTAL_ESCAPE_ID)) return;
  foundry.utils.setProperty(payload, "config.midiOptions.workflowOptions.allowIncapacitated", true);
  foundry.utils.setProperty(payload, "usage.midiOptions.workflowOptions.allowIncapacitated", true);
  foundry.utils.setProperty(payload, "config.midiOptions.proceedChecks.checkAllowIncapacitated", false);
  foundry.utils.setProperty(payload, "config.midiOptions.noRoll", true);
  foundry.utils.setProperty(payload, "usage.midiOptions.noRoll", true);
  const workflow = payload?.workflow ?? payload?.usage?.workflow;
  if (workflow) workflow.workflowOptions = { ...workflow.workflowOptions, allowIncapacitated: true, noRoll: true };
  suppressEscapeFormula(payload?.activity ?? workflow?.activity, workflow);
}

function onPreUseActivity(activity, usage) {
  const item = activity?.item;
  if (!isItem(item, SOUL_FLAME_CRYSTAL_ESCAPE_ID)) return;
  foundry.utils.setProperty(usage, "midiOptions.noRoll", true);
  foundry.utils.setProperty(usage, "midiOptions.workflowOptions.allowIncapacitated", true);
  suppressEscapeFormula(activity, usage?.workflow);
}

function onPreItemRoll(workflow) {
  if (!isItem(workflow?.item, SOUL_FLAME_CRYSTAL_ESCAPE_ID)) return;
  workflow.systemRoll = null;
  workflow.roll = null;
  workflow.workflowOptions = { ...workflow.workflowOptions, allowIncapacitated: true, noRoll: true };
  suppressEscapeFormula(workflow.activity, workflow);
}

function onPreRollFormula(config) {
  const item = config?.subject?.item ?? config?.item ?? config?.data?.item ?? config?.activity?.item;
  if (!isItem(item, SOUL_FLAME_CRYSTAL_ESCAPE_ID)) return;
  return false;
}

function suppressEscapeFormula(activity, workflow) {
  if (activity?.roll) {
    activity.roll.formula = "";
    activity.roll.prompt = false;
    activity.roll.visible = false;
  }
  if (workflow) {
    workflow.systemRoll = null;
    workflow.systemFormula = "";
  }
}

async function onPreDamageRoll(workflow, _activity, config) {
  snapshotHitHp(workflow);
  await ensureChoice(workflow);
  const choice = workflow?.apSoulFlame;
  if (choice?.mode === "heal" || choice?.mode === "prison") {
    markSkipWeaponDamage(choice);
    if (config) {
      config.midiOptions ??= {};
      config.midiOptions.noDamage = choice.mode === "prison";
      if (choice.mode === "prison") {
        config.rolls = [{
          parts: ["0"],
          data: workflow.actor?.getRollData?.() ?? {},
          options: { type: "none" }
        }];
      }
    }
  }
  if (choice?.mode === "prison" && !choice.applied) {
    choice.applied = true;
    await applyArrow(workflow);
  }
}

async function onDamageRollComplete(workflow) {
  const choice = workflow?.apSoulFlame;
  if (!choice || choice.mode === "none") return;
  const total = Number(workflow.damageTotal);
  if (Number.isFinite(total) && total > 0) choice.weaponDamage = total;
}

function onPreApplyDynamicEffects(workflow) {
  const mode = workflow?.apSoulFlame?.mode;
  if (mode !== "heal" && mode !== "prison") return;
  workflow.apSoulFlame.weaponDamage ??= Number(workflow.damageTotal) || 0;
  markSkipWeaponDamage(workflow.apSoulFlame);
  if (!Array.isArray(workflow.damageList)) return;
  for (const entry of workflow.damageList) {
    entry.hpDamage = 0;
    entry.appliedDamage = 0;
    entry.totalDamage = 0;
    entry.tempDamage = 0;
    entry.newHP = entry.oldHP ?? entry.newHP;
    entry.newTempHP = entry.oldTempHP ?? entry.newTempHP;
  }
}

function onPreTargetDamageApplication(token, extra) {
  const workflow = extra?.workflow ?? extra;
  const damageItem = extra?.damageItem;
  const mode = workflow?.apSoulFlame?.mode;
  if (mode !== "heal" && mode !== "prison") return;
  if (!damageItem) return;
  workflow.apSoulFlame.weaponDamage ??= Number(damageItem.totalDamage ?? damageItem.rawDamage ?? 0);
  markSkipWeaponDamage(workflow.apSoulFlame);
  damageItem.hpDamage = 0;
  damageItem.appliedDamage = 0;
  damageItem.tempDamage = 0;
  damageItem.totalDamage = 0;
}

function onCalculateDamage(actor, damages) {
  if (!shouldSkipWeaponDamage(actor) || !damages) return;
  if (typeof damages.amount === "number") damages.amount = 0;
  const entries = typeof damages[Symbol.iterator] === "function" ? damages : [];
  for (const entry of entries) {
    if (!entry || entry.type === "healing" || entry.type === "temphp") continue;
    if (typeof entry.value === "number") entry.value = 0;
    if (typeof entry.total === "number") entry.total = 0;
  }
}

function onPreApplyDamage(actor, damagesOrAmount, updates) {
  if (!shouldSkipWeaponDamage(actor)) return;
  if (typeof damagesOrAmount === "number") {
    if (!(damagesOrAmount > 0) || !updates) return;
    const hp = actor.system?.attributes?.hp;
    if (!hp) return;
    updates["system.attributes.hp.value"] = Number(hp.value) || 0;
    updates["system.attributes.hp.temp"] = Number(hp.temp) || 0;
    return;
  }
  if (!Array.isArray(damagesOrAmount)) return;
  for (const entry of damagesOrAmount) {
    if (!entry || entry.type === "healing" || entry.type === "temphp") continue;
    entry.value = 0;
    entry.total = 0;
  }
}

function shouldSkipWeaponDamage(actor) {
  if (!actor) return false;
  return skipWeaponDamageUuids.has(actor.uuid)
    || Boolean(actor.getFlag?.(MODULE_ID, "skipSoulFlameWeaponDamage"));
}

function markSkipWeaponDamage(choice) {
  if (!choice) return;
  choice.skipWeaponDamage = true;
  const actor = choice.primary?.actor;
  if (!actor) return;
  skipWeaponDamageUuids.add(actor.uuid);
  void actor.setFlag?.(MODULE_ID, "skipSoulFlameWeaponDamage", true)?.catch?.(() => {});
}

async function clearSkipWeaponDamage(choice) {
  const actor = choice?.primary?.actor;
  if (actor?.uuid) skipWeaponDamageUuids.delete(actor.uuid);
  if (!actor?.getFlag?.(MODULE_ID, "skipSoulFlameWeaponDamage")) return;
  try {
    await actor.unsetFlag(MODULE_ID, "skipSoulFlameWeaponDamage");
  } catch {
    // flag cleanup is best-effort
  }
}

function onRollComplete(workflow) {
  const choice = workflow?.apSoulFlame;
  if (!choice || choice.mode === "none" || choice.applied) return;
  const actor = workflow.actor;
  if (!actor || !isPrimaryHandler(actor)) return;
  choice.applied = true;
  void applyArrow(workflow);
}

function onPostUseActivity(activity) {
  const item = activity?.item ?? activity;
  if (!item?.actor || !isPrimaryHandler(item.actor)) return;
  const id = activityId(activity);

  if (isItem(item, SOUL_FLAME_MAIN_ID) && id === "apSoulRestore001") {
    const key = `restore:${item.actor.uuid}`;
    if (inFlight.has(key)) return;
    inFlight.add(key);
    void restoreCharges(item).finally(() => inFlight.delete(key));
    return;
  }

  if (isItem(item, SOUL_FLAME_SERPENT_ID)) {
    if (id === "apSoulSerpentAtk") {
      const key = `serpent:${item.actor.uuid}`;
      if (inFlight.has(key)) return;
      inFlight.add(key);
      void fireSerpent(item).finally(() => inFlight.delete(key));
      return;
    }
    if (id === "apSoulSerpentRet") {
      const key = `flash:${item.actor.uuid}`;
      if (inFlight.has(key)) return;
      inFlight.add(key);
      void fireSerpentFlash(item).finally(() => inFlight.delete(key));
    }
    return;
  }

  if (isItem(item, SOUL_FLAME_CRYSTAL_ESCAPE_ID)) {
    if ((Number(item.flags?.[MODULE_ID]?.skipUseUntil) || 0) > Date.now()) return;
    const key = `escape:${item.actor.uuid}`;
    if (inFlight.has(key)) return;
    inFlight.add(key);
    void tryCrystalEscape(item).finally(() => inFlight.delete(key));
  }
}

async function ensureChoice(workflow) {
  if (!workflow) return;
  if (workflow.apSoulFlame !== undefined) return;
  if (workflow.apSoulFlameLock) return workflow.apSoulFlameLock;

  const run = (async () => {
    const actor = workflow.actor;
    if (!actor || !isPrimaryHandler(actor)) return;
    if (!isBowAttack(workflow)) return;

    const hits = normalizeTokens(workflow.hitTargets);
    if (!hits.length) {
      workflow.apSoulFlame = { mode: "none" };
      return;
    }

    const main = findItem(actor, SOUL_FLAME_MAIN_ID);
    if (!main) return;
    const remaining = remainingUses(main);
    if (remaining < 1) {
      workflow.apSoulFlame = { mode: "none" };
      return;
    }

    const choice = await promptArrowChoice(actor, remaining, hits[0]);
    workflow.apSoulFlame = {
      ...(choice ?? { mode: "none" }),
      primary: hits[0]
    };
  })();

  workflow.apSoulFlameLock = run;
  return run;
}

function snapshotHitHp(workflow) {
  if (!workflow || workflow.apSoulFlameSnapshot) return;
  const hit = normalizeTokens(workflow.hitTargets)[0];
  const hp = hit?.actor?.system?.attributes?.hp;
  if (!hp) return;
  workflow.apSoulFlameSnapshot = {
    uuid: hit.actor.uuid,
    hp: Number(hp.value) || 0,
    temp: Number(hp.temp) || 0
  };
}

async function promptArrowChoice(actor, remaining, primaryToken) {
  try {
    while (true) {
      const mode = await foundry.applications.api.DialogV2.wait({
        window: { title: PREFIX },
        classes: ["ap-lovers-arrow-choice"],
        position: { width: 420 },
        content: `<p>Заряды: <strong>${remaining}</strong>. Не больше одной стрелы за атаку. Глыба стоит 3 заряда.</p>`,
        buttons: [
          { action: "blaze", label: "You, the Heartfelt Blaze — урон" },
          { action: "heal", label: "You, the Heartfelt Blaze — лечение" },
          { action: "crystal", label: "I, the Zeroeth Crystal — холод" },
          { action: "prison", label: "I, the Zeroeth Crystal — глыба" },
          { action: "none", label: "Не воплощать" }
        ],
        rejectClose: false,
        render: (_event, dialog) => stackDialogButtons(dialog)
      });
      if (!mode || mode === "none") return { mode: "none" };
      if (mode === "prison") {
        if (remaining < PRISON_COST) {
          ui.notifications.warn(`${PREFIX} | Для глыбы нужно ${PRISON_COST} заряда (сейчас ${remaining}).`);
          continue;
        }
        if (wasPrisonUsed(actor, primaryToken?.actor)) {
          ui.notifications.warn(`${PREFIX} | Глыбу уже применяли к этой цели в этом бою.`);
          continue;
        }
      }
      return { mode };
    }
  } catch {
    return { mode: "none" };
  }
}

function stackDialogButtons(dialog) {
  const root = dialog?.element instanceof HTMLElement
    ? dialog.element
    : dialog instanceof HTMLElement
      ? dialog
      : dialog?.element?.[0] ?? null;
  if (!root) return;
  root.classList.add("ap-lovers-arrow-choice");
  const footer = root.querySelector(".form-footer") ?? root.querySelector("footer");
  if (!footer) return;
  Object.assign(footer.style, {
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: "0.35rem"
  });
  for (const button of footer.querySelectorAll("button")) {
    Object.assign(button.style, {
      width: "100%",
      height: "auto",
      minHeight: "2em",
      whiteSpace: "normal",
      lineHeight: "1.3",
      padding: "0.45rem 0.7rem"
    });
  }
}

async function applyArrow(workflow) {
  const actor = workflow.actor;
  const choice = workflow.apSoulFlame;
  const primary = choice.primary ?? normalizeTokens(workflow.hitTargets)[0];
  const main = findItem(actor, SOUL_FLAME_MAIN_ID);
  if (!actor || !choice || !primary?.actor || !main) return;

  if (choice.mode === "prison" && wasPrisonUsed(actor, primary.actor)) {
    ui.notifications.warn(`${PREFIX} | Глыбу уже применяли к этой цели в этом бою.`);
    await clearSkipWeaponDamage(choice);
    return;
  }

  const scale = getScale(actor);

  if (choice.mode === "blaze" || choice.mode === "heal") {
    if (remainingUses(main) < 1) {
      ui.notifications.warn(`${PREFIX} | Недостаточно зарядов.`);
      await clearSkipWeaponDamage(choice);
      return;
    }
    await spendUses(main, 1);
    if (choice.mode === "heal") {
      await clearSkipWeaponDamage(choice);
      await applyBlazeHeal(actor, workflow, primary, [], scale);
    } else {
      const blazeItem = findItem(actor, SOUL_FLAME_BLAZE_ID) ?? workflow.item;
      const total = await applyBlazeJumpDamage(actor, workflow.token ?? attackerToken(actor), primary, scale, blazeItem, {
        isCritical: workflowIsCritical(workflow)
      });
      if (choice) choice.blazeTotal = total;
    }
    await offerBlazeJumps(workflow, actor, main, primary, scale, choice.mode);
    return;
  }

  const cost = choice.mode === "prison" ? PRISON_COST : 1;
  if (remainingUses(main) < cost) {
    ui.notifications.warn(`${PREFIX} | Недостаточно зарядов.`);
    await clearSkipWeaponDamage(choice);
    return;
  }
  await spendUses(main, cost);

  if (choice.mode === "crystal") await applyCrystalCold(actor, workflow, primary, scale);
  else if (choice.mode === "prison") {
    await clearSkipWeaponDamage(choice);
    await applyPrison(actor, workflow, primary, scale);
  }
}

async function offerBlazeJumps(workflow, actor, main, primary, scale, mode) {
  const extra = [];
  const attackerToken = workflow.token ?? attackerTokenOf(actor);
  const blazeItem = findItem(actor, SOUL_FLAME_BLAZE_ID) ?? workflow.item;
  const sourceToken = workflow.token ?? attackerToken;

  while (extra.length < MAX_TARGETS - 1 && remainingUses(main) >= 1) {
    const origin = extra.at(-1) ?? primary;
    const exclude = [primary, ...extra, attackerToken];
    const nearby = tokensWithin(origin, JUMP_RANGE, exclude);
    if (!nearby.length) {
      if (!extra.length) ui.notifications.info(`${PREFIX} | Нет целей в 30 фт. для прыжка.`);
      break;
    }
    const picked = await pickJumpTarget(origin, nearby);
    if (!picked) break;
    extra.push(picked);
    await spendUses(main, 1);
    if (mode === "blaze") {
      await applyBlazeJumpDamage(actor, sourceToken, picked, scale, blazeItem, {
        reuseTotal: workflow.apSoulFlame?.blazeTotal
      });
    }
    else await applyBlazeJumpHeal(actor, sourceToken, picked, workflow, scale, blazeItem);
  }
}

async function pickJumpTarget(originToken, candidates) {
  return pickTokenFromList(candidates, {
    title: "You, the Heartfelt Blaze — прыжок",
    label: `Существа в <strong>30 фт.</strong> от <strong>${originToken.name}</strong>. Наведите на имя, чтобы подсветить токен.`,
    skipLabel: "Не прыгать",
    autoPickSingle: false
  });
}

async function applyBlazeJumpDamage(actor, sourceToken, target, scale, item, { isCritical = false, reuseTotal } = {}) {
  const reused = Number.isFinite(Number(reuseTotal));
  let total;
  if (reused) {
    total = Number(reuseTotal);
  } else {
    const formula = `1d${scale.die} + ${scale.prof}d${scale.die}`;
    const DamageRoll = CONFIG.Dice.DamageRoll ?? globalThis.DamageRoll;
    const roll = await new DamageRoll(formula, actor.getRollData?.() ?? {}, blazeDamageOptions(isCritical)).evaluate();
    await globalThis.MidiQOL?.displayDSNForRoll?.(roll, "damageRoll");
    total = Number(roll.total) || 0;
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: "You, the Heartfelt Blaze — огонь"
    });
  }
  await applyMidiTokenDamage([{ damage: total, value: total, type: "fire" }], total, target, item, {
    actor,
    token: sourceToken
  });
  const same = reused ? " (тот же бросок)" : "";
  await postFlavorChat(
    actor,
    `<p><strong>You, the Heartfelt Blaze</strong> — ${target.name}: ${total} огня${same}.</p>`
  );
  return total;
}

async function applyBlazeJumpHeal(actor, sourceToken, target, workflow, scale, item) {
  const primaryHeal = Number(workflow.apSoulFlame?.healTotal);
  const amount = Number.isFinite(primaryHeal)
    ? Math.floor(primaryHeal / 2)
    : Math.floor(((Number(workflow.apSoulFlame?.weaponDamage) || 0) + (scale.prof * (scale.die + 1)) / 2) / 2);
  const DamageRoll = CONFIG.Dice.DamageRoll ?? globalThis.DamageRoll;
  const roll = await new DamageRoll(`${amount}`, actor.getRollData?.() ?? {}, damageRollOptions("healing", { isCritical: false })).evaluate();
  await globalThis.MidiQOL?.displayDSNForRoll?.(roll, "damageRoll");
  await applyMidiTokenDamage([{ damage: amount, value: amount, type: "healing" }], amount, target, item, {
    actor,
    token: sourceToken
  });
}

async function applyMidiTokenDamage(detail, total, token, item, source = {}) {
  const tokens = Array.isArray(token) ? token.filter(Boolean) : [token].filter(Boolean);
  if (!tokens.length) return;
  const entries = detail.map((entry) => ({
    damage: entry.damage ?? entry.value ?? 0,
    value: entry.value ?? entry.damage ?? 0,
    type: entry.type
  }));
  if (globalThis.MidiQOL?.applyTokenDamage) {
    await globalThis.MidiQOL.applyTokenDamage(
      entries,
      total,
      new Set(tokens),
      item,
      new Set(),
      { forceApply: true }
    );
    return;
  }
  for (const entry of tokens) {
    if (entry?.actor) {
      await applyActorDamage(entry.actor, entries.map((part) => ({ value: part.value, type: part.type })));
    }
  }
}

function attackerTokenOf(actor) {
  return attackerToken(actor);
}

async function applyBlazeHeal(actor, workflow, primary, _extraTokens, scale) {
  const target = primary.actor;
  let weapon = Number(workflow.apSoulFlame?.weaponDamage) || 0;
  const snapshot = workflow.apSoulFlameSnapshot;
  if (snapshot?.uuid === target.uuid) {
    const hp = target.system?.attributes?.hp;
    const now = (Number(hp?.value) || 0) + (Number(hp?.temp) || 0);
    const lost = snapshot.hp + snapshot.temp - now;
    if (lost > 0) {
      weapon = Math.max(weapon, lost);
      await restoreSnapshot(target, snapshot);
    }
  }

  const roll = await new Roll(`${scale.prof}d${scale.die}`).evaluate();
  await globalThis.MidiQOL?.displayDSNForRoll?.(roll, "damageRoll");
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: "You, the Heartfelt Blaze — лечение"
  });
  const total = weapon + (Number(roll.total) || 0);
  if (workflow.apSoulFlame) workflow.apSoulFlame.healTotal = total;
  const blazeItem = findItem(actor, SOUL_FLAME_BLAZE_ID) ?? workflow.item;
  await applyMidiTokenDamage([{ damage: total, value: total, type: "healing" }], total, primary, blazeItem, {
    actor,
    token: workflow.token ?? attackerToken(actor)
  });
  await postFlavorChat(actor, `<p><strong>You, the Heartfelt Blaze</strong> — лечение ${total}.</p>`);
}

async function applyCrystalCold(actor, workflow, primary, scale) {
  const formula = `${scale.prof}d${scale.die}`;
  const DamageRoll = CONFIG.Dice.DamageRoll ?? globalThis.DamageRoll;
  const roll = await new DamageRoll(
    formula,
    actor.getRollData?.() ?? {},
    damageRollOptions("cold", { isCritical: workflowIsCritical(workflow) })
  ).evaluate();
  await globalThis.MidiQOL?.displayDSNForRoll?.(roll, "damageRoll");
  const total = Number(roll.total) || 0;
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: "I, the Zeroeth Crystal — холод"
  });
  const crystalItem = findItem(actor, SOUL_FLAME_CRYSTAL_ID) ?? workflow.item;
  await applyMidiTokenDamage([{ damage: total, value: total, type: "cold" }], total, primary, crystalItem, {
    actor,
    token: workflow.token ?? attackerToken(actor)
  });
  await postFlavorChat(actor, `<p><strong>I, the Zeroeth Crystal</strong> — ${primary.name}: ${total} холода.</p>`);
  const dc = spellDc(actor);
  const saved = await rollSave(primary.actor, "con", dc);
  await postFlavorChat(actor, `<p><strong>I, the Zeroeth Crystal</strong> — спас Выносливости DC ${dc}: ${saved ? "успех (скорость ×½)" : "провал (скорость 0)"}.</p>`);
  const origin = workflow.item?.uuid ?? "";
  if (saved) await mutateActor(primary.actor, "createEmbeddedDocuments", "ActiveEffect", [halfSpeedEffect(origin)]);
  else await mutateActor(primary.actor, "createEmbeddedDocuments", "ActiveEffect", [noSpeedEffect(origin)]);
}

async function applyPrison(actor, workflow, primary, scale) {
  const target = primary.actor;
  const snapshot = workflow.apSoulFlameSnapshot;
  if (snapshot?.uuid === target.uuid) await restoreSnapshot(target, snapshot);
  const dc = scale.prisonDc;
  const origin = workflow.item?.uuid ?? "";
  try {
    await mutateActor(target, "createEmbeddedDocuments", "ActiveEffect", [prisonEffectData(origin, actor, dc)]);
  } catch (error) {
    console.warn(`${PREFIX} | Prison effect failed`, error);
    ui.notifications.warn(`${PREFIX} | Не удалось наложить глыбу на ${target.name}.`);
    return;
  }
  try {
    await mutateActor(target, "createEmbeddedDocuments", "Item", [escapeItemData(dc, actor)]);
  } catch (error) {
    console.warn(`${PREFIX} | Prison escape item failed`, error);
    ui.notifications.warn(`${PREFIX} | Глыба наложена, но действие побега не создалось.`);
  }
  await markPrisonUsed(actor, target);
  await postFlavorChat(actor, `<p><strong>I, the Zeroeth Crystal</strong> — ${target.name} заточена в хрустальную глыбу (DC ${dc}).</p>`);
}

async function restoreCharges(item) {
  const actor = item.actor;
  if (!actor) return;
  if (!await consumePactSlot(actor)) return;
  await item.update({ "system.uses.spent": 0 });
  await postFlavorChat(actor, "<p><strong>We, both Flame and Light</strong> — все заряды восстановлены.</p>");
}

async function consumePactSlot(actor) {
  const value = Number(actor.system?.spells?.pact?.value) || 0;
  if (value < 1) {
    ui.notifications.warn(`${PREFIX} | Нет пактовой ячейки.`);
    return false;
  }
  await updateActorDocument(actor, { "system.spells.pact.value": value - 1 });
  return true;
}

async function fireSerpent(item) {
  const actor = item.actor;
  if (!actor) return;
  if (!hasBowEquipped(actor)) {
    ui.notifications.warn(`${PREFIX} | Нужен экипированный лук.`);
    return;
  }

  const main = findItem(actor, SOUL_FLAME_MAIN_ID);
  if (!main || remainingUses(main) < SERPENT_COST) {
    ui.notifications.warn(`${PREFIX} | Нужно 5 зарядов.`);
    return;
  }

  const dailySpent = remainingUses(item) < 1;
  if (dailySpent && !await confirmExhaustion()) return;

  const token = attackerToken(actor);
  if (!token) {
    ui.notifications.warn(`${PREFIX} | Нет токена на сцене.`);
    return;
  }

  const scale = getScale(actor);
  const line = await pickLineTemplate({
    origin: token.center,
    length: scale.length,
    width: scale.width,
    fillColor: "#ffe566",
    notifyPrefix: PREFIX,
    effect: "heavenly-serpent"
  });
  if (!line) {
    ui.notifications.info(`${PREFIX} | Выбор отменён.`);
    return;
  }

  const inLine = line.tokens.filter((entry) => entry.id !== token.id);
  const chosen = await pickTargetsFromTokens(inLine, "Цели линии");
  if (chosen === null) return;

  await spendUses(main, SERPENT_COST);
  if (dailySpent) await applyExhaustion(actor, 3);
  else await spendUses(item, 1);

  const formula = `4d${scale.serpentDie} + ${scale.prof}d${scale.serpentDie}`;
  const DamageRoll = CONFIG.Dice.DamageRoll ?? globalThis.DamageRoll;
  const roll = await new DamageRoll(formula, actor.getRollData?.() ?? {}, damageRollOptions("radiant")).evaluate();
  await globalThis.MidiQOL?.displayDSNForRoll?.(roll, "damageRoll");
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: "We, the Heavenly Serpent"
  });
  const dc = spellDc(actor);
  const full = Number(roll.total) || 0;
  const half = Math.floor(full / 2);
  const failed = [];
  const saved = [];

  for (const targetToken of chosen) {
    if (!targetToken.actor) continue;
    if (await rollSave(targetToken.actor, "cha", dc)) saved.push(targetToken);
    else failed.push(targetToken);
  }

  if (failed.length) {
    await applyMidiTokenDamage([{ damage: full, value: full, type: "radiant" }], full, failed, item, { actor, token });
  }
  if (saved.length && half > 0) {
    await applyMidiTokenDamage([{ damage: half, value: half, type: "radiant" }], half, saved, item, { actor, token });
  }

  await storeSerpentFlash(actor, line);
}

async function fireSerpentFlash(item) {
  const actor = item.actor;
  if (!actor) return;
  const data = actor.getFlag(MODULE_ID, "soulFlame.serpentFlash");
  if (!data) {
    ui.notifications.warn(`${PREFIX} | Нет активной линии.`);
    return;
  }
  if (!isFlashReady(actor, data)) {
    ui.notifications.warn(`${PREFIX} | Вспышку можно вызвать на следующем ходу.`);
    return;
  }
  if (data.sceneId && canvas.scene?.id !== data.sceneId) {
    ui.notifications.warn(`${PREFIX} | Линия на другой сцене.`);
    return;
  }

  const tokens = tokensInLine(data.end, data.origin, data.width);
  const chosen = await pickTargetsFromTokens(tokens, "Временные хиты");
  if (chosen === null) return;

  const amount = 10 + 2 * warlockLevel(actor);
  for (const token of chosen) {
    if (!token.actor) continue;
    await applyActorDamage(token.actor, [{ value: amount, type: "temphp" }]);
  }
  await actor.unsetFlag(MODULE_ID, "soulFlame.serpentFlash");
  await postFlavorChat(actor, `<p><strong>We, the Heavenly Serpent</strong> — вспышка: ${amount} временных хитов.</p>`);
}

function isFlashReady(actor, data) {
  if (!data) return false;
  const combat = game.combat;
  if (!combat || !data.combatId || combat.id !== data.combatId) return true;
  const advanced = combat.round > data.fireRound
    || (combat.round === data.fireRound && combat.turn > data.fireTurn);
  if (!advanced) return false;
  return combat.combatant?.actor?.uuid === actor.uuid;
}

async function storeSerpentFlash(actor, line) {
  const combat = game.combat;
  await actor.setFlag(MODULE_ID, "soulFlame.serpentFlash", {
    origin: { x: line.origin.x, y: line.origin.y },
    end: { x: line.end.x, y: line.end.y },
    width: line.width,
    sceneId: canvas.scene?.id ?? null,
    combatId: combat?.id ?? null,
    fireRound: combat?.round ?? 0,
    fireTurn: combat?.turn ?? 0
  });
}

async function confirmExhaustion() {
  try {
    const chosen = await foundry.applications.api.DialogV2.wait({
      window: { title: PREFIX },
      content: "<p>Эта стрела уже была выпущена после долгого отдыха. Выпустить снова и получить 3 уровня истощения?</p>",
      buttons: [
        { action: "ok", label: "Выпустить (3 истощения)" },
        { action: "cancel", label: "Отмена" }
      ],
      rejectClose: false
    });
    return chosen === "ok";
  } catch {
    return false;
  }
}

async function applyExhaustion(actor, levels) {
  const current = Number(actor.system?.attributes?.exhaustion) || 0;
  const next = Math.min(6, current + levels);
  await updateActorDocument(actor, { "system.attributes.exhaustion": next });
  await postFlavorChat(actor, `<p>${PREFIX}: +${levels} истощения (сейчас ${next}).</p>`);
}

async function tryCrystalEscape(item) {
  const actor = item.actor;
  if (!actor) return;
  const dc = Number(item.flags?.[MODULE_ID]?.soulFlame?.dc) || 20;
  const hasLR = hasLegendaryResistance(actor);
  let useLR = false;

  if (hasLR) {
    try {
      const chosen = await foundry.applications.api.DialogV2.wait({
        window: { title: PREFIX },
        content: `<p>Выбраться из глыбы (DC ${dc})?</p>`,
        buttons: [
          { action: "save", label: "Спасбросок Силы" },
          { action: "lr", label: "Легендарное сопротивление" },
          { action: "cancel", label: "Отмена" }
        ],
        rejectClose: false
      });
      if (chosen === "cancel" || !chosen) return;
      useLR = chosen === "lr";
    } catch {
      return;
    }
  }

  if (useLR) {
    await spendLegendaryResistance(actor);
    await removePrison(actor);
    await postFlavorChat(actor, "<p>Хрустальная глыба разбита легендарным сопротивлением.</p>");
    return;
  }

  const suppressed = await suppressPrisonSaveCap(actor);
  let saved = false;
  try {
    saved = await rollUncappedSave(actor, "str", dc);
  } finally {
    if (!saved) await restoreSuppressedEffects(actor, suppressed);
  }
  if (saved) {
    await removePrison(actor);
    await postFlavorChat(actor, "<p>Хрустальная глыба разбита.</p>");
    return;
  }
  await postFlavorChat(actor, "<p>Не удалось выбраться из глыбы.</p>");
}

function hasLegendaryResistance(actor) {
  if ((Number(actor.system?.resources?.legres?.value) || 0) > 0) return true;
  const item = actor.items.find((entry) => isItem(entry, LEGENDARY_RESISTANCE_ID));
  return Boolean(item && remainingUses(item) > 0);
}

async function spendLegendaryResistance(actor) {
  const item = actor.items.find((entry) => isItem(entry, LEGENDARY_RESISTANCE_ID));
  if (item && remainingUses(item) > 0) {
    await spendUses(item, 1);
    return;
  }
  const value = Number(actor.system?.resources?.legres?.value) || 0;
  if (value > 0) await updateActorDocument(actor, { "system.resources.legres.value": value - 1 });
}

async function removePrison(actor) {
  const prisonEffects = actor.effects.filter((effect) => effect.flags?.[MODULE_ID]?.soulFlame?.prison);
  const origins = new Set(prisonEffects.map((effect) => effect.uuid).filter(Boolean));
  const extras = actor.effects.filter((effect) => {
    if (effect.flags?.[MODULE_ID]?.soulFlame?.prison) return false;
    if (effect.origin && origins.has(effect.origin)) return true;
    return false;
  });
  const effectIds = [...prisonEffects, ...extras].map((effect) => effect.id);
  if (effectIds.length) await mutateActor(actor, "deleteEmbeddedDocuments", "ActiveEffect", effectIds);
  const items = actor.items.filter((item) => isItem(item, SOUL_FLAME_CRYSTAL_ESCAPE_ID)).map((item) => item.id);
  if (items.length) await mutateActor(actor, "deleteEmbeddedDocuments", "Item", items);
  if (actor.getFlag?.("midi-qol", "neverTarget")) {
    try {
      await actor.unsetFlag("midi-qol", "neverTarget");
    } catch {
      // ignore
    }
  }
}

function onDeletePrisonEffect(effect) {
  if (!effect.flags?.[MODULE_ID]?.soulFlame?.prison) return;
  const actor = effect.parent;
  if (!actor || actor.documentName !== "Actor") return;
  if (!game.user.isGM && !isPrimaryHandler(actor)) return;
  const items = actor.items.filter((item) => isItem(item, SOUL_FLAME_CRYSTAL_ESCAPE_ID)).map((item) => item.id);
  if (items.length) void mutateActor(actor, "deleteEmbeddedDocuments", "Item", items);
}

function onDeleteCombat() {
  if (!game.user.isGM) return;
  for (const actor of game.actors) {
    if (actor.getFlag(MODULE_ID, "soulFlame.prisonUsed")) void actor.unsetFlag(MODULE_ID, "soulFlame.prisonUsed");
    if (actor.getFlag(MODULE_ID, "soulFlame.serpentFlash")) void actor.unsetFlag(MODULE_ID, "soulFlame.serpentFlash");
  }
}

function onRestCompleted(actor, result, config) {
  if (!actor || !isLongRest(result, config) || !actor.isOwner) return;
  void actor.unsetFlag(MODULE_ID, "soulFlame.prisonUsed");
  void actor.unsetFlag(MODULE_ID, "soulFlame.serpentFlash");
}

function isLongRest(result, config) {
  return Boolean(
    result?.longRest
    || result?.type === "long"
    || config?.type === "long"
    || config?.restType === "long"
  );
}

async function pickTargetsFromTokens(tokens, title) {
  const list = (tokens ?? []).filter((token) => token?.actor);
  if (!list.length) return [];
  const checks = list
    .map((token) => `<label style="display:block;margin:2px 0;"><input type="checkbox" name="t" value="${token.id}" checked> ${token.name ?? token.actor.name}</label>`)
    .join("");
  try {
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: `${PREFIX} — ${title}` },
      content: `<form><p>Выберите существ:</p>${checks}</form>`,
      ok: {
        label: "Применить",
        callback: (_event, button) => Array.from(button.form.querySelectorAll("input[name=t]:checked")).map((el) => el.value)
      },
      cancel: { label: "Отмена" },
      rejectClose: false
    });
    if (result == null) return null;
    const ids = new Set(Array.isArray(result) ? result : []);
    return list.filter((token) => ids.has(token.id));
  } catch {
    return null;
  }
}

function prisonEffectData(origin, source, dc) {
  return {
    name: "Хрустальная глыба",
    img: "icons/magic/water/orb-ice-web.webp",
    origin,
    transfer: false,
    disabled: false,
    duration: {
      seconds: 60,
      rounds: 10,
      startTime: game.time?.worldTime ?? 0,
      startRound: game.combat?.round ?? 0,
      startTurn: game.combat?.turn ?? 0
    },
    statuses: ["incapacitated"],
    changes: [
      ...MOVEMENT_KEYS.map((key) => ({
        key: `system.attributes.movement.${key}`,
        mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE,
        value: "0",
        priority: 50
      })),
      {
        key: "flags.midi-qol.neverTarget",
        mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE,
        value: "1",
        priority: 50
      }
    ],
    flags: {
      [MODULE_ID]: {
        soulFlame: { prison: true, dc, sourceUuid: source.uuid }
      },
      "midi-qol": {
        neverTarget: true
      }
    }
  };
}

function escapeItemData(dc, source) {
  const activityId = "apSoulCrystalEsc";
  return {
    name: "Выбраться из глыбы",
    type: "feat",
    img: "icons/magic/water/orb-ice-web.webp",
    system: {
      description: {
        value: `<p>Действием совершите спасбросок Силы (DC ${dc}) или потратите легендарное сопротивление, чтобы выбраться из хрустальной глыбы.</p>`
      },
      source: { custom: "Autistic Premades", revision: 1, rules: "2014" },
      identifier: SOUL_FLAME_CRYSTAL_ESCAPE_ID,
      type: { value: "class", subtype: "" },
      uses: { spent: 0, max: "", recovery: [] },
      activities: {
        [activityId]: {
          _id: activityId,
          type: "utility",
          name: "Выбраться",
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
          uses: { spent: 0, max: "", recovery: [] },
          roll: { formula: "", name: "", prompt: false, visible: false }
        }
      }
    },
    effects: [],
    flags: {
      [MODULE_ID]: {
        identifier: SOUL_FLAME_CRYSTAL_ESCAPE_ID,
        soulFlame: { dc, sourceUuid: source?.uuid ?? "" },
        skipUseUntil: Date.now() + 2000
      },
      "midi-qol": {
        workflowOptions: { allowIncapacitated: true, noRoll: true }
      }
    }
  };
}

function noSpeedEffect(origin) {
  return {
    name: "Покрыт льдом",
    img: "icons/magic/water/orb-ice-web.webp",
    origin,
    transfer: false,
    disabled: false,
    duration: endOfNextTurnDuration(),
    changes: MOVEMENT_KEYS.map((key) => ({
      key: `system.attributes.movement.${key}`,
      mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE,
      value: "0",
      priority: 50
    })),
    flags: {
      [MODULE_ID]: { soulFlame: { ice: true } },
      dae: { specialDuration: ["turnEnd"] }
    }
  };
}

function halfSpeedEffect(origin) {
  return {
    name: "Замедлен льдом",
    img: "icons/magic/water/orb-ice-web.webp",
    origin,
    transfer: false,
    disabled: false,
    duration: endOfNextTurnDuration(),
    changes: MOVEMENT_KEYS.map((key) => ({
      key: `system.attributes.movement.${key}`,
      mode: CONST.ACTIVE_EFFECT_MODES.MULTIPLY,
      value: "0.5",
      priority: 20
    })),
    flags: {
      [MODULE_ID]: { soulFlame: { ice: true } },
      dae: { specialDuration: ["turnEnd"] }
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

async function rollSave(actor, ability, dc) {
  try {
    if (typeof actor.rollSavingThrow === "function") {
      const result = await actor.rollSavingThrow(
        {
          ability,
          target: dc,
          dc,
          difficultyClass: { value: dc }
        },
        { configure: false },
        { create: true }
      );
      const roll = Array.isArray(result) ? result[0] : result;
      const total = Number(roll?.total ?? roll?._total);
      if (Number.isFinite(total)) return total >= dc;
    }
    if (typeof actor.rollAbilitySave === "function") {
      const result = await actor.rollAbilitySave(ability, {
        targetValue: dc,
        chatMessage: true
      });
      const roll = Array.isArray(result) ? result[0] : result;
      const total = Number(roll?.total ?? roll?._total);
      if (Number.isFinite(total)) return total >= dc;
    }
  } catch (error) {
    console.warn(`${PREFIX} | Save roll failed, rolling silently`, error);
  }
  const bonus = Number(actor.system?.abilities?.[ability]?.save ?? actor.system?.abilities?.[ability]?.mod) || 0;
  const roll = await new Roll(`1d20 + ${bonus}`).evaluate();
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `Спасбросок (${ability.toUpperCase()}, DC ${dc})`
  });
  return roll.total >= dc;
}

async function rollUncappedSave(actor, ability, dc) {
  const data = actor.getRollData?.() ?? {};
  const abl = data.abilities?.[ability] ?? {};
  const save = Number(abl.save);
  const mod = Number.isFinite(save) ? save : Number(abl.mod) || 0;
  const extra = actor.system?.bonuses?.abilities?.save;
  const formula = extra && String(extra).trim() && String(extra) !== "0"
    ? `1d20 + ${mod} + (${extra})`
    : `1d20 + ${mod}`;
  const D20Roll = CONFIG.Dice.D20Roll ?? globalThis.D20Roll;
  const options = {
    flavor: `Спасбросок Силы (DC ${dc})`,
    type: "save",
    ability,
    maximum: undefined,
    minimum: undefined
  };
  const roll = D20Roll
    ? await new D20Roll(formula, data, options).evaluate()
    : await new Roll(formula, data).evaluate();
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `Выбраться из глыбы — спасбросок Силы (DC ${dc})`
  });
  return Number(roll.total) >= dc;
}

async function suppressPrisonSaveCap(actor) {
  const prison = actor.effects.filter((effect) => effect.flags?.[MODULE_ID]?.soulFlame?.prison && !effect.disabled);
  const origins = new Set(prison.map((effect) => effect.uuid));
  const extra = actor.effects.filter((effect) => {
    if (effect.disabled || effect.flags?.[MODULE_ID]?.soulFlame?.prison) return false;
    return Boolean(effect.origin && origins.has(effect.origin));
  });
  const ids = [...prison, ...extra].map((effect) => effect.id);
  if (ids.length) {
    await mutateActor(actor, "updateEmbeddedDocuments", "ActiveEffect", ids.map((id) => ({ _id: id, disabled: true })));
  }
  return ids;
}

async function restoreSuppressedEffects(actor, ids) {
  const existing = (ids ?? []).filter((id) => actor.effects.get(id));
  if (!existing.length) return;
  await mutateActor(actor, "updateEmbeddedDocuments", "ActiveEffect", existing.map((id) => ({ _id: id, disabled: false })));
}

async function restoreSnapshot(actor, snapshot) {
  if (!actor || !snapshot) return;
  await updateActorDocument(actor, {
    "system.attributes.hp.value": snapshot.hp,
    "system.attributes.hp.temp": snapshot.temp
  });
}

function isBowAttack(workflow) {
  const item = workflow?.item;
  if (!item || item.type !== "weapon") return false;
  const attackValue = workflow.activity?.attack?.type?.value ?? item.system?.actionType;
  if (attackValue !== "ranged" && attackValue !== "rwak") return false;
  return isBowItem(item);
}

function isBowItem(item) {
  const base = String(item.system?.type?.baseItem ?? "").toLowerCase();
  if (base === "shortbow" || base === "longbow") return true;
  if (base.includes("crossbow") || base.includes("firearm")) return false;
  const hay = `${item.identifier ?? ""} ${item.name ?? ""} ${base}`.toLowerCase();
  if (hay.includes("crossbow") || hay.includes("арбалет")) return false;
  return hay.includes("bow") || hay.includes("лук");
}

function hasBowEquipped(actor) {
  return actor.items.some((item) => item.type === "weapon" && item.system?.equipped && isBowItem(item));
}

function blazeDamageOptions(isCritical) {
  return damageRollOptions("fire", {
    isCritical,
    appearance: { colorset: "fire" }
  });
}

function damageRollOptions(type, { isCritical = false, appearance } = {}) {
  const options = {
    type,
    isCritical: Boolean(isCritical),
    critical: {
      multiplier: 2,
      multiplyNumeric: false,
      bonusDice: 0
    }
  };
  if (appearance) options.appearance = appearance;
  return options;
}

function workflowIsCritical(workflow) {
  return Boolean(
    workflow?.isCritical
    || workflow?.attackRoll?.isCritical
    || workflow?.damageRolls?.[0]?.options?.isCritical === true
  );
}

function getScale(actor) {
  const level = warlockLevel(actor);
  const tier = level >= 15 ? 2 : level >= 8 ? 1 : 0;
  const lengthIndex = level >= 20 ? 3 : level >= 15 ? 2 : level >= 8 ? 1 : 0;
  return {
    level,
    die: SCALE_DICE[tier],
    serpentDie: SERPENT_DICE[tier],
    width: LINE_WIDTH[tier],
    length: LINE_LENGTH[lengthIndex],
    prisonDc: PRISON_DC[tier],
    prof: Number(actor.system?.attributes?.prof) || 1
  };
}

function warlockLevel(actor) {
  if (!actor) return 0;
  const fromClass = classLevels(actor.classes?.warlock)
    || classLevels(actor.classes?.get?.("warlock"));
  if (fromClass) return fromClass;

  const classes = actor.itemTypes?.class ?? actor.items?.filter?.((item) => item.type === "class") ?? [];
  const warlock = classes.find((item) => {
    const id = String(item.identifier ?? item.system?.identifier ?? "").toLowerCase();
    const name = String(item.name ?? "").toLowerCase();
    return id === "warlock" || name.includes("warlock") || name.includes("колдун");
  });
  const fromItem = classLevels(warlock);
  if (fromItem) return fromItem;

  if (findItem(actor, SOUL_FLAME_MAIN_ID)) return Number(actor.system?.details?.level) || 0;
  return 0;
}

function classLevels(cls) {
  return Number(cls?.levels ?? cls?.system?.levels) || 0;
}

function spellDc(actor) {
  const prof = Number(actor.system?.attributes?.prof) || 2;
  const ability = actor.classes?.warlock?.system?.spellcasting?.ability
    ?? actor.classes?.warlock?.spellcasting?.ability
    ?? "cha";
  const mod = Number(actor.system?.abilities?.[ability]?.mod) || 0;
  const bonus = spellDcBonus(actor);
  const pact = 8 + prof + mod + bonus;
  const stored = Number(
    actor.system?.attributes?.spell?.dc
    ?? actor.system?.attributes?.spelldc
    ?? actor.getRollData?.()?.attributes?.spell?.dc
  );
  if (Number.isFinite(stored) && stored >= pact) return stored;
  return pact;
}

function spellDcBonus(actor) {
  const raw = actor.system?.bonuses?.spell?.dc;
  const n = Number(raw);
  if (Number.isFinite(n)) return n;
  if (!raw) return 0;
  try {
    const roll = new Roll(String(raw), actor.getRollData?.() ?? {});
    return Number(roll.evaluateSync?.({ strict: false })?.total) || 0;
  } catch {
    return 0;
  }
}

function remainingUses(item) {
  const uses = item?.system?.uses ?? {};
  const value = uses.value;
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  const spent = Number(uses.spent) || 0;
  const max = Number(uses.max);
  if (Number.isFinite(max)) return Math.max(0, max - spent);
  try {
    const data = item.getRollData?.() ?? item.actor?.getRollData?.() ?? {};
    const roll = new Roll(String(uses.max || "0"), data);
    const evaluated = roll.evaluateSync?.({ strict: false });
    const total = Number(evaluated?.total);
    if (Number.isFinite(total)) return Math.max(0, total - spent);
  } catch {
    // ignore formula errors
  }
  return 0;
}

async function spendUses(item, amount) {
  const spent = Number(item.system?.uses?.spent) || 0;
  await item.update({ "system.uses.spent": spent + amount });
}

function findItem(actor, identifier) {
  return actor?.items.find((item) => isItem(item, identifier)) ?? null;
}

function wasPrisonUsed(source, target) {
  const used = source.getFlag(MODULE_ID, "soulFlame.prisonUsed") ?? [];
  return Array.isArray(used) && used.includes(target?.uuid);
}

async function markPrisonUsed(source, target) {
  const used = [...(source.getFlag(MODULE_ID, "soulFlame.prisonUsed") ?? [])];
  if (target?.uuid && !used.includes(target.uuid)) used.push(target.uuid);
  await source.setFlag(MODULE_ID, "soulFlame.prisonUsed", used);
}

function tokensWithin(originToken, range, exclude = []) {
  const origin = originToken?.center ?? originToken;
  const excludeIds = new Set(exclude.map((token) => token?.id).filter(Boolean));
  return canvas.tokens.placeables.filter((token) => {
    if (!token.actor || excludeIds.has(token.id) || token.id === originToken?.id) return false;
    return distanceFeet(origin, token.center) <= range + tokenRadiusFeet(token);
  });
}

function normalizeTokens(setLike) {
  if (!setLike) return [];
  const arr = Array.isArray(setLike) ? setLike : Array.from(setLike);
  return arr.map((entry) => {
    if (entry?.center && entry.actor) return entry;
    if (entry?.object?.center) return entry.object;
    return canvas.tokens.get(entry?.id ?? entry) ?? entry;
  }).filter((token) => token?.actor);
}

function attackerToken(actor) {
  return actor.getActiveTokens?.()?.[0]
    ?? canvas.tokens?.placeables.find((token) => token.actor === actor)
    ?? null;
}

function activityId(activity) {
  return activity?.id ?? activity?._id ?? "";
}

function isPrimaryHandler(actor) {
  const owners = game.users.filter((user) => user.active && !user.isGM && actor.testUserPermission(user, "OWNER"));
  if (owners.length) return owners[0].id === game.user.id;
  return game.user.isGM;
}
