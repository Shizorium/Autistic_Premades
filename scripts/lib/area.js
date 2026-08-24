import { MODULE_ID } from "./identifier.js";

export function notifyCancelled() {
  ui.notifications.info("Из Праха | Выбор отменён.");
}

export function distanceFeet(a, b) {
  if (!a || !b) return Infinity;
  if (canvas.grid?.measurePath) {
    const measured = canvas.grid.measurePath([a, b]);
    const dist = Number(measured?.distance ?? measured?.cost);
    if (Number.isFinite(dist)) return dist;
  }
  const size = canvas.grid?.size || 100;
  const gridDist = canvas.grid?.distance || 5;
  return (Math.hypot(b.x - a.x, b.y - a.y) / size) * gridDist;
}

export async function pickPoint({
  label = "Выберите точку",
  distance,
  fillColor,
  origin,
  maxRange
} = {}) {
  if (!canvas?.ready || !canvas.scene) {
    ui.notifications.warn("Из Праха | Нет активной сцены.");
    return null;
  }

  ui.notifications.info(`Из Праха | ${label} (ПКМ или Escape — отмена)`);

  const fromSequencer = await pickWithSequencer({ label, distance, fillColor, origin, maxRange });
  if (fromSequencer !== undefined) return fromSequencer;

  const point = await pickWithClick();
  if (!point) return null;
  if (maxRange && origin && distanceFeet(origin, point) > maxRange) {
    ui.notifications.warn(`Из Праха | Дальше ${maxRange} фт.`);
    return pickPoint({ label, distance, fillColor, origin, maxRange });
  }
  return point;
}

async function pickWithSequencer({ label, distance, fillColor, origin, maxRange }) {
  const show = globalThis.Sequencer?.Crosshair?.show;
  if (!show) return undefined;

  const config = {
    icon: "icons/svg/target.svg",
    label,
    snap: { position: CONST.GRID_SNAPPING_MODES?.CENTER ?? 1 },
    gridHighlight: true
  };
  if (distance) {
    config.t = "circle";
    config.distance = distance;
    if (fillColor) {
      config.fillColor = fillColor;
      config.borderColor = fillColor;
    }
  }
  if (origin && maxRange) {
    const point = asPoint(origin) ?? origin;
    config.location = {
      x: point.x,
      y: point.y,
      limitMaxRange: maxRange,
      showRange: true
    };
  }

  let result;
  try {
    result = await show(config);
  } catch {
    return undefined;
  }
  if (result === false || result == null) return null;
  const point = asPoint(result);
  if (!point) return null;
  if (maxRange && origin && distanceFeet(asPoint(origin) ?? origin, point) > maxRange) {
    ui.notifications.warn(`Из Праха | Дальше ${maxRange} фт.`);
    return pickWithSequencer({ label, distance, fillColor, origin, maxRange });
  }
  return point;
}

function asPoint(value) {
  if (!value || typeof value !== "object") return null;
  const x = Number(value.x ?? value.center?.x);
  const y = Number(value.y ?? value.center?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function pickWithClick() {
  return new Promise((resolve) => {
    const view = canvas.app?.view ?? canvas.el;
    const onPointer = (event) => {
      const button = event.button ?? event.data?.button ?? 0;
      if (button === 2) {
        event.preventDefault?.();
        event.stopPropagation?.();
        cleanup();
        resolve(null);
        return;
      }
      if (button !== 0) return;
      event.stopPropagation?.();
      cleanup();
      const pos = canvas.mousePosition ?? event.getLocalPosition?.(canvas.stage);
      if (!pos) {
        resolve(null);
        return;
      }
      const snapped = canvas.grid.getSnappedPoint?.(pos, {
        mode: CONST.GRID_SNAPPING_MODES?.CENTER ?? 1
      }) ?? pos;
      resolve({ x: snapped.x, y: snapped.y });
    };
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      cleanup();
      resolve(null);
    };
    const onContext = (event) => {
      event.preventDefault();
      cleanup();
      resolve(null);
    };
    const cleanup = () => {
      canvas.stage.off("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey, true);
      view?.removeEventListener("contextmenu", onContext);
    };
    canvas.stage.on("pointerdown", onPointer);
    window.addEventListener("keydown", onKey, true);
    view?.addEventListener("contextmenu", onContext);
  });
}

export async function createCircleTemplate({
  scene,
  x,
  y,
  distance,
  fillColor,
  effect
} = {}) {
  const target = scene ?? canvas.scene;
  if (!target) return null;
  const color = fillColor ?? game.user.color;
  const data = {
    t: "circle",
    x,
    y,
    distance,
    direction: 0,
    fillColor: color,
    borderColor: color,
    hidden: false,
    flags: {
      [MODULE_ID]: { fromTheAshes: true, effect }
    }
  };

  const docs = await createSceneEmbedded(target, "MeasuredTemplate", [data]);
  return docs?.[0] ?? null;
}

export async function createAreaAt({
  center,
  distance,
  fillColor,
  effect,
  name,
  scene,
  target = false,
  visual = true,
  persistTemplate = true
} = {}) {
  if (!center) return null;
  const targetScene = scene ?? canvas.scene;
  const color = fillColor ?? game.user.color;
  let template = null;
  if (persistTemplate) {
    template = await createCircleTemplate({
      scene: targetScene,
      x: center.x,
      y: center.y,
      distance,
      fillColor: color,
      effect
    });
  }
  if (visual) {
    await createAreaDrawing({
      scene: targetScene,
      center,
      distance,
      fillColor: color,
      name,
      effect
    });
    await playAreaVisual({ center, distance, fillColor: color, label: name, effect });
  }
  const tokens = tokensInCircle(center, distance);
  if (target) highlightTargets(tokens);
  return { center, distance, tokens, template };
}

export async function placeCircleTemplate({
  label,
  name,
  distance,
  fillColor,
  effect,
  origin,
  maxRange,
  target = false,
  visual = true,
  persistTemplate = true
} = {}) {
  const point = await pickPoint({ label, distance, fillColor, origin, maxRange });
  if (!point) {
    notifyCancelled();
    return null;
  }
  const placed = await createAreaAt({
    center: point,
    distance,
    fillColor,
    effect,
    name: name ?? label,
    scene: canvas.scene,
    target,
    visual,
    persistTemplate
  });
  if (!placed) {
    ui.notifications.warn("Из Праха | Не удалось создать область.");
    return null;
  }
  return placed;
}

export function tokensInCircle(center, radiusFeet) {
  if (!center || !(radiusFeet > 0) || !canvas.tokens?.placeables) return [];
  return canvas.tokens.placeables.filter((token) => {
    if (!token.actor) return false;
    return distanceFeet(center, token.center) <= radiusFeet + 0.25;
  });
}

export function tokensInTemplate(templateDoc) {
  if (!templateDoc) return [];
  return tokensInCircle(
    { x: templateDoc.x, y: templateDoc.y },
    Number(templateDoc.distance) || 0
  );
}

export function highlightTargets(tokens) {
  const ids = tokens.map((token) => token.id).filter(Boolean);
  if (game.user.updateTokenTargets) {
    game.user.updateTokenTargets(ids);
  } else {
    for (const token of canvas.tokens.placeables) {
      token.setTarget(ids.includes(token.id), { releaseOthers: false, groupSelection: true });
    }
  }
  game.user.broadcastActivity?.({ targets: ids });
}

async function createAreaDrawing({ scene, center, distance, fillColor, name, effect }) {
  const target = scene ?? canvas.scene;
  if (!target || !center) return null;
  const radiusPx = radiusPixels(distance);
  const diameter = Math.max(radiusPx * 2, 1);
  const data = {
    shape: {
      type: CONST.DRAWING_TYPES?.ELLIPSE ?? "e",
      width: diameter,
      height: diameter
    },
    x: center.x - radiusPx,
    y: center.y - radiusPx,
    fillType: CONST.DRAWING_FILL_TYPES?.SOLID ?? 1,
    fillColor,
    fillAlpha: 0.22,
    strokeWidth: 6,
    strokeColor: fillColor,
    strokeAlpha: 0.95,
    text: name ?? "",
    fontSize: Math.max(24, Math.min(48, Math.round(radiusPx / 6))),
    textColor: "#ffffff",
    hidden: false,
    locked: false,
    interface: true,
    flags: {
      [MODULE_ID]: { fromTheAshes: true, effect }
    }
  };
  try {
    const docs = await createSceneEmbedded(target, "Drawing", [data]);
    return docs?.[0] ?? null;
  } catch (error) {
    console.warn("Из Праха | Failed to create area drawing", error);
    return null;
  }
}

async function playAreaVisual({ center, distance, fillColor, label, effect }) {
  if (!globalThis.Sequence || !center) return;
  const gridDist = canvas.grid?.distance || 5;
  const squares = Math.max(0.5, Number(distance) / gridDist);
  const name = `ap-ashes-${effect || "area"}`;
  try {
    await new Sequence()
      .effect()
        .atLocation(center)
        .name(`${name}-fill`)
        .persist()
        .aboveTokens()
        .zIndex(50)
        .shape("circle", {
          radius: squares,
          gridUnits: true,
          fillColor,
          fillAlpha: 0.32,
          lineSize: 8,
          lineColor: fillColor
        })
      .effect()
        .atLocation(center)
        .name(`${name}-text`)
        .persist()
        .aboveTokens()
        .zIndex(51)
        .text(String(label ?? ""), {
          fill: "#ffffff",
          fontSize: 36,
          stroke: "#000000",
          strokeThickness: 5,
          align: "center"
        })
      .play();
  } catch (error) {
    console.warn("Из Праха | Sequencer area visual failed", error);
  }
}

function radiusPixels(distanceFeet) {
  const size = canvas.grid?.size || 100;
  const gridDist = canvas.grid?.distance || 5;
  return (Number(distanceFeet) / gridDist) * size;
}

async function createSceneEmbedded(scene, documentName, data) {
  const socket = globalThis.autisticPremades?.socket;
  if (socket && !game.user.isGM) {
    return socket.executeAsGM("createEmbeddedDocuments", scene.uuid, documentName, data);
  }
  return scene.createEmbeddedDocuments(documentName, data);
}

export async function updateTokenPosition(tokenDoc, point) {
  if (!tokenDoc || !point) return null;
  const size = canvas.grid?.size || 100;
  const x = point.x - ((tokenDoc.width ?? 1) * size) / 2;
  const y = point.y - ((tokenDoc.height ?? 1) * size) / 2;
  const snapped = canvas.grid.getSnappedPoint?.(
    { x, y },
    { mode: CONST.GRID_SNAPPING_MODES?.TOP_LEFT_CORNER ?? CONST.GRID_SNAPPING_MODES?.CORNER ?? 0 }
  ) ?? { x, y };
  const changes = { x: snapped.x, y: snapped.y };
  if (game.user.isGM || tokenDoc.isOwner) return tokenDoc.update(changes);
  const socket = globalThis.autisticPremades?.socket;
  if (socket) return socket.executeAsGM("updateToken", tokenDoc.uuid, changes);
  return tokenDoc.update(changes);
}

export async function mutateActor(actor, method, documentName, payload) {
  if (!actor) return [];
  const socket = globalThis.autisticPremades?.socket;
  if (socket && !game.user.isGM) {
    return socket.executeAsGM(method, actor.uuid, documentName, payload);
  }
  return actor[method](documentName, payload);
}
