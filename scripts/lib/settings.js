import { MODULE_ID, LIVING_ALTAR_REMINDER_SETTING } from "./identifier.js";
import { startLivingAltarReminder, stopLivingAltarReminder } from "../features/living-altar-of-stubbornness.js";

export function registerSettings() {
  game.settings.register(MODULE_ID, LIVING_ALTAR_REMINDER_SETTING, {
    name: "Напоминалка: Живой Алтарь Упрямства",
    hint: "Показывать игроку с этой особенностью диалог-напоминание. Меняется сразу, без перезагрузки мира.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: (enabled) => {
      if (enabled) startLivingAltarReminder();
      else stopLivingAltarReminder();
    }
  });
}
