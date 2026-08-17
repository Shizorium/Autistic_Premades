import {
  MODULE_ID,
  LIVING_ALTAR_ID,
  LIVING_ALTAR_REMINDER_SETTING,
  isItem
} from "../lib/identifier.js";

const REMINDER_INTERVAL_MS = 3_600_000;

let reminderTimer = null;
let reminderOpen = false;

export function startLivingAltarReminder() {
  stopLivingAltarReminder();
  if (!game.settings.get(MODULE_ID, LIVING_ALTAR_REMINDER_SETTING)) return;
  showLivingAltarReminder();
  reminderTimer = setInterval(showLivingAltarReminder, REMINDER_INTERVAL_MS);
}

export function stopLivingAltarReminder() {
  if (reminderTimer) {
    clearInterval(reminderTimer);
    reminderTimer = null;
  }
}

async function showLivingAltarReminder() {
  if (!game.settings.get(MODULE_ID, LIVING_ALTAR_REMINDER_SETTING)) return;
  if (reminderOpen) return;

  const item = findLivingAltarItem();
  if (!item) return;

  const description = item.system?.description?.value || "<p></p>";
  reminderOpen = true;
  try {
    await foundry.applications.api.DialogV2.prompt({
      window: { title: item.name },
      content: `<div class="autistic-premades-reminder">${description}</div>`,
      ok: {
        label: "Да, помню"
      }
    });
  } catch {
    // Dialog closed without confirming.
  } finally {
    reminderOpen = false;
  }
}

function findLivingAltarItem() {
  const assigned = game.user.character;
  if (assigned) {
    const item = assigned.items.find((entry) => isItem(entry, LIVING_ALTAR_ID));
    if (item) return item;
  }
  if (game.user.isGM) return null;
  for (const actor of game.actors) {
    if (!actor.isOwner) continue;
    const item = actor.items.find((entry) => isItem(entry, LIVING_ALTAR_ID));
    if (item) return item;
  }
  return null;
}
