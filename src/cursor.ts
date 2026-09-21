/**
 * 明日方舟官网风格自定义指针（圆形语言）。
 *
 * - 仅在 `(pointer: fine)` 设备上启用：否则不创建 DOM、不注册事件。
 * - 跟随：requestAnimationFrame + lerp，只写 transform。
 * - 圆环层 lerp 系数小于中心点层，形成轻微拖尾层次。
 * - 悬停可交互元素（或 3D 档案卡片，即 canvas style.cursor === "pointer"）
 *   时切换 `.is-hover`；按下左键时整体收缩脉冲。
 * - `#stage.reduce-motion` 下 lerp 系数取 1（无惯性延迟），缩放弹簧直达到位。
 */

const INTERACTIVE_SELECTOR =
  'a, button, input, select, textarea, summary, [role="button"], [data-action], [data-select], [data-tab], [data-filter], label';

const DOT_LERP = 0.32;
const FRAME_LERP = 0.18;
const PRESS_SCALE = 0.78;
const SPRING_STIFFNESS = 0.26;
const SPRING_DAMPING = 0.58;

function isInteractive(target: Element): boolean {
  // 3D 画布：悬停档案卡片时 scene.ts 会把 canvas inline cursor 设为 pointer
  if (target instanceof HTMLCanvasElement)
    return target.style.cursor === "pointer";
  const hit = target.closest(INTERACTIVE_SELECTOR);
  if (!hit) return false;
  if (
    hit instanceof HTMLButtonElement ||
    hit instanceof HTMLInputElement ||
    hit instanceof HTMLSelectElement ||
    hit instanceof HTMLTextAreaElement
  )
    return !hit.disabled;
  return true;
}

export function setupCursor() {
  if (!matchMedia("(pointer: fine)").matches) return;
  if (document.getElementById("ark-cursor")) return;

  const root = document.createElement("div");
  root.id = "ark-cursor";
  root.setAttribute("aria-hidden", "true");
  root.innerHTML =
    '<div class="ark-cursor-layer ark-cursor-frame-layer">' +
    '<div class="ark-cursor-frame"><svg class="ark-cursor-ring" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="11.5" pathLength="100"/></svg></div>' +
    "</div>" +
    '<div class="ark-cursor-layer ark-cursor-dot-layer">' +
    '<div class="ark-cursor-dot"></div>' +
    "</div>";
  document.body.appendChild(root);

  const frameLayer = root.querySelector<HTMLElement>(".ark-cursor-frame-layer")!;
  const dotLayer = root.querySelector<HTMLElement>(".ark-cursor-dot-layer")!;
  const stage = document.getElementById("stage");

  let targetX = innerWidth / 2,
    targetY = innerHeight / 2;
  let dotX = targetX,
    dotY = targetY,
    frameX = targetX,
    frameY = targetY;
  let scale = 1,
    scaleVelocity = 0,
    scaleTarget = 1;
  let visible = false,
    seen = false;
  let hoverTarget: Element | null = null,
    hoverCheck = false;

  const setVisible = (next: boolean) => {
    if (visible === next) return;
    visible = next;
    root.classList.toggle("is-visible", next);
  };

  window.addEventListener(
    "pointermove",
    (e) => {
      targetX = e.clientX;
      targetY = e.clientY;
      hoverTarget = e.target instanceof Element ? e.target : null;
      hoverCheck = true;
      if (!seen) {
        // 首次移动：直接落位，避免从窗口中心飞入
        seen = true;
        dotX = frameX = targetX;
        dotY = frameY = targetY;
      }
      setVisible(true);
    },
    { passive: true },
  );
  window.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button === 0) scaleTarget = PRESS_SCALE;
    },
    { passive: true },
  );
  const release = () => {
    scaleTarget = 1;
  };
  window.addEventListener("pointerup", release, { passive: true });
  window.addEventListener("pointercancel", release, { passive: true });
  window.addEventListener("blur", () => {
    release();
    setVisible(false);
  });
  document.documentElement.addEventListener("mouseleave", () =>
    setVisible(false),
  );
  document.addEventListener("mouseout", (e) => {
    if (!e.relatedTarget) setVisible(false);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) setVisible(false);
  });

  const tick = () => {
    const reduced = stage?.classList.contains("reduce-motion") ?? false;
    const dotK = reduced ? 1 : DOT_LERP;
    const frameK = reduced ? 1 : FRAME_LERP;
    dotX += (targetX - dotX) * dotK;
    dotY += (targetY - dotY) * dotK;
    frameX += (targetX - frameX) * frameK;
    frameY += (targetY - frameY) * frameK;
    if (reduced) {
      scale = scaleTarget;
      scaleVelocity = 0;
    } else {
      // 欠阻尼弹簧：按下收缩、松开带回弹地恢复到 1
      scaleVelocity += (scaleTarget - scale) * SPRING_STIFFNESS;
      scaleVelocity *= SPRING_DAMPING;
      scale += scaleVelocity;
    }
    dotLayer.style.transform = `translate3d(${dotX}px, ${dotY}px, 0) scale(${scale})`;
    frameLayer.style.transform = `translate3d(${frameX}px, ${frameY}px, 0) scale(${scale})`;
    if (hoverCheck) {
      hoverCheck = false;
      root.classList.toggle(
        "is-hover",
        hoverTarget !== null && isInteractive(hoverTarget),
      );
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
