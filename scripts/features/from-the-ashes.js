import {
  MODULE_ID,
  FROM_THE_ASHES_ID,
  FROM_THE_ASHES_ECHO_ID,
  FROM_THE_ASHES_DEATH_STATUS_ID,
  FROM_THE_ASHES_DEATH_ICON,
  isItem
} from "../lib/identifier.js";
import { runFromTheAshesAutomation } from "./from-the-ashes-automations.js";

const handledUses = new Set();
const pendingCast = new Map();

const SIDE_EFFECTS = [
  {
    id: "bright",
    name: "Яркое",
    description: "Уровень ячейки заклинания вырастает на 1, если применимо."
  },
  {
    id: "dim",
    name: "Тусклое",
    description: "Призывает Мрак в области 20 фт. Вы не выбираете область, но возвращаете себе спеллпоинты за сотворение."
  },
  {
    id: "reflection",
    name: "Отражение",
    description: "Выбери ещё одну цель или повтори эффект. Нельзя использовать на одной и той же цели. Половина урона у второго заклинания. Концентрироваться нужно на обоих отдельно."
  },
  {
    id: "distortion",
    name: "Искажение",
    description: "После использования заклинания выбери место в 45 фт., в которое ты телепортируешься. На месте, где было использовано заклинание, возникает искажение в Бытие (твоего размера), которое длится одну минуту. Любой, кто пройдёт сквозь этот шрам, получает урон без типа, равный 10 за уровень ячейки заклинания. Попытка разглядеть, что находится за шрамом, вызовет ???."
  },
  {
    id: "familiar",
    name: "Знакомое",
    description: "Всех на поле боя или в радиусе 300 фт. в нарративе одолевает странное воспоминание, давая помеху на броски d20 до конца их следующего хода. Ваша группа получает 2 Tenacity."
  },
  {
    id: "forgotten",
    name: "Забытое",
    description: "Выбранное существо захлёстывает наплыв старых воспоминаний. Оно делает спасбросок Мудрости по сложности 18 и при провале становится недееспособным до конца своего следующего хода, после чего оно выучит случайный язык, навык или пласт важной информации (не больше раза за одного персонажа). Существо не сможет объяснить, откуда у него эти познания."
  },
  {
    id: "progress",
    name: "Прогресс",
    description: "Выбранное тобой снаряжение или структура преобразуется до неузнаваемости, получая складывающийся бонус +1 до конца боя (с 3 ячейки заклинания +2, и ещё +1 за каждые два уровня) или, в нарративе, приобретает неожиданные свойства на время, которое определит ДМ. Принцип работы или выделки объекта, который улучшил Прогресс, непостижим для разума и не может быть повторён никаким образом."
  },
  {
    id: "collapse",
    name: "Коллапс",
    description: "В точке, которая будет эпицентром области, определяемой мастером, обрушиваются обугленные обломки, которые могут быть частями чего угодно, нанося дробящий урон, равный 1д8+1д8 за уровень ячейки. Обломки дотлеют через час и станут прахом."
  },
  {
    id: "stability",
    name: "Стабильность",
    description: "Если у эффекта есть длительность, то она увеличивается вдвое."
  },
  {
    id: "cascade",
    name: "Каскад",
    description: "Форма или дальность заклинания удваивается."
  },
  {
    id: "earthly",
    name: "Земное",
    description: "Если заклинание наносит урон, то его тип меняется на Огненный. Цель получает дополнительные 1d6+d6 за уровень ячейки. Если это заклинание атакующее по области, то урон получает только одна цель. Если эффект повторяется, то урон наносится только в первый раз. Любая убитая цель обратится прахом. Если заклинание не наносит урон — выбери область 20 фт. в зоне видимости, которую поглотит пожар, который уничтожит в ней все мирские объекты в течение минуты. Бывают исключения."
  },
  {
    id: "celestial",
    name: "Небесное",
    description: "В бою область 20 фт. заливает концентрированный свет Уробороса. Днём все цели в области должны преуспеть в спасброске Выносливости по сложности 20 или будут Ослеплены до конца твоего следующего хода, и независимо от спасброска получат лучистый урон, равный 5 + 5 за уровень ячейки. Ночью цели вместо этого будут заморожены, снижая их скорость до 0 и вместо этого нанося такой же урон, но холодом. В нарративе позволяет в области мили временно сменить активное светило, сменив день ночью и наоборот."
  },
  {
    id: "olpet",
    name: "олпеТ",
    description: "Ваше Духовное Пламя разгорается чуть ярче. Восстановите 5 спеллпоинтов и увеличьте максимум на такую же величину до конца долгого отдыха. Во рту появляется привкус железа. Складывается, если сработало несколько раз, но после первого вы должны делать спасбросок Выносливости по 18 сложности. При провале у вас начнётся рвота и вы получите состояние Отравленный до конца вашего следующего хода. (Буду бить дубинкой, если забудешь понизить максимум обратно)"
  },
  {
    id: "ondoloh",
    name: "ондолоХ",
    description: "БЕЖАТЬ. БЕЖАТЬ. БЕЖ-… До конца хода ваша скорость увеличивается на 90 фт. Любая цель, рядом с которой вы пронесётесь, получит урон Молнией, равный вашему уровню волшебника (существо не может получить этот урон больше раза в раунд). Атаки по возможности по вам могут совершить только те, у кого пассивное Восприятие 20+ или есть черта страж. Если вы не двинетесь дальше, чем на 90 фт. от места, где находились, то автоматически получите состояние Мрак в глазах, Мрак в душе с отправной точкой прямо за вашей спиной."
  },
  {
    id: "collision",
    name: "Столкновение",
    description: "Активирует способность 5-го уровня подкласса (только когда она у вас появится). За исключением того, что она длится до конца вашего хода, а вам возвращается ваше действие, если оно было потрачено. Не считается в лимит использований и не вызывает Истощение."
  },
  {
    id: "overlay",
    name: "Наслоение",
    description: "В вашем владении оказывается искажённая сыворотка или бомба (её выдаст ДМ). Если она не будет использована в течение минуты, то превратится в прах. Воспроизвести её невозможно."
  },
  {
    id: "life",
    name: "Жизнь",
    description: "Призывает 20 фт. область чудной растительности, которая затрудняет передвижение. Существа в этой области восстанавливают 5+5 за уровень ячейки ПЗ, когда начинают в ней свой ход. Если область не будет уничтожена в течение боя — с неё можно собрать 50 Травяного Эквивалента. Если призвано в нарративе — не восстановит ПЗ, но прокинь 1d2. При 1 — вырастет невероятно красивый цветок, который можно превратить в 1 эссенцию чудес, либо он станет прекрасным подарком кому угодно (разные цветы, которые понравятся разным личностям). При 2 — взойдёт кувшинка, в которой плещется 1 Орборий Виты."
  },
  {
    id: "death",
    name: "Смерть",
    description: "В бою холодное дыхание Жницы обдаёт тех, кому не суждено пережить сегодняшний день. На поле боя будут отмечены существа, смерть которых вам необходимо ускорить. Если все из них погибнут, из одного из тел прорастёт мёртвый цветок, который хранит 1 Орборий Мортифьёр. В нарративе … ?"
  },
  {
    id: "zenith",
    name: "Зенит",
    description: "???"
  },
  {
    id: "eclipse",
    name: "Затмение",
    description: "За эхом уцепилось что-то ещё. Мрак захлёстывает поле боя. До конца боя все игроки получают опцию Рыдать в качестве бесплатного действия. …??? ??????????? ????? ????????????????????????"
  }
];

export function registerFromTheAshes() {
  registerDeathStatus();
  Hooks.on("dnd5e.postUseActivity", onPostUseActivity);
  Hooks.on("midi-qol.RollComplete", onMidiRollComplete);
  Hooks.on("dnd5e.restCompleted", onRestCompleted);
}

export function registerDeathStatus() {
  CONFIG.statusEffects ??= [];
  if (CONFIG.statusEffects.some((entry) => entry.id === FROM_THE_ASHES_DEATH_STATUS_ID)) return;
  CONFIG.statusEffects.push({
    id: FROM_THE_ASHES_DEATH_STATUS_ID,
    name: "Смерть",
    label: "Смерть",
    img: FROM_THE_ASHES_DEATH_ICON,
    icon: FROM_THE_ASHES_DEATH_ICON,
    overlay: true
  });
}

function onPostUseActivity(activity, usage) {
  handleUsedItem(activity?.item ?? activity, {
    slotLevel: getSlotLevelFromUsage(activity, usage)
  });
}

function onMidiRollComplete(workflow) {
  handleUsedItem(workflow?.item, {
    slotLevel: Number(workflow?.castData?.castLevel ?? workflow?.itemLevel ?? workflow?.spellLevel) || undefined,
    token: workflow?.token
  });
}

function handleUsedItem(item, extra = {}) {
  if (!item) return;
  if (isItem(item, FROM_THE_ASHES_ID)) {
    if (!markHandled(`feat:${item.uuid}:${item.system?.uses?.spent ?? 0}`)) return;
    void openSpellPicker(item);
    return;
  }
  if (isItem(item, FROM_THE_ASHES_ECHO_ID)) {
    rememberCast(item, extra);
    if (!markHandled(`echo:${item.uuid}`)) return;
    void onEchoCast(item);
  }
}

function rememberCast(item, extra = {}) {
  const prev = pendingCast.get(item.uuid) ?? {};
  const merged = { ...prev };
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) merged[key] = value;
  }
  pendingCast.set(item.uuid, merged);
  setTimeout(() => pendingCast.delete(item.uuid), 8000);
}

function markHandled(key) {
  if (handledUses.has(key)) return false;
  handledUses.add(key);
  setTimeout(() => handledUses.delete(key), 8000);
  return true;
}

async function openSpellPicker(item) {
  const actor = item.actor;
  if (!actor) return;

  const maxLevel = getMaxSlotLevel(actor);
  if (maxLevel <= 0) {
    ui.notifications.warn("Из Праха | Нет доступных ячеек заклинаний.");
    await refundFeatUse(item);
    return;
  }

  const selectedUuid = await showSpellDialog(maxLevel);
  if (!selectedUuid) {
    await refundFeatUse(item);
    return;
  }

  try {
    await createEchoSpell(actor, selectedUuid);
  } catch (error) {
    console.error("Из Праха | Failed to create echo spell", error);
    ui.notifications.error("Из Праха | Не удалось добавить заклинание.");
    await refundFeatUse(item);
  }
}

async function showSpellDialog(maxLevel) {
  const CompendiumBrowser = dnd5e.applications.CompendiumBrowser;
  if (!CompendiumBrowser?.selectOne) {
    ui.notifications.error("Из Праха | Compendium Browser недоступен.");
    return null;
  }

  try {
    return await CompendiumBrowser.selectOne({
      filters: {
        locked: {
          documentClass: "Item",
          types: new Set(["spell"]),
          additional: { level: { max: maxLevel } }
        }
      },
      tab: "spells"
    });
  } catch (error) {
    console.error("Из Праха | Failed to open Compendium Browser", error);
    return null;
  }
}

async function createEchoSpell(actor, uuid) {
  const source = await fromUuid(uuid);
  if (!source || source.type !== "spell") {
    throw new Error("Selected document is not a spell");
  }

  const data = source.toObject();
  delete data._id;
  delete data._key;
  delete data._stats;
  data.folder = null;
  data.sort = 0;
  data.name = `${source.name} (Из Праха)`;
  data.system ??= {};
  data.system.uses = {
    spent: 0,
    max: "1",
    recovery: []
  };
  if (data.system.preparation && typeof data.system.preparation === "object") {
    data.system.preparation.mode = "always";
    data.system.preparation.prepared = true;
  }
  if ("method" in data.system) data.system.method = "spell";
  if ("prepared" in data.system) {
    data.system.prepared = typeof data.system.prepared === "number" ? 1 : true;
  }

  for (const activity of Object.values(data.system.activities ?? {})) {
    activity.consumption ??= {};
    activity.consumption.spellSlot = true;
    activity.consumption.targets ??= [];
    if (!activity.consumption.targets.some((target) => target.type === "itemUses")) {
      activity.consumption.targets.push({
        type: "itemUses",
        target: "",
        value: "1",
        scaling: { mode: "", formula: "" }
      });
    }
  }

  data.flags ??= {};
  data.flags[MODULE_ID] = {
    identifier: FROM_THE_ASHES_ECHO_ID,
    fromTheAshes: true,
    sourceSpellUuid: source.uuid
  };

  await mutateActor(actor, "createEmbeddedDocuments", "Item", [data]);
  ui.notifications.info(`Из Праха | Запомнено: ${source.name}`);
}

async function onEchoCast(item) {
  await new Promise((resolve) => setTimeout(resolve, 75));
  const extra = pendingCast.get(item.uuid) ?? {};
  pendingCast.delete(item.uuid);

  const actor = item.actor;
  if (!actor) return;
  const payload = buildCastPayload(item, actor, extra);
  await preserveConcentration(actor, item);
  await mutateActor(actor, "deleteEmbeddedDocuments", "Item", [item.id]);
  await requestSideEffectPrompt(payload);
}

function buildCastPayload(item, actor, extra = {}) {
  const token = getCastToken(actor, extra.token);
  const tokenDoc = token?.document ?? token;
  return {
    spellName: item.name,
    actorName: actor.name,
    actorUuid: actor.uuid,
    tokenUuid: tokenDoc?.uuid ?? null,
    sceneUuid: tokenDoc?.parent?.uuid ?? canvas.scene?.uuid ?? null,
    origin: tokenOrigin(token) ?? extra.origin ?? null,
    slotLevel: Number(extra.slotLevel) || Number(item.system?.level) || 1,
    casterUserId: game.user.id
  };
}

function tokenOrigin(token) {
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

function getCastToken(actor, hint) {
  if (hint?.center) return hint;
  if (hint?.object?.center) return hint.object;
  if (hint?.document) return hint;
  return actor?.getActiveTokens()?.[0]
    ?? canvas.tokens?.controlled?.find((token) => token.actor === actor)
    ?? null;
}

function getSlotLevelFromUsage(activity, usage) {
  const item = activity?.item;
  const base = Number(item?.system?.level) || 0;
  const scaling = Number(usage?.scaling) || 0;
  const slot = Number(
    usage?.spell?.slot
    ?? usage?.consumed?.spell
    ?? usage?.castLevel
  ) || 0;
  return slot || (base + scaling) || base || undefined;
}

async function preserveConcentration(actor, item) {
  await waitForConcentration(actor, item);
  const effects = getConcentrationEffects(actor, item);
  if (!effects.length) return;

  const snapshot = item.toObject();
  delete snapshot._id;
  await mutateActor(actor, "updateEmbeddedDocuments", "ActiveEffect", effects.map((effect) => ({
    _id: effect.id,
    origin: actor.uuid,
    "flags.dnd5e.item.id": "",
    "flags.dnd5e.item.uuid": "",
    "flags.dnd5e.item.data": snapshot
  })));
}

function getConcentrationEffects(actor, item) {
  const concentrating = CONFIG.specialStatusEffects?.CONCENTRATING;
  const effects = [];
  for (const effect of actor.effects) {
    const concentratingOn = concentrating
      ? effect.statuses?.has(concentrating)
      : false;
    if (!concentratingOn && !actor.concentration?.effects?.has(effect)) continue;
    const data = effect.flags?.dnd5e?.item ?? {};
    if (data.id === item.id || data.uuid === item.uuid || data.data?._id === item.id) {
      effects.push(effect);
    }
  }
  return effects;
}

function requiresConcentration(item) {
  if (item.system?.properties?.has?.("concentration")) return true;
  return Object.values(item.system?.activities ?? {}).some((activity) => activity.duration?.concentration);
}

async function waitForConcentration(actor, item) {
  if (!requiresConcentration(item)) return;
  for (let attempt = 0; attempt < 20; attempt++) {
    if (getConcentrationEffects(actor, item).length) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function requestSideEffectPrompt(payload) {
  if (game.user.isGM) {
    return promptFromTheAshesSideEffect(payload);
  }
  const socket = globalThis.autisticPremades?.socket;
  if (socket) return socket.executeAsGM("promptFromTheAshesSideEffect", payload);
  ui.notifications.warn("Из Праха | Нет ГМа для выбора побочного эффекта.");
}

export async function promptFromTheAshesSideEffect(payload = {}) {
  if (!game.user.isGM) return;
  const { spellName = "", actorName = "" } = payload;
  const stamp = foundry.utils.randomID?.(8) ?? `${Date.now()}`;
  const detachTooltips = attachSideEffectTooltips(stamp);

  let chosen;
  try {
    chosen = await foundry.applications.api.DialogV2.wait({
      window: { title: "Из Праха — побочный эффект" },
      position: { width: 520 },
      content: `<p data-ap-ashes="${stamp}"><strong>${escapeHtml(actorName)}</strong> применяет <strong>${escapeHtml(spellName)}</strong>.</p>`,
      buttons: SIDE_EFFECTS.map((entry) => ({
        action: entry.id,
        label: entry.name,
        callback: () => entry
      })),
      rejectClose: false,
      render: (_event, dialog) => bindSideEffectTooltips(dialog?.element ?? dialog, stamp)
    });
  } catch {
    return;
  } finally {
    detachTooltips();
  }

  const effect = typeof chosen === "object" && chosen?.name
    ? chosen
    : SIDE_EFFECTS.find((entry) => entry.id === chosen);
  if (!effect) return;

  await ChatMessage.create({
    speaker: { alias: actorName },
    content: `<div class="ap-from-the-ashes-effect"><h3>${escapeHtml(effect.name)}</h3><p>${escapeHtml(effect.description)}</p></div>`
  });

  await runFromTheAshesAutomation(effect.id, payload);
}

function attachSideEffectTooltips(stamp) {
  const bind = (app, element) => {
    const root = element instanceof HTMLElement ? element : app?.element;
    bindSideEffectTooltips(root, stamp);
  };
  const hookA = Hooks.on("renderDialogV2", bind);
  const hookB = Hooks.on("renderApplicationV2", bind);
  return () => {
    Hooks.off("renderDialogV2", hookA);
    Hooks.off("renderApplicationV2", hookB);
  };
}

function bindSideEffectTooltips(root, stamp) {
  if (!root?.querySelector?.(`[data-ap-ashes="${stamp}"]`)) return;
  for (const button of root.querySelectorAll("button[data-action]")) {
    const effect = SIDE_EFFECTS.find((entry) => entry.id === button.dataset.action);
    if (!effect) continue;
    button.dataset.tooltip = effect.description;
  }
}

function onRestCompleted(actor, result, config) {
  if (!actor || !isLongRest(result, config)) return;
  if (!actor.isOwner) return;
  const ids = actor.items.filter((item) => isItem(item, FROM_THE_ASHES_ECHO_ID)).map((item) => item.id);
  if (!ids.length) return;
  void mutateActor(actor, "deleteEmbeddedDocuments", "Item", ids).catch((error) => {
    console.warn("Из Праха | Failed to clear echo spells on rest", error);
  });
}

function isLongRest(result, config) {
  return Boolean(
    result?.longRest
    || result?.type === "long"
    || config?.type === "long"
    || config?.restType === "long"
  );
}

function getMaxSlotLevel(actor) {
  let max = 0;
  const slots = actor.system?.spells ?? {};
  for (let level = 1; level <= 9; level++) {
    const slot = slots[`spell${level}`];
    if ((Number(slot?.max) || 0) > 0 || (Number(slot?.value) || 0) > 0) max = level;
  }
  const pact = slots.pact;
  const pactLevel = Number(pact?.level) || 0;
  if (pactLevel && ((Number(pact?.max) || 0) > 0 || (Number(pact?.value) || 0) > 0)) {
    max = Math.max(max, pactLevel);
  }
  return max;
}

async function refundFeatUse(item) {
  const spent = Number(item.system?.uses?.spent ?? 0);
  if (spent <= 0) return;
  try {
    await item.update({ "system.uses.spent": spent - 1 });
  } catch (error) {
    console.warn("Из Праха | Failed to refund use", error);
  }
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
