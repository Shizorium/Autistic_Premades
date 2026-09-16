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
  maxRange,
  notifyPrefix = "Из Праха"
} = {}) {
  if (!canvas?.ready || !canvas.scene) {
    ui.notifications.warn(`${notifyPrefix} | Нет активной сцены.`);
    return null;
  }

  ui.notifications.info(`${notifyPrefix} | ${label} (ПКМ или Escape — отмена)`);

  const fromSequencer = await pickWithSequencer({ label, distance, fillColor, origin, maxRange, notifyPrefix });
  if (fromSequencer !== undefined) return fromSequencer;

  const point = await pickWithClick();
  if (!point) return null;
  if (maxRange && origin && distanceFeet(origin, point) > maxRange) {
    ui.notifications.warn(`${notifyPrefix} | Дальше ${maxRange} фт.`);
    return pickPoint({ label, distance, fillColor, origin, maxRange, notifyPrefix });
  }
  return point;
}

async function pickWithSequencer({ label, distance, fillColor, origin, maxRange, notifyPrefix = "Из Праха" }) {
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
    ui.notifications.warn(`${notifyPrefix} | Дальше ${maxRange} фт.`);
    return pickWithSequencer({ label, distance, fillColor, origin, maxRange, notifyPrefix });
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

export async function createLineTemplate({
  scene,
  origin,
  distance,
  direction,
  width = 5,
  fillColor,
  effect
} = {}) {
  const target = scene ?? canvas.scene;
  if (!target || !origin) return null;
  const color = fillColor ?? game.user.color;
  const data = {
    t: "ray",
    x: origin.x,
    y: origin.y,
    distance,
    direction,
    width,
    fillColor: color,
    borderColor: color,
    hidden: false,
    flags: {
      [MODULE_ID]: { soulFlame: true, effect }
    }
  };
  const docs = await createSceneEmbedded(target, "MeasuredTemplate", [data]);
  return docs?.[0] ?? null;
}

export function tokenRadiusFeet(token) {
  const gridDist = canvas.grid?.distance || 5;
  const width = Number(token?.document?.width ?? token?.width) || 1;
  return (width * gridDist) / 2;
}

export function tokensInLine(origin, end, widthFeet) {
  if (!origin || !end || !canvas.tokens?.placeables) return [];
  const half = (Number(widthFeet) || 5) / 2;
  return canvas.tokens.placeables.filter((token) => {
    if (!token.actor) return false;
    const radius = tokenRadiusFeet(token);
    return distanceToSegmentFeet(token.center, origin, end) <= half + radius + 0.25;
  });
}

function distanceToSegmentFeet(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return distanceFeet(point, start);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq));
  return distanceFeet(point, { x: start.x + t * dx, y: start.y + t * dy });
}

function clampToLength(origin, point, maxLength) {
  const dist = distanceFeet(origin, point);
  if (!(maxLength > 0) || dist <= maxLength || dist === 0) return { point, distance: dist };
  const ratio = maxLength / dist;
  return {
    point: {
      x: origin.x + (point.x - origin.x) * ratio,
      y: origin.y + (point.y - origin.y) * ratio
    },
    distance: maxLength
  };
}

export async function pickLineTemplate({
  origin,
  length,
  width = 5,
  fillColor,
  notifyPrefix = "The Lovers",
  persistTemplate = true,
  effect = "line"
} = {}) {
  const point = asPoint(origin) ?? origin;
  if (!point || !canvas?.ready || !canvas.scene) {
    ui.notifications.warn(`${notifyPrefix} | Нет активной сцены.`);
    return null;
  }

  const color = fillColor ?? game.user.color;
  ui.notifications.info(`${notifyPrefix} | Укажите направление линии (ЛКМ — подтвердить, ПКМ или Escape — отмена).`);

  const placed = await previewRayTemplate({
    t: CONST.MEASURED_TEMPLATE_TYPES?.RAY ?? "ray",
    user: game.user.id,
    x: point.x,
    y: point.y,
    direction: 0,
    distance: length,
    width,
    fillColor: color,
    borderColor: color,
    hidden: false
  }, point);

  if (!placed) return null;

  let template = null;
  if (persistTemplate) {
    template = await createLineTemplate({
      origin: point,
      distance: length,
      direction: placed.direction,
      width,
      fillColor: color,
      effect
    });
  }

  const end = rayEnd(point, placed.direction, length);
  return {
    origin: point,
    end,
    direction: placed.direction,
    distance: length,
    width,
    tokens: tokensInLine(point, end, width),
    template
  };
}

function rayEnd(origin, directionDeg, distanceFeet) {
  const gridDist = canvas.grid?.distance || 5;
  const size = canvas.grid?.size || 100;
  const px = (Number(distanceFeet) / gridDist) * size;
  const rad = (Number(directionDeg) * Math.PI) / 180;
  return {
    x: origin.x + Math.cos(rad) * px,
    y: origin.y + Math.sin(rad) * px
  };
}

async function previewRayTemplate(data, origin) {
  const previous = canvas.activeLayer;
  await canvas.templates?.activate?.();
  const DocumentCls = CONFIG.MeasuredTemplate.documentClass;
  const ObjectCls = CONFIG.MeasuredTemplate.objectClass;
  const doc = new DocumentCls(foundry.utils.deepClone(data), { parent: canvas.scene });
  const object = new ObjectCls(doc);
  try {
    await object.draw?.();
  } catch {
    await object._draw?.();
  }
  canvas.templates.preview?.addChild?.(object);
  if (!object.parent) canvas.templates.addChild?.(object);
  object.visible = true;
  object.refresh?.();

  const pointerPos = (event) => {
    if (event?.clientX != null && canvas.canvasCoordinatesFromClient) {
      return canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
    }
    const src = event?.data?.originalEvent ?? event?.nativeEvent ?? event;
    if (src?.clientX != null && canvas.canvasCoordinatesFromClient) {
      return canvas.canvasCoordinatesFromClient({ x: src.clientX, y: src.clientY });
    }
    if (event?.data?.getLocalPosition) {
      try {
        return event.data.getLocalPosition(canvas.templates);
      } catch {
        // fall through
      }
    }
    return canvas.mousePosition ?? null;
  };

  const updateDir = (pos) => {
    if (!pos) return;
    const direction = (Math.atan2(pos.y - origin.y, pos.x - origin.x) * 180) / Math.PI;
    try {
      doc.updateSource({
        direction,
        x: origin.x,
        y: origin.y,
        distance: data.distance,
        width: data.width
      });
    } catch {
      doc.direction = direction;
    }
    object.refresh?.();
    object.renderFlags?.set?.({ refreshShape: true, refreshPosition: true });
  };

  return new Promise((resolve) => {
    let done = false;
    const view = canvas.app?.view ?? canvas.el;
    const finish = (result) => {
      if (done) return;
      done = true;
      canvas.stage.off("pointermove", onMove);
      canvas.stage.off("pointerdown", onDown);
      window.removeEventListener("keydown", onKey, true);
      view?.removeEventListener("contextmenu", onContext, true);
      try {
        canvas.templates.preview?.removeChild?.(object);
      } catch {
        // ignore
      }
      try {
        object.destroy({ children: true });
      } catch {
        // ignore
      }
      previous?.activate?.();
      resolve(result);
    };
    const onMove = (event) => updateDir(pointerPos(event) ?? canvas.mousePosition);
    const onDown = (event) => {
      const button = event.data?.button ?? event.button ?? 0;
      if (button === 2) {
        event.stopPropagation?.();
        event.preventDefault?.();
        finish(null);
        return;
      }
      if (button === 0) {
        event.stopPropagation?.();
        finish({ direction: Number(doc.direction) || 0 });
      }
    };
    const onContext = (event) => {
      event.preventDefault();
      event.stopPropagation();
      finish(null);
    };
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      finish(null);
    };
    canvas.stage.on("pointermove", onMove);
    canvas.stage.on("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    view?.addEventListener("contextmenu", onContext, true);
  });
}

export async function pickLine({
  origin,
  length,
  width = 5,
  label = "Конец линии",
  fillColor,
  notifyPrefix = "The Lovers",
  persistTemplate = true,
  effect = "line"
} = {}) {
  if (!origin) return null;
  const end = await pickPoint({
    label,
    origin,
    maxRange: length,
    fillColor,
    notifyPrefix
  });
  if (!end) return null;
  const clamped = clampToLength(origin, end, length);
  const direction = (Math.atan2(clamped.point.y - origin.y, clamped.point.x - origin.x) * 180) / Math.PI;
  let template = null;
  if (persistTemplate) {
    template = await createLineTemplate({
      origin,
      distance: clamped.distance || length,
      direction,
      width,
      fillColor,
      effect
    });
  }
  const tokens = tokensInLine(origin, clamped.point, width);
  return {
    origin,
    end: clamped.point,
    direction,
    distance: clamped.distance || length,
    width,
    tokens,
    template
  };
}

export async function pickTokenFromList(tokens, {
  title = "Цель",
  label = "Выберите существо",
  skipLabel = null,
  autoPickSingle = true
} = {}) {
  const list = (tokens ?? []).filter((token) => token?.actor);
  if (!list.length) {
    ui.notifications.warn(`${title} | Нет подходящих целей.`);
    return null;
  }
  if (autoPickSingle && list.length === 1 && !skipLabel) return list[0];

  const stamp = foundry.utils.randomID?.(8) ?? `${Date.now()}`;
  const buttons = list.map((token) => ({
    action: token.id,
    label: token.name ?? token.actor?.name ?? token.id
  }));
  if (skipLabel) buttons.push({ action: "skip", label: skipLabel });
  else buttons.push({ action: "skip", label: "Отмена" });

  const detachHover = attachTokenListHover(stamp, list);
  try {
    const chosen = await foundry.applications.api.DialogV2.wait({
      window: { title },
      position: { width: 420 },
      content: `<p data-ap-pick="${stamp}">${label}</p>`,
      buttons,
      rejectClose: false,
      render: (_event, dialog) => bindTokenHover(dialog?.element ?? dialog, list)
    });
    if (!chosen || chosen === "skip") return null;
    return list.find((token) => token.id === chosen) ?? canvas.tokens.get(chosen) ?? null;
  } catch {
    return null;
  } finally {
    detachHover();
    clearTokenHover(list);
  }
}

function attachTokenListHover(stamp, tokens) {
  const bind = (app, element) => {
    const root = element instanceof HTMLElement ? element : app?.element;
    if (!root?.querySelector?.(`[data-ap-pick="${stamp}"]`)) return;
    bindTokenHover(root, tokens);
  };
  const hookA = Hooks.on("renderDialogV2", bind);
  const hookB = Hooks.on("renderApplicationV2", bind);
  return () => {
    Hooks.off("renderDialogV2", hookA);
    Hooks.off("renderApplicationV2", hookB);
  };
}

function bindTokenHover(root, tokens) {
  if (!root?.querySelectorAll) return;
  const byId = new Map(tokens.map((token) => [token.id, token]));
  const onOver = (event) => {
    const id = event.currentTarget?.dataset?.action;
    hoverToken(byId.get(id), true);
  };
  const onOut = (event) => {
    const id = event.currentTarget?.dataset?.action;
    hoverToken(byId.get(id), false);
  };
  for (const button of root.querySelectorAll("[data-action]")) {
    if (!byId.has(button.dataset.action)) continue;
    button.addEventListener("pointerenter", onOver);
    button.addEventListener("pointerleave", onOut);
    button.addEventListener("mouseover", onOver);
    button.addEventListener("mouseout", onOut);
  }
}

function hoverToken(token, on) {
  if (!token) return;
  try {
    const event = { type: on ? "pointerover" : "pointerout", preventDefault() {}, stopPropagation() {} };
    if (on) {
      canvas.tokens.hover = token;
      token._onHoverIn?.(event, { hoverOutOthers: true });
    } else {
      if (canvas.tokens.hover === token) canvas.tokens.hover = null;
      token._onHoverOut?.(event);
    }
  } catch {
    token.hover = Boolean(on);
    token.refresh?.();
  }
}

function clearTokenHover(tokens) {
  for (const token of tokens ?? []) hoverToken(token, false);
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

export async function updateTokenPosition(tokenDoc, point, options = {}) {
  if (!tokenDoc || !point) return null;
  const size = canvas.grid?.size || 100;
  const x = point.x - ((tokenDoc.width ?? 1) * size) / 2;
  const y = point.y - ((tokenDoc.height ?? 1) * size) / 2;
  const snapped = canvas.grid.getSnappedPoint?.(
    { x, y },
    { mode: CONST.GRID_SNAPPING_MODES?.TOP_LEFT_CORNER ?? CONST.GRID_SNAPPING_MODES?.CORNER ?? 0 }
  ) ?? { x, y };
  const changes = { x: snapped.x, y: snapped.y };
  if (game.user.isGM || tokenDoc.isOwner) return tokenDoc.update(changes, options);
  const socket = globalThis.autisticPremades?.socket;
  if (socket) return socket.executeAsGM("updateToken", tokenDoc.uuid, changes, options);
  return tokenDoc.update(changes, options);
}

export async function mutateActor(actor, method, documentName, payload) {
  if (!actor) return [];
  const socket = globalThis.autisticPremades?.socket;
  if (socket && !game.user.isGM) {
    return socket.executeAsGM(method, actor.uuid, documentName, payload);
  }
  return actor[method](documentName, payload);
}
