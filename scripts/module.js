import { MODULE_ID } from "./lib/identifier.js";
import { registerSettings } from "./lib/settings.js";
import { registerBastionOfAmends } from "./features/bastion-of-amends.js";
import { startLivingAltarReminder } from "./features/living-altar-of-stubbornness.js";

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
  globalThis.autisticPremades ??= {};
  globalThis.autisticPremades.socket = socket;
}

Hooks.once("socketlib.ready", registerSocket);

Hooks.once("ready", () => {
  registerSocket();
  registerBastionOfAmends();
  startLivingAltarReminder();
});
