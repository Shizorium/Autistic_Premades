import { MODULE_ID } from "./lib/identifier.js";
import { registerSettings } from "./lib/settings.js";
import { registerBastionOfAmends } from "./features/bastion-of-amends.js";
import { startLivingAltarReminder } from "./features/living-altar-of-stubbornness.js";
import { registerFromTheAshes, promptFromTheAshesSideEffect } from "./features/from-the-ashes.js";
import { registerDamageToOne } from "./features/damage-to-one.js";
import { registerInnerFade } from "./features/inner-fade.js";
import { registerSandevistan } from "./features/sandevistan.js";
import { registerLegendaryResistance } from "./features/legendary-resistance.js";
import { registerFadeOnslaught } from "./features/fade-onslaught.js";
import { registerFadeSerums } from "./features/fade-serums.js";

Hooks.once("init", () => {
  console.log("Autistic Premades | Initialized");
  registerSettings();
});

function registerSocket() {
  if (!globalThis.socketlib || globalThis.autisticPremades?.socket) return;
  const socket = socketlib.registerModule(MODULE_ID);
  socket.register("createEmbeddedDocuments", async (uuid, documentName, data) => {
    const doc = await fromUuid(uuid);
    if (!doc) return [];
    return doc.createEmbeddedDocuments(documentName, data);
  });
  socket.register("deleteEmbeddedDocuments", async (uuid, documentName, ids) => {
    const doc = await fromUuid(uuid);
    if (!doc) return [];
    return doc.deleteEmbeddedDocuments(documentName, ids);
  });
  socket.register("updateEmbeddedDocuments", async (uuid, documentName, updates) => {
    const doc = await fromUuid(uuid);
    if (!doc) return [];
    return doc.updateEmbeddedDocuments(documentName, updates);
  });
  socket.register("promptFromTheAshesSideEffect", promptFromTheAshesSideEffect);
  socket.register("applyDamage", async (uuid, damages, options = {}) => {
    const doc = await fromUuid(uuid);
    if (!doc?.applyDamage) return null;
    return doc.applyDamage(damages, options);
  });
  globalThis.autisticPremades ??= {};
  globalThis.autisticPremades.socket = socket;
}

Hooks.once("socketlib.ready", registerSocket);

Hooks.once("ready", () => {
  registerSocket();
  registerBastionOfAmends();
  startLivingAltarReminder();
  registerFromTheAshes();
  registerDamageToOne();
  registerInnerFade();
  registerSandevistan();
  registerLegendaryResistance();
  registerFadeOnslaught();
  registerFadeSerums();
});
