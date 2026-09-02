export const MODULE_ID = "Autistic_Premades";
export const BASTION_OF_AMENDS_ID = "bastion-of-amends";
export const LIVING_ALTAR_ID = "living-altar-of-stubbornness";
export const LIVING_ALTAR_REMINDER_SETTING = "livingAltarReminderEnabled";
export const FROM_THE_ASHES_ID = "from-the-ashes";
export const FROM_THE_ASHES_ECHO_ID = "from-the-ashes-echo";
export const FROM_THE_ASHES_ONDOLOH_ID = "from-the-ashes-ondoloh";
export const FROM_THE_ASHES_DEATH_STATUS_ID = "ap-ashes-death";
export const FROM_THE_ASHES_DEATH_ICON = "icons/magic/death/skull-horned-worn-white.webp";
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
export const SOUL_FLAME_SUBCLASS_ID = "soul-flame";
export const SOUL_FLAME_MAIN_ID = "we-both-flame-and-light";
export const SOUL_FLAME_BLAZE_ID = "you-the-heartfelt-blaze";
export const SOUL_FLAME_CRYSTAL_ID = "i-the-zeroeth-crystal";
export const SOUL_FLAME_SERPENT_ID = "we-the-heavenly-serpent";
export const SOUL_FLAME_CRYSTAL_ESCAPE_ID = "soul-flame-crystal-escape";
export const SOLAR_STORM_ID = "solar-storm";
export const SOLAR_STORM_RAY_ID = "solar-storm-ray";
export const FIRE_INCARNATE_ID = "fire-incarnate";
export const PROTECTORS_EYE_ID = "protectors-eye";
export const YOU_AND_ME_AETERNALLY_ID = "you-and-me-aeternally";
export const BOILING_VESSEL_ID = "boiling-vessel";
export const ECSTASY_OF_MUTUAL_SUFFERING_ID = "ecstasy-of-mutual-suffering";

export function getItemIdentifier(item) {
  return item?.flags?.[MODULE_ID]?.identifier || item?.system?.identifier || "";
}

export function isItem(item, identifier) {
  return getItemIdentifier(item) === identifier;
}
