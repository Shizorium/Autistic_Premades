import {
  MODULE_ID,
  FROM_THE_ASHES_ID,
  FROM_THE_ASHES_ECHO_ID,
  isItem
} from "../lib/identifier.js";

const handledUses = new Set();

const SIDE_EFFECTS = [
  {
    id: "bright",
    name: "Яркое",
    description: "Уровень ячейки заклинания вырастает на 1, если применимо."
  },
  {
    id: "dim",
    name: "Тусклое",
    description: "Призывает абсолютную тьму в области 20 фт. до конца твоего следующего хода. Существа, находящиеся в ней, должны пройти спас Мудрости по сложности 25 или получить состояние Напуганный до того, как тьма не развеется."
  },
  {
    id: "reflection",
    name: "Отражение",
    description: "Выбери ещё одну цель или повтори эффект. Нельзя использовать на одной и той же цели. Половина урона у второго заклинания. Концентрироваться нужно на обоих отдельно."
  },
  {
    id: "glitch",
    name: "Глитч",
    description: "После использования заклинания выбери место в 45 фт., в которое ты телепортируешься. На месте, где было использовано заклинание, возникает шрам в Бытие (твоего размера), который длится одну минуту. Любой, кто пройдёт сквозь этот шрам, получает урон без типа, равный 10 за уровень ячейки заклинания."
  },
  {
    id: "familiar",
    name: "Знакомое",
    description: "Всех на поле боя или в радиусе 300 фт. в нарративе одолевает странное воспоминание, давая помеху на броски d20 до конца их следующего хода."
  },
  {
    id: "forgotten",
    name: "Забытое",
    description: "Выбранное существо захлёстывает наплыв старых воспоминаний. Оно делает спасбросок Мудрости по сложности 18 и при провале становится недееспособным, после чего выучит случайный язык, навык или пласт важной информации (не больше раза за одного персонажа). Существо не сможет объяснить, откуда у него эти познания."
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
  }
];

export function registerFromTheAshes() {
  Hooks.on("dnd5e.postUseActivity", onPostUseActivity);
  Hooks.on("midi-qol.RollComplete", onMidiRollComplete);
  Hooks.on("dnd5e.restCompleted", onRestCompleted);
}

function onPostUseActivity(activity) {
  handleUsedItem(activity?.item ?? activity);
}

function onMidiRollComplete(workflow) {
  handleUsedItem(workflow?.item);
}

function handleUsedItem(item) {
  if (!item) return;
  if (isItem(item, FROM_THE_ASHES_ID)) {
    if (!markHandled(`feat:${item.uuid}:${item.system?.uses?.spent ?? 0}`)) return;
    void openSpellPicker(item);
    return;
  }
  if (isItem(item, FROM_THE_ASHES_ECHO_ID)) {
    if (!markHandled(`echo:${item.uuid}`)) return;
    void onEchoCast(item);
  }
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
  const actor = item.actor;
  if (!actor) return;
  const spellName = item.name;
  const actorName = actor.name;
  const itemId = item.id;
  await mutateActor(actor, "deleteEmbeddedDocuments", "Item", [itemId]);
  await requestSideEffectPrompt({ spellName, actorName });
}

async function requestSideEffectPrompt(payload) {
  if (game.user.isGM) {
    return promptFromTheAshesSideEffect(payload);
  }
  const socket = globalThis.autisticPremades?.socket;
  if (socket) return socket.executeAsGM("promptFromTheAshesSideEffect", payload);
  ui.notifications.warn("Из Праха | Нет ГМа для выбора побочного эффекта.");
}

export async function promptFromTheAshesSideEffect({ spellName = "", actorName = "" } = {}) {
  if (!game.user.isGM) return;

  let chosen;
  try {
    chosen = await foundry.applications.api.DialogV2.wait({
      window: { title: "Из Праха — побочный эффект" },
      position: { width: 420 },
      content: `<p><strong>${escapeHtml(actorName)}</strong> применяет <strong>${escapeHtml(spellName)}</strong>.</p>`,
      buttons: SIDE_EFFECTS.map((entry) => ({
        action: entry.id,
        label: entry.name,
        callback: () => entry
      })),
      rejectClose: false
    });
  } catch {
    return;
  }

  const effect = typeof chosen === "object" && chosen?.name
    ? chosen
    : SIDE_EFFECTS.find((entry) => entry.id === chosen);
  if (!effect) return;

  await ChatMessage.create({
    speaker: { alias: actorName },
    content: `<div class="ap-from-the-ashes-effect"><h3>${escapeHtml(effect.name)}</h3><p>${escapeHtml(effect.description)}</p></div>`
  });
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
