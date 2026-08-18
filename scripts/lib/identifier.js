export const MODULE_ID = "Autistic_Premades";
export const BASTION_OF_AMENDS_ID = "bastion-of-amends";
export const LIVING_ALTAR_ID = "living-altar-of-stubbornness";
export const LIVING_ALTAR_REMINDER_SETTING = "livingAltarReminderEnabled";
export const FROM_THE_ASHES_ID = "from-the-ashes";
export const FROM_THE_ASHES_ECHO_ID = "from-the-ashes-echo";
export const DAMAGE_TO_ONE_ID = "damage-to-one";

export function getItemIdentifier(item) {
  return item?.flags?.[MODULE_ID]?.identifier || item?.system?.identifier || "";
}

export function isItem(item, identifier) {
  return getItemIdentifier(item) === identifier;
}
