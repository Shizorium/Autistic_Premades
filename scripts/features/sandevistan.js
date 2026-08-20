import { MODULE_ID, SANDEVISTAN_ID, SANDEVISTAN_NAME, isItem } from "../lib/identifier.js";
import { applyActorDamage } from "../lib/hp.js";
import { healFromKill } from "./inner-fade.js";

const handledUses = new Set();
const pendingMove = new WeakMap();
const lightningHits = new Map();

const FILTER_ID = "SandyfilterID";
const FILTER_OPTS = {
  color: { value: "#808080", apply: true },
  gamma: 1.0,
  contrast: 1.0,
  brightness: 1.0,
  saturation: 0,
  skipFading: true
};

const MOVEMENT_KEYS = ["walk", "burrow", "climb", "fly", "swim"];
const TOKEN_ANIMATION_MULT = 1.5;

export function registerSandevistan() {
  Hooks.on("dnd5e.postUseActivity", onPostUseActivity);
  Hooks.on("midi-qol.RollComplete", onMidiRollComplete);
  Hooks.on("preUpdateToken", onPreUpdateToken);
  Hooks.on("updateToken", onUpdateToken);
  Hooks.on("deleteItem", onDeleteItem);
  Hooks.on("deleteCombat", () => lightningHits.clear());
  registerTokenAnimationSpeed();
  migrateExistingNames();
}

function sandevistanAnimationSpeed() {
  return (CONFIG.Token?.movement?.defaultSpeed ?? 6) * TOKEN_ANIMATION_MULT;
}

function registerTokenAnimationSpeed() {
  const wrap = function (wrapped, options = {}) {
    if (!this.document?.getFlag(MODULE_ID, "sandevistanActive")) return wrapped(options);
    const baseOptions = foundry.utils.deepClone(options);
    delete baseOptions.movementSpeed;
    if (baseOptions.animation && typeof baseOptions.animation === "object") {
      delete baseOptions.animation.movementSpeed;
    }
    return wrapped(baseOptions) * TOKEN_ANIMATION_MULT;
  };
  if (globalThis.libWrapper) {
    const paths = [
      "CONFIG.Token.objectClass.prototype._getAnimationMovementSpeed",
      "foundry.canvas.placeables.Token.prototype._getAnimationMovementSpeed"
    ];
    for (const target of paths) {
      try {
        libWrapper.register(MODULE_ID, target, wrap, "WRAPPER");
        return;
      } catch {
        // Try the next Foundry 13 path.
      }
    }
  }
  const proto = CONFIG.Token?.objectClass?.prototype;
  if (!proto?._getAnimationMovementSpeed || proto._apSandevistanSpeedWrapped) return;
  const original = proto._getAnimationMovementSpeed;
  proto._getAnimationMovementSpeed = function (options) {
    return wrap.call(this, original.bind(this), options);
  };
  proto._apSandevistanSpeedWrapped = true;
}

function migrateExistingNames() {
  if (!game.user.isGM) return;
  for (const actor of game.actors) renameSandevistanItems(actor);
  for (const scene of game.scenes) {
    for (const token of scene.tokens) {
      if (!token.actorLink && token.actor) renameSandevistanItems(token.actor);
    }
  }
}

function renameSandevistanItems(actor) {
  for (const item of actor.items) {
    if (!isItem(item, SANDEVISTAN_ID) || item.name === SANDEVISTAN_NAME) continue;
    void item.update({ name: SANDEVISTAN_NAME });
  }
  for (const effect of actor.effects) {
    if (!effect.flags?.[MODULE_ID]?.sandevistan || effect.name === SANDEVISTAN_NAME) continue;
    void effect.update({ name: SANDEVISTAN_NAME });
  }
}

function onPostUseActivity(activity) {
  handleUsedItem(activity?.item ?? activity);
}

function onMidiRollComplete(workflow) {
  handleUsedItem(workflow?.item);
}

function handleUsedItem(item) {
  if (!isItem(item, SANDEVISTAN_ID) || !item.actor) return;
  if (!isPrimaryHandler(item.actor)) return;
  const key = `${item.uuid}:${item.actor.uuid}`;
  if (handledUses.has(key)) return;
  handledUses.add(key);
  setTimeout(() => handledUses.delete(key), 4000);
  void toggleSandevistan(item);
}

function onDeleteItem(item) {
  if (!isItem(item, SANDEVISTAN_ID) || !item.actor) return;
  void deactivateSandevistan(item.actor, getActorToken(item.actor));
}

async function toggleSandevistan(item) {
  const actor = item.actor;
  const token = getActorToken(actor);
  if (!token) {
    ui.notifications?.warn(`${item.name} | Нужен токен на сцене.`);
    return;
  }
  if (isActive(token)) await deactivateSandevistan(actor, token);
  else await activateSandevistan(actor, item, token);
}

function isPrimaryHandler(actor) {
  const owners = game.users.filter((user) => user.active && !user.isGM && actor.testUserPermission(user, "OWNER"));
  if (owners.length) return owners[0].id === game.user.id;
  return game.user.isGM;
}

function isActive(token) {
  return Boolean(token?.document?.getFlag(MODULE_ID, "sandevistanActive"));
}

function getActorToken(actor) {
  return actor?.getActiveTokens()?.[0]
    ?? canvas.tokens?.controlled?.find((t) => t.actor === actor)
    ?? null;
}

async function activateSandevistan(actor, item, token) {
  await token.document.setFlag(MODULE_ID, "sandevistanActive", true);
  await replaceSpeedEffect(actor, item);
  applySandyFilter();
  await playIntro(token);
  trailLoop(token);
}

async function deactivateSandevistan(actor, token) {
  if (token?.document) {
    await token.document.setFlag(MODULE_ID, "sandevistanActive", false);
  }
  await removeSpeedEffects(actor);
  if (token) await playOutro(token);
  else removeSandyFilter();
  if (token?.document) {
    await token.document.unsetFlag(MODULE_ID, "sandevistanActive").catch(() => {});
  }
}

async function replaceSpeedEffect(actor, item) {
  await removeSpeedEffects(actor);
  const changes = MOVEMENT_KEYS.map((key) => ({
    key: `system.attributes.movement.${key}`,
    mode: CONST.ACTIVE_EFFECT_MODES.MULTIPLY,
    value: "3",
    priority: 20
  }));
  await mutateActor(actor, "createEmbeddedDocuments", "ActiveEffect", [{
    name: item.name,
    img: item.img,
    origin: item.uuid,
    transfer: false,
    disabled: false,
    duration: {},
    changes,
    flags: {
      [MODULE_ID]: { sandevistan: true }
    }
  }]);
}

async function removeSpeedEffects(actor) {
  if (!actor) return;
  const ids = actor.effects
    .filter((effect) => effect.flags?.[MODULE_ID]?.sandevistan)
    .map((effect) => effect.id);
  if (!ids.length) return;
  await mutateActor(actor, "deleteEmbeddedDocuments", "ActiveEffect", ids);
}

function applySandyFilter() {
  if (globalThis.FXMASTER?.filters?.addFilter) return globalThis.FXMASTER.filters.addFilter(FILTER_ID, "color", FILTER_OPTS);
  if (globalThis.FXMASTER?.filters?.switch) return globalThis.FXMASTER.filters.switch(FILTER_ID, "color", FILTER_OPTS);
}

function removeSandyFilter() {
  if (globalThis.FXMASTER?.filters?.removeFilter) return globalThis.FXMASTER.filters.removeFilter(FILTER_ID);
  if (globalThis.FXMASTER?.filters?.switch) return globalThis.FXMASTER.filters.switch(FILTER_ID, "color", FILTER_OPTS);
}

async function playIntro(tok) {
  if (!globalThis.Sequence) return;
  await new Sequence()
    .wait(1000)
    .effect()
      .atLocation(tok)
      .name("Sandevistan")
      .persist()
      .copySprite(tok)
      .aboveLighting()
      .attachTo(tok)
      .extraEndDuration(2000)
      .zIndex(1)
    .effect()
      .atLocation(tok)
      .file("jb2a.token_stage.round.green.02.02")
      .scaleToObject(1.2)
      .filter("ColorMatrix", { hue: 50 })
      .playbackRate(2)
      .duration(3000)
      .attachTo(tok)
      .aboveLighting()
      .zIndex(2)
    .effect()
      .delay(250)
      .atLocation(tok)
      .file("jb2a.token_stage.round.green.02.02")
      .scaleToObject(1.2)
      .filter("ColorMatrix", { hue: 25 })
      .filter("Blur", { blurX: 30, blurY: 0 })
      .aboveLighting()
      .attachTo(tok)
      .duration(2750)
      .playbackRate(2)
      .zIndex(1)
    .play();
}

async function playOutro(tok) {
  if (!globalThis.Sequence) {
    removeSandyFilter();
    return;
  }
  await new Sequence()
    .effect()
      .atLocation(tok)
      .file("jb2a.token_stage.round.green.02.02")
      .scaleToObject(1.2)
      .filter("ColorMatrix", { hue: 50 })
      .playbackRate(2)
      .attachTo(tok)
      .duration(3000)
      .aboveLighting()
      .zIndex(2)
    .effect()
      .delay(250)
      .atLocation(tok)
      .file("jb2a.token_stage.round.green.02.02")
      .scaleToObject(1.2)
      .filter("ColorMatrix", { hue: 25 })
      .filter("Blur", { blurX: 30, blurY: 0 })
      .attachTo(tok)
      .duration(2750)
      .playbackRate(2)
      .aboveLighting()
      .zIndex(1)
    .thenDo(() => {
      globalThis.Sequencer?.EffectManager?.endEffects({ name: "Sandevistan", object: tok });
      removeSandyFilter();
    })
    .play();
}

async function trailLoop(tok) {
  if (!globalThis.Sequence || !globalThis.Sequencer) return;
  let i = 0;
  while (tok.document.getFlag(MODULE_ID, "sandevistanActive")) {
    new Sequence()
      .effect()
        .atLocation(tok)
        .copySprite(tok)
        .belowTokens()
        .opacity(1)
        .tint("#30FF58")
        .filter("ColorMatrix", { hue: 1.5 * i })
        .zIndex(0)
        .duration(250)
        .fadeOut(250)
      .play();
    i = (i + 1) % 240;
    await Sequencer.Helpers.wait(45);
  }
}

function onPreUpdateToken(tokenDoc, changes, options) {
  if (!("x" in changes) && !("y" in changes)) return;
  pendingMove.set(tokenDoc, { x: tokenDoc.x, y: tokenDoc.y });
  if (!tokenDoc.getFlag(MODULE_ID, "sandevistanActive")) return;
  boostTokenAnimation(tokenDoc, changes, options);
}

function boostTokenAnimation(tokenDoc, changes, options = {}) {
  const speed = sandevistanAnimationSpeed();
  options.animation ??= {};
  options.animation.movementSpeed = speed;
  const dx = (changes.x ?? tokenDoc.x) - tokenDoc.x;
  const dy = (changes.y ?? tokenDoc.y) - tokenDoc.y;
  const dist = Math.hypot(dx, dy);
  const gridSize = canvas?.grid?.size;
  if (dist > 0 && gridSize) {
    options.animation.duration = (dist / gridSize / speed) * 1000;
  }
}

function onUpdateToken(tokenDoc, changes) {
  if (!game.user.isGM) return;
  if (!("x" in changes) && !("y" in changes)) return;
  if (!tokenDoc.getFlag(MODULE_ID, "sandevistanActive")) return;
  const previous = pendingMove.get(tokenDoc) ?? { x: tokenDoc.x, y: tokenDoc.y };
  pendingMove.delete(tokenDoc);
  void applyPassbyLightning(tokenDoc, previous, { x: tokenDoc.x, y: tokenDoc.y });
}

async function applyPassbyLightning(tokenDoc, from, to) {
  const actor = tokenDoc.actor;
  if (!actor) return;
  const amount = Math.ceil(getFighterLevel(actor) / 2);
  if (amount <= 0) return;
  const roundKey = getRoundKey(actor);
  const hit = lightningHits.get(roundKey) ?? new Set();
  const targets = [];
  for (const doc of collectPassedCreatures(tokenDoc, from, to)) {
    const uuid = doc.actor?.uuid;
    if (!uuid || hit.has(uuid)) continue;
    hit.add(uuid);
    targets.push(doc);
  }
  lightningHits.set(roundKey, hit);
  if (!targets.length) return;

  const hpBefore = new Map(targets.map((doc) => [
    doc.actor.uuid,
    Number(doc.actor.system?.attributes?.hp?.value) || 0
  ]));
  const tokens = targets
    .map((doc) => doc.object ?? canvas.tokens?.get(doc.id))
    .filter(Boolean);
  const item = actor.items.find((entry) => isItem(entry, SANDEVISTAN_ID));

  if (globalThis.MidiQOL?.applyTokenDamage && tokens.length) {
    await MidiQOL.applyTokenDamage(
      [{ value: amount, type: "lightning" }],
      amount,
      new Set(tokens),
      item,
      new Set(),
      {
        forceApply: true,
        workflow: {
          actor,
          token: tokenDoc.object,
          itemCardUuid: undefined,
          flagTags: undefined
        }
      }
    );
  } else {
    for (const target of targets) {
      await applyActorDamage(target.actor, [{ value: amount, type: "lightning" }]);
    }
  }

  for (const target of targets) {
    const before = hpBefore.get(target.actor.uuid) ?? 0;
    const after = Number(target.actor.system?.attributes?.hp?.value) || 0;
    if (before > 0 && after <= 0) await healFromKill(actor, target.actor);
  }
}

function getFighterLevel(actor) {
  return Number(actor.classes?.fighter?.system?.levels) || 1;
}

function getRoundKey(actor) {
  const combat = game.combat;
  if (combat?.started) return `${combat.id}:${combat.round}:${actor.uuid}`;
  return `free:${Math.floor(game.time.worldTime / 6)}:${actor.uuid}`;
}

function collectPassedCreatures(tokenDoc, from, to) {
  const others = tokenDoc.parent?.tokens?.contents ?? canvas.tokens?.placeables?.map((t) => t.document) ?? [];
  const seen = new Set();
  const hits = [];
  for (const pos of samplePath(from, to)) {
    for (const other of others) {
      if (!other || other.id === tokenDoc.id || seen.has(other.id)) continue;
      const otherActor = other.actor;
      if (!otherActor || otherActor === tokenDoc.actor) continue;
      if ((Number(otherActor.system?.attributes?.hp?.value) || 0) <= 0) continue;
      if (!isAdjacentAt(tokenDoc, pos, other)) continue;
      seen.add(other.id);
      hits.push(other);
    }
  }
  return hits;
}

function samplePath(from, to) {
  const size = canvas.grid?.size || 100;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const steps = Math.max(1, Math.round(Math.hypot(dx, dy) / size));
  const points = [];
  for (let i = 1; i <= steps; i++) {
    points.push({
      x: from.x + (dx * i) / steps,
      y: from.y + (dy * i) / steps
    });
  }
  return points;
}

function isAdjacentAt(moverDoc, pos, otherDoc) {
  const size = canvas.grid?.size || 100;
  const aW = (moverDoc.width ?? 1) * size;
  const aH = (moverDoc.height ?? 1) * size;
  const bW = (otherDoc.width ?? 1) * size;
  const bH = (otherDoc.height ?? 1) * size;
  const gapX = pos.x < otherDoc.x ? otherDoc.x - (pos.x + aW) : pos.x - (otherDoc.x + bW);
  const gapY = pos.y < otherDoc.y ? otherDoc.y - (pos.y + aH) : pos.y - (otherDoc.y + bH);
  return Math.max(gapX, gapY) <= 1;
}

async function mutateActor(actor, method, documentName, payload) {
  const socket = globalThis.autisticPremades?.socket;
  if (socket && !game.user.isGM) {
    return socket.executeAsGM(method, actor.uuid, documentName, payload);
  }
  return actor[method](documentName, payload);
}
