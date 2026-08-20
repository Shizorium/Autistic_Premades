export const MODULE_ID = "Autistic_Premades";
export const BASTION_OF_AMENDS_ID = "bastion-of-amends";
export const LIVING_ALTAR_ID = "living-altar-of-stubbornness";
export const LIVING_ALTAR_REMINDER_SETTING = "livingAltarReminderEnabled";
export const FROM_THE_ASHES_ID = "from-the-ashes";
export const FROM_THE_ASHES_ECHO_ID = "from-the-ashes-echo";
export const DAMAGE_TO_ONE_ID = "damage-to-one";
export const INNER_FADE_ID = "inner-fade";
export const SANDEVISTAN_ID = "sandevistan";
export const SANDEVISTAN_NAME = "??????я? ????л ?о? ?????и";
export const LEGENDARY_RESISTANCE_ID = "legendary-resistance";
export const FADE_ONSLAUGHT_ID = "fade-onslaught";
export const FADE_SERUMS_ID = "fade-serums";
export const FADE_SERUM_FIRE_ID = "fade-serum-fire";
export const FADE_SERUM_BLOOD_ID = "fade-serum-blood";
export const FADE_SERUM_TEARS_ID = "fade-serum-tears";
export const FADE_SERUM_HEAL_ID = "fade-serum-heal";

export function getItemIdentifier(item) {
  return item?.flags?.[MODULE_ID]?.identifier || item?.system?.identifier || "";
}

export function isItem(item, identifier) {
  return getItemIdentifier(item) === identifier;
}
