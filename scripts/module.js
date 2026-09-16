import { MODULE_ID } from "./lib/identifier.js";
import { registerSettings } from "./lib/settings.js";
import { registerBastionOfAmends } from "./features/bastion-of-amends.js";
import { startLivingAltarReminder } from "./features/living-altar-of-stubbornness.js";
import { registerFromTheAshes, registerDeathStatus, promptFromTheAshesSideEffect } from "./features/from-the-ashes.js";
import { runFromTheAshesPlayerEffect } from "./features/from-the-ashes-automations.js";
import { registerDamageToOne } from "./features/damage-to-one.js";
import { registerInnerFade } from "./features/inner-fade.js";
import { registerSandevistan } from "./features/sandevistan.js";
import { registerLegendaryResistance } from "./features/legendary-resistance.js";
import { registerFadeOnslaught } from "./features/fade-onslaught.js";
import { registerFadeSerums } from "./features/fade-serums.js";
import { registerSoulFlame } from "./features/soul-flame.js";
import { registerSolarStorm } from "./features/solar-storm.js";
import { registerFireIncarnate } from "./features/fire-incarnate.js";
import { registerProtectorsEye } from "./features/protectors-eye.js";
import { registerYouAndMeAeternally } from "./features/you-and-me-aeternally.js";
import { registerBoilingVessel } from "./features/boiling-vessel.js";
import { registerEcstasyOfMutualSuffering } from "./features/ecstasy-of-mutual-suffering.js";
import { registerFanQuestion } from "./features/fan-question.js";
import { registerDejaVu, showDejaVuPrompt } from "./features/deja-vu.js";

Hooks.once("init", () => {
  console.log("Autistic Premades | Initialized");
  registerSettings();
  registerDeathStatus();
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
  socket.register("runFromTheAshesPlayerEffect", runFromTheAshesPlayerEffect);
  socket.register("createMeasuredTemplates", async (sceneUuid, data) => {
    const scene = await fromUuid(sceneUuid);
    if (!scene) return [];
    return scene.createEmbeddedDocuments("MeasuredTemplate", data);
  });
  socket.register("updateToken", async (uuid, changes, options = {}) => {
    const doc = await fromUuid(uuid);
    if (!doc) return null;
    return doc.update(changes, options);
  });
  socket.register("applyDamage", async (uuid, damages, options = {}) => {
    const doc = await fromUuid(uuid);
    if (!doc?.applyDamage) return null;
    return doc.applyDamage(damages, options);
  });
  socket.register("updateActor", async (uuid, changes) => {
    const doc = await fromUuid(uuid);
    if (!doc) return null;
    return doc.update(changes);
  });
  socket.register("dejaVuPrompt", showDejaVuPrompt);
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
  registerSoulFlame();
  registerSolarStorm();
  registerFireIncarnate();
  registerProtectorsEye();
  registerYouAndMeAeternally();
  registerBoilingVessel();
  registerEcstasyOfMutualSuffering();
  registerFanQuestion();
  registerDejaVu();
});
