import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createArchiveLighting } from "./archive-lighting";
import { damp } from "./motion";
import { ViewerCameraMotion } from "./viewer-camera";
import { normalizeQuality, type RenderQuality } from "./render-quality";
import {
  applyTextureQuality,
  createViewerPipeline,
  resizeQuality,
} from "./quality-renderer";

const PARTS = [
  { id: "fasteners", label: "紧固件", en: "FASTENERS", depth: 2.75 },
  { id: "cover", label: "透明盖板", en: "OPTICAL COVER", depth: 1.85 },
  {
    id: "optical-lenses",
    label: "折射环组",
    en: "REFRACTIVE RINGS",
    depth: 0.75,
  },
  { id: "optical-core", label: "光学核心", en: "OPTICAL CORE", depth: -0.15 },
  { id: "substrate", label: "信息基板", en: "SUBSTRATE", depth: -1.1 },
  { id: "carrier", label: "背板与框架", en: "CARRIER", depth: -2.05 },
] as const;

type ModelSource = { model: THREE.Group; dispose: () => void; setClarity?: (value: number) => void;
  // 画框展板（仅作品档案）：网格清单 + 画框外缘尺寸 + 模型空间中心；
  // print 为画芯网格及其尺寸，聚焦交互只作用于画芯。
  board?: { meshes: THREE.Mesh[]; width: number; height: number; center: THREE.Vector3;
    print?: THREE.Mesh; printWidth: number; printHeight: number } };

const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
export class ModelViewer {
  readonly root: HTMLElement;
  private canvasHost: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private pipeline: ReturnType<typeof createViewerPipeline>;
  private quality = normalizeQuality(undefined);
  private appliedQuality = "";
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.3, 120);
  private controlCamera = this.camera.clone();
  private cameraMotion = new ViewerCameraMotion(this.camera);
  private controls: OrbitControls;
  private source?: ModelSource;
  private groups = new Map<string, THREE.Group>();
  private spread = { value: 0, velocity: 0 };
  private targetSpread = 0;
  private clarity = { value: 1, velocity: 0 };
  private targetClarity = 1;
  private lastTime = 0;
  private request = 0;
  private reduced = false;
  private loading = false;
  private closing = false;
  private transitions: Animation[] = [];
  private transitionId = 0;
  private status = "";
  private opener: HTMLElement | null = null;
  private siblings: { node: HTMLElement; inert: boolean }[] = [];
  private initialCamera = new THREE.Vector3(7.2, 3.8, 12);
  private onClose: () => void;
  private provider?: () => Promise<ModelSource>;
  isOpen = false;
  // —— 画框展板聚焦（仅作品档案，且仅拆解态可用）——
  private board: ModelSource["board"] = undefined;
  private boardHome = new Map<
    THREE.Mesh,
    { pos: THREE.Vector3; scale: THREE.Vector3 }
  >();
  private boardScale = { value: 1, velocity: 0 };
  private boardScaleTarget = 1;
  private boardHover = false;
  private pointerNdc = new THREE.Vector2();
  private pointerInside = false;
  private raycaster = new THREE.Raycaster();
  private downAt: { x: number; y: number } | null = null;
  private focusPhase: "none" | "enter" | "focused" | "exit" = "none";
  private focusT = 0;
  private focusPivot: THREE.Group | null = null;
  private pivotFromQuat = new THREE.Quaternion();
  private pivotToQuat = new THREE.Quaternion();
  private pivotFromPos = new THREE.Vector3();
  private pivotToPos = new THREE.Vector3();
  private focusBaseQuat = new THREE.Quaternion();
  private camFrom = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
  private camTo = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
  private savedView = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
  private spin = { x: 0, y: 0 };
  private spinVel = { x: 0, y: 0 };
  private focusDrag = false;
  private dragLast = { x: 0, y: 0, t: 0 };

  constructor(
    parent: HTMLElement,
    onClose: () => void,
    private onSound: (
      sound: "explode" | "assemble" | "tick",
    ) => void = () => {},
  ) {
    this.onClose = onClose;
    this.root = document.createElement("section");
    this.root.className = "model-viewer";
    this.root.hidden = true;
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-modal", "true");
    this.root.setAttribute("aria-labelledby", "viewer-title");
    this.root.innerHTML = `
      <div class="viewer-canvas"></div>
      <div class="scene-atmosphere viewer-atmosphere" aria-hidden="true"></div>
      <header class="viewer-header">
        <button class="viewer-back" data-viewer="close">← <span>返回档案</span><kbd>ESC</kbd></button>
        <div class="viewer-heading"><span>ZHOUXU.TOP / OBJECT STUDY</span><h2 id="viewer-title">档案模型</h2><p id="viewer-file"></p></div>
        <span class="viewer-index">360<span>°</span></span>
      </header>
      <div class="viewer-surface" role="group" aria-label="玻璃模式"><button data-viewer="clear" aria-pressed="true">清晰</button><button data-viewer="frosted" aria-pressed="false">磨砂</button></div>
      <aside class="viewer-parts" aria-label="模型装配结构"><div>ASSEMBLY / 装配结构</div>${PARTS.map((p, i) => `<p><span>${String(i + 1).padStart(2, "0")}</span><strong>${p.label}</strong><small>${p.en}</small></p>`).join("")}</aside>
      <div class="viewer-loading" role="status"><span>正在载入模型…</span><button data-viewer="retry" hidden>重新载入 ↗</button></div>
      <footer class="viewer-footer">
        <div class="viewer-help"><span>拖动旋转</span><span>↑ ↓ ← → 平移</span><span>滚轮缩放</span></div>
        <div class="viewer-actions"><button data-viewer="explode" aria-pressed="false"><span>＋</span> 拆解档案</button><button data-viewer="assemble" aria-pressed="true"><span>−</span> 一键重组</button></div>
        <button class="viewer-reset" data-viewer="reset">复位视角 <span>↗</span></button>
      </footer>
      <div class="viewer-state" aria-live="polite">已组装</div>`;
    parent.appendChild(this.root);
    this.canvasHost = this.root.querySelector(".viewer-canvas")!;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute(
      "aria-label",
      "档案三维模型：拖动旋转，方向键平移，滚轮或加减键缩放，Home 复位",
    );
    this.canvasHost.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color("#eae5e1");
    this.scene.fog = new THREE.Fog("#eae5e1", 13.5, 26.5);
    // Render-target textures belong to their WebGL context. Recreate the main
    // scene's light room here so this renderer receives its actual illumination.
    createArchiveLighting(this.renderer, this.scene);
    this.camera.position.copy(this.initialCamera);
    this.controlCamera.copy(this.camera);
    this.controls = new OrbitControls(
      this.controlCamera,
      this.renderer.domElement,
    );
    this.controls.enableDamping = false;
    this.pipeline = createViewerPipeline(
      this.renderer,
      this.scene,
      this.camera,
    );
    this.pipeline.smaa.enabled = false;
    this.controls.rotateSpeed = 0.65;
    this.controls.zoomSpeed = 0.7;
    this.controls.panSpeed = 0.7;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 28;
    this.controls.maxTargetRadius = 5;
    this.controls.screenSpacePanning = true;
    this.controls.enabled = false;
    this.controls.update();
    this.cameraMotion.snap(this.controlCamera, this.controls.target);
    this.controls.addEventListener("start", () => this.interruptReset());
    this.root.addEventListener("click", (event) => {
      if (this.closing) return;
      const action = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-viewer]",
      )?.dataset.viewer;
      if (action === "close") this.close();
      if (action === "retry") void this.load();
      if (this.loading || !this.source) return;
      if (action === "clear" || action === "frosted") {
        this.setSurface(action === "clear");
        this.onSound("tick");
      }
      if (action === "explode" && this.targetSpread !== 1) {
        this.setExploded(true);
        this.onSound("explode");
      }
      if (action === "assemble" && this.targetSpread !== 0) {
        this.setExploded(false);
        this.onSound("assemble");
      }
      if (action === "reset") {
        this.resetView();
        this.onSound("tick");
      }
    });
    this.root.addEventListener("keydown", (event) => this.keydown(event));
    // 画框展板悬停/点击/聚焦拖拽（仅作品档案的 source 带 board 时生效）。
    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointermove", (event) => {
      const rect = canvas.getBoundingClientRect();
      this.pointerNdc.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      this.pointerInside = true;
      if (!this.focusDrag) return;
      const now = performance.now();
      const dt = Math.max(1, now - this.dragLast.t) / 1000;
      const dx = (event.clientX - this.dragLast.x) * 0.0052;
      const dy = (event.clientY - this.dragLast.y) * 0.0052;
      this.spin.x += dx;
      this.spin.y += dy;
      // 角速度指数平滑，松手后以此滑行。
      this.spinVel.x = 0.65 * this.spinVel.x + 0.35 * (dx / dt);
      this.spinVel.y = 0.65 * this.spinVel.y + 0.35 * (dy / dt);
      this.dragLast = { x: event.clientX, y: event.clientY, t: now };
      this.applyFocusSpin();
    });
    canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (this.focusPhase === "focused") {
        this.focusDrag = true;
        this.spinVel.x = this.spinVel.y = 0;
        this.dragLast = { x: event.clientX, y: event.clientY, t: performance.now() };
        canvas.setPointerCapture(event.pointerId);
      } else this.downAt = { x: event.clientX, y: event.clientY };
    });
    canvas.addEventListener("pointerup", (event) => {
      if (this.focusDrag) {
        this.focusDrag = false;
      } else if (this.downAt && event.button === 0) {
        // 与旋转拖拽区分：位移小于 6px 才算点击。
        const moved = Math.hypot(
          event.clientX - this.downAt.x,
          event.clientY - this.downAt.y,
        );
        if (moved < 6 && this.boardHover) this.enterFocus();
      }
      this.downAt = null;
    });
    canvas.addEventListener("pointerleave", () => {
      this.pointerInside = false;
    });
    canvas.addEventListener("contextmenu", (event) => {
      if (this.focusPhase === "none") return;
      event.preventDefault();
      if (this.focusPhase === "focused") this.exitFocus();
    });
  }

  open(
    id: string,
    title: string,
    provider: () => Promise<ModelSource>,
    reduced: boolean,
    partLabels?: Partial<Record<string, { label: string; en: string }>>,
  ) {
    if (this.isOpen) return;
    this.isOpen = true;
    this.closing = false;
    this.reduced = reduced;
    this.provider = provider;
    this.opener = document.activeElement as HTMLElement | null;
    this.siblings = [...this.root.parentElement!.children]
      .filter(
        (node): node is HTMLElement =>
          node instanceof HTMLElement && node !== this.root,
      )
      .map((node) => ({ node, inert: node.inert }));
    this.siblings.forEach(({ node }) => (node.inert = true));
    this.root.hidden = false;
    this.root.dataset.transition = "opening";
    this.root.querySelector("#viewer-title")!.textContent = title;
    this.root.querySelector("#viewer-file")!.textContent =
      "FILE " + id + " / PERSONAL ARCHIVE";
    this.renderParts(partLabels);
    this.resetFocus();
    this.board = undefined;
    this.boardHome.clear();
    this.spread = { value: 0, velocity: 0 };
    this.targetSpread = 0;
    this.clarity = { value: 1, velocity: 0 };
    this.setSurface(true);
    this.lastTime = 0;
    this.root.dataset.exploded = "false";
    this.resetView(false);
    this.resize();
    this.renderer.domElement.focus({ preventScroll: true });
    this.enter();
    void this.load();
  }

  // 每次打开时重渲染部件清单：作品档案可覆盖光学部件的命名。
  private renderParts(
    partLabels?: Partial<Record<string, { label: string; en: string }>>,
  ) {
    const aside = this.root.querySelector<HTMLElement>(".viewer-parts")!;
    aside.innerHTML = `<div>ASSEMBLY / 装配结构</div>${PARTS.map(
      (p, i) =>
        `<p><span>${String(i + 1).padStart(2, "0")}</span><strong>${partLabels?.[p.id]?.label ?? p.label}</strong><small>${partLabels?.[p.id]?.en ?? p.en}</small></p>`,
    ).join("")}`;
  }

  private async load() {
    if (!this.provider || this.loading) return;
    const ticket = ++this.request;
    this.loading = true;
    this.controls.enabled = false;
    const loading = this.root.querySelector<HTMLElement>(".viewer-loading")!;
    loading.hidden = false;
    loading.querySelector("span")!.textContent = "正在载入模型…";
    loading.querySelector<HTMLElement>("button")!.hidden = true;
    this.setButtonsDisabled(true);
    try {
      const source = await this.provider();
      if (!this.isOpen || this.closing || ticket !== this.request) {
        source.dispose();
        return;
      }
      this.source = source;
      for (const part of PARTS) {
        const group = new THREE.Group();
        group.name = part.id;
        this.groups.set(part.id, group);
      }
      for (const child of [...source.model.children]) {
        const group = this.groups.get(child.userData.assemblyPart ?? "cover");
        group?.add(child);
      }
      for (const group of this.groups.values()) source.model.add(group);
      source.model.position.set(0, -1.85, 0);
      this.scene.add(source.model);
      // 画框展板：记录装配态局部坐标与缩放（缩放编码了画芯宽高，必须一并保存），
      // 悬停缩放与聚焦还原以此为基准。
      this.board = source.board;
      if (this.board)
        for (const mesh of this.board.meshes)
          this.boardHome.set(mesh, {
            pos: mesh.position.clone(),
            scale: mesh.scale.clone(),
          });
      applyTextureQuality(source.model, this.renderer, this.quality);
      this.loading = false;
      loading.hidden = true;
      this.controls.enabled = true;
      this.setButtonsDisabled(false);
      this.setExploded(false);
      this.setStatus("已组装");
      // Render before revealing the canvas so a new model never flashes in.
      this.update(this.lastTime);
      if (!this.reduced)
        this.transitions.push(
          this.canvasHost.animate(
            [
              { opacity: 0, transform: "scale(0.97)" },
              { opacity: 1, transform: "scale(1)" },
            ],
            { duration: 380, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
          ),
        );
    } catch (error) {
      if (!this.isOpen || this.closing || ticket !== this.request) return;
      this.loading = false;
      loading.querySelector("span")!.textContent = "模型载入失败，请重试";
      loading.querySelector<HTMLElement>("button")!.hidden = false;
      console.error("Model viewer failed to load", error);
    }
  }

  private enter() {
    const ticket = ++this.transitionId;
    this.transitions.forEach((animation) => animation.cancel());
    this.transitions = [];
    if (this.reduced) {
      this.root.dataset.transition = "open";
      return;
    }
    const fade = this.root.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 320,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    });
    this.transitions.push(fade);
    for (const selector of [
      ".viewer-header",
      ".viewer-footer",
      ".viewer-state",
    ]) {
      const element = this.root.querySelector<HTMLElement>(selector)!;
      this.transitions.push(
        element.animate(
          [
            { opacity: 0, translate: "0 10px" },
            { opacity: 1, translate: "0 0" },
          ],
          {
            duration: 300,
            delay: 60,
            fill: "backwards",
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          },
        ),
      );
    }
    void fade.finished
      .then(() => {
        if (ticket === this.transitionId) this.root.dataset.transition = "open";
      })
      .catch(() => {});
  }

  close() {
    if (!this.isOpen || this.closing) return;
    this.closing = true;
    // 聚焦态直接随关闭流程清理（展板网格由 source.dispose 统一销毁）。
    this.resetFocus();
    this.request++;
    this.loading = false;
    this.controls.enabled = false;
    this.setButtonsDisabled(true);
    const ticket = ++this.transitionId;
    // Capture the current fade when Escape interrupts opening.
    const opacity = getComputedStyle(this.root).opacity;
    const canvasStyle = getComputedStyle(this.canvasHost);
    const canvasOpacity = canvasStyle.opacity;
    const transform = canvasStyle.transform;
    this.transitions.forEach((animation) => animation.cancel());
    this.transitions = [];
    this.root.dataset.transition = "closing";
    if (this.reduced) {
      this.finishClose();
      return;
    }
    const fade = this.root.animate([{ opacity }, { opacity: 0 }], {
      duration: 220,
      easing: "cubic-bezier(0.4, 0, 1, 1)",
      fill: "forwards",
    });
    this.transitions.push(
      fade,
      this.canvasHost.animate(
        [
          { transform, opacity: canvasOpacity },
          { transform: "scale(0.97)", opacity: 0 },
        ],
        {
          duration: 220,
          easing: "cubic-bezier(0.4, 0, 1, 1)",
          fill: "forwards",
        },
      ),
    );
    void fade.finished
      .then(() => {
        if (ticket === this.transitionId) this.finishClose();
      })
      .catch(() => {});
  }

  private finishClose() {
    // Keep rendering and retain modal focus until the visible exit completes.
    this.isOpen = false;
    this.closing = false;
    this.root.hidden = true;
    this.transitions.forEach((animation) => animation.cancel());
    this.transitions = [];
    if (this.source) {
      this.scene.remove(this.source.model);
      this.source.dispose();
      this.source = undefined;
    }
    this.board = undefined;
    this.boardHome.clear();
    this.groups.clear();
    this.siblings.forEach(({ node, inert }) => (node.inert = inert));
    this.siblings = [];
    this.opener?.focus({ preventScroll: true });
    this.onClose();
  }

  private setButtonsDisabled(disabled: boolean) {
    for (const action of ["explode", "assemble", "reset", "clear", "frosted"]) {
      this.root.querySelector<HTMLButtonElement>(
        `[data-viewer="${action}"]`,
      )!.disabled = disabled;
    }
  }
  private setSurface(clear: boolean) {
    this.targetClarity = clear ? 1 : 0;
    this.root.dataset.surface = clear ? "clear" : "frosted";
    this.root.querySelector('[data-viewer="clear"]')!.setAttribute("aria-pressed", String(clear));
    this.root.querySelector('[data-viewer="frosted"]')!.setAttribute("aria-pressed", String(!clear));
    if (this.reduced) this.clarity = { value: this.targetClarity, velocity: 0 };
  }
  private setExploded(value: boolean) {
    this.targetSpread = value ? 1 : 0;
    this.root.dataset.exploded = String(value);
    this.root
      .querySelector('[data-viewer="explode"]')!
      .setAttribute("aria-pressed", String(value));
    this.root
      .querySelector('[data-viewer="assemble"]')!
      .setAttribute("aria-pressed", String(!value));
    this.setStatus(
      value ? "正在拆解" : this.spread.value > 0.001 ? "正在重组" : "已组装",
    );
    if (this.reduced) this.spread = { value: this.targetSpread, velocity: 0 };
  }
  private setStatus(value: string) {
    if (value !== this.status) {
      this.status = value;
      this.root.querySelector(".viewer-state")!.textContent = value;
    }
  }
  private resetView(animated = true) {
    this.controls.enabled = false;
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.target.set(0, 0, 0);
    this.controlCamera.position.copy(this.initialCamera);
    this.controls.enableDamping = false;
    this.controls.update();
    if (animated && !this.reduced) this.cameraMotion.reset();
    else this.cameraMotion.snap(this.controlCamera, this.controls.target);
    this.controls.enabled =
      this.isOpen && !this.loading && Boolean(this.source);
  }
  private interruptReset() {
    if (!this.cameraMotion.resetting) return;
    this.cameraMotion.interruptReset(this.controlCamera, this.controls.target);
    this.controls.update();
  }
  // —— 画框展板聚焦状态机（默认态 → 悬停态 → 聚焦态 → 还原，仅拆解态可用）——
  // 悬停放大：只作用于画芯，围绕画芯自身中心缩放（缩放必须叠在编码了宽高的
  // home scale 上，不能 setScalar 覆盖，否则画面比例被破坏）。
  private applyBoardScale(scale: number) {
    const print = this.board?.print;
    if (!print) return;
    if (this.focusPivot) {
      this.focusPivot.scale.setScalar(scale);
      return;
    }
    const home = this.boardHome.get(print);
    if (!home) return;
    print.scale.set(
      home.scale.x * scale,
      home.scale.y * scale,
      home.scale.z * scale,
    );
  }
  // 作品画面完整居中充满主要视野的相机距离（留 12% 呼吸边距）。
  private fitDistance(width: number, height: number) {
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    return (
      Math.max(
        height / 2 / Math.tan(vFov / 2),
        width / 2 / Math.tan(hFov / 2),
      ) * 1.12 + 0.2
    );
  }
  private applyFocusSpin() {
    if (!this.focusPivot) return;
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(this.spin.y, this.spin.x, 0, "YXZ"),
    );
    this.focusPivot.quaternion.copy(q).multiply(this.focusBaseQuat);
  }
  private enterFocus() {
    const print = this.board?.print;
    if (!print || !this.board || !this.source || this.focusPhase !== "none")
      return;
    // 仅拆解态可聚焦：装配态的悬停/点击不触发聚焦。
    if (this.targetSpread !== 1 || this.spread.value < 0.99) return;
    this.focusPhase = "enter";
    this.focusT = 0;
    this.savedView.pos.copy(this.controlCamera.position);
    this.savedView.target.copy(this.controls.target);
    this.controls.enabled = false;
    // 聚焦时放开 OrbitControls 最小距离（其 update 每帧都会夹取距离），
    // 退出聚焦后恢复原值。
    this.controls.minDistance = 1;
    for (const action of ["explode", "assemble", "reset"])
      this.root.querySelector<HTMLButtonElement>(
        `[data-viewer="${action}"]`,
      )!.disabled = true;
    this.setStatus("聚焦预览");
    this.onSound("tick");
    // 悬停弹簧归位到 pivot：画芯先恢复原始缩放，缩放由 pivot 平滑接管。
    this.boardHover = false;
    this.boardScaleTarget = 1;
    this.renderer.domElement.style.cursor = "";
    const pivotScale = this.boardScale.value;
    this.applyBoardScale(1);
    // 画芯当前世界中心（拆解态：部件组已沿 z 分开，attach 自动保留世界变换）。
    const center = new THREE.Box3()
      .setFromObject(print)
      .getCenter(new THREE.Vector3());
    const pivot = new THREE.Group();
    this.scene.add(pivot);
    pivot.position.copy(center);
    pivot.attach(print);
    pivot.scale.setScalar(pivotScale);
    this.focusPivot = pivot;
    this.pivotFromQuat.copy(pivot.quaternion);
    this.pivotFromPos.copy(center);
    // 目标位：装配结构上方——画芯抬升到装配体包围盒顶部之上，保持居中。
    const bounds = new THREE.Box3().setFromObject(this.source.model);
    const targetCenter = new THREE.Vector3(
      0,
      bounds.max.y + this.board.printHeight / 2 + 0.4,
      0,
    );
    this.pivotToPos.copy(targetCenter);
    // 相机沿当前视线方向推近；画芯旋转至正对镜头（面向 +z 的平面与相机同向）。
    const dir = this.camera.position.clone().sub(center).normalize();
    const fit = this.fitDistance(
      this.board.printWidth,
      this.board.printHeight,
    );
    this.camFrom.pos.copy(this.controlCamera.position);
    this.camFrom.target.copy(this.controls.target);
    this.camTo.pos.copy(targetCenter).addScaledVector(dir, fit);
    this.camTo.target.copy(targetCenter);
    const goal = this.camera.clone();
    goal.position.copy(this.camTo.pos);
    goal.lookAt(targetCenter);
    this.pivotToQuat.copy(goal.quaternion);
    this.focusBaseQuat.copy(goal.quaternion);
    this.spin.x = this.spin.y = 0;
    this.spinVel.x = this.spinVel.y = 0;
  }
  private exitFocus() {
    if (this.focusPhase !== "enter" && this.focusPhase !== "focused") return;
    this.focusPhase = "exit";
    this.focusT = 0;
    this.focusDrag = false;
    this.spinVel.x = this.spinVel.y = 0;
    // 退出起点即当前 pivot/相机状态（含用户拖拽角度），终点回到拆解态原位。
    if (this.focusPivot) {
      this.pivotFromQuat.copy(this.focusPivot.quaternion);
      this.pivotFromPos.copy(this.focusPivot.position);
    }
    this.pivotToQuat.identity();
    // 终点：画芯在拆解态下的原始世界位置（home.pos 是其部件组内的局部坐标）。
    const print = this.board?.print;
    const home = print ? this.boardHome.get(print) : undefined;
    const group = print
      ? this.groups.get(print.userData.assemblyPart ?? "cover")
      : undefined;
    if (home && group) this.pivotToPos.copy(group.localToWorld(home.pos.clone()));
    else this.pivotToPos.copy(this.savedView.target);
    this.camFrom.pos.copy(this.controlCamera.position);
    this.camFrom.target.copy(this.controls.target);
    this.camTo.pos.copy(this.savedView.pos);
    this.camTo.target.copy(this.savedView.target);
  }
  private finishExitFocus() {
    // 画芯挂回部件组并还原拆解态原位变换（pivot 上可能残留用户拖拽角度）。
    const print = this.board?.print;
    if (this.focusPivot && print) {
      const parent = this.groups.get(print.userData.assemblyPart ?? "cover");
      const home = this.boardHome.get(print);
      if (parent) parent.add(print);
      if (home) {
        print.position.copy(home.pos);
        print.scale.copy(home.scale);
      }
      print.quaternion.identity();
      this.scene.remove(this.focusPivot);
    }
    this.focusPivot = null;
    this.focusPhase = "none";
    this.boardScale = { value: 1, velocity: 0 };
    this.boardScaleTarget = 1;
    delete this.root.dataset.focus;
    this.controls.minDistance = 5;
    this.controlCamera.position.copy(this.savedView.pos);
    this.controls.target.copy(this.savedView.target);
    this.controls.update();
    this.cameraMotion.snap(this.controlCamera, this.controls.target);
    this.controls.enabled = this.isOpen && !this.loading && Boolean(this.source);
    if (this.isOpen && !this.loading && this.source) {
      for (const action of ["explode", "assemble", "reset"])
        this.root.querySelector<HTMLButtonElement>(
          `[data-viewer="${action}"]`,
        )!.disabled = false;
      this.setStatus("已拆解");
    }
  }
  // 关闭/重开时的聚焦清理：展板网格随 source.dispose 统一销毁，无需挂回。
  private resetFocus() {
    if (this.focusPivot) {
      this.scene.remove(this.focusPivot);
      this.focusPivot = null;
    }
    this.focusPhase = "none";
    this.focusDrag = false;
    this.boardHover = false;
    this.boardScale = { value: 1, velocity: 0 };
    this.boardScaleTarget = 1;
    this.renderer.domElement.style.cursor = "";
    delete this.root.dataset.focus;
  }
  private keydown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      // 聚焦态下 Esc 只退出聚焦，再按才关闭查看器。
      if (this.focusPhase === "enter" || this.focusPhase === "focused") {
        this.exitFocus();
        return;
      }
      if (this.focusPhase === "exit") return;
      this.close();
      return;
    }
    if (this.closing) {
      event.preventDefault();
      return;
    }
    if (event.key === "Tab") {
      const elements = [
        ...this.root.querySelectorAll<HTMLElement>(
          'button:not([disabled]):not([hidden]),canvas[tabindex="0"]',
        ),
      ];
      const first = elements[0],
        last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
      return;
    }
    if (!this.source || this.loading) return;
    // 聚焦态屏蔽视角复位/缩放/平移键（Tab 焦点循环仍可用）。
    if (this.focusPhase !== "none") {
      event.preventDefault();
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      this.resetView();
      this.onSound("tick");
      return;
    }
    if (["+", "=", "-"].includes(event.key)) {
      event.preventDefault();
      this.interruptReset();
      const distance = this.controlCamera.position.distanceTo(
        this.controls.target,
      );
      const next = THREE.MathUtils.clamp(
        distance * (event.key === "-" ? 1.12 : 1 / 1.12),
        5,
        28,
      );
      this.controlCamera.position
        .sub(this.controls.target)
        .multiplyScalar(next / distance)
        .add(this.controls.target);
      this.controls.update();
      return;
    }
    if (
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    ) {
      event.preventDefault();
      this.interruptReset();
      const right = new THREE.Vector3().setFromMatrixColumn(
        this.camera.matrix,
        0,
      );
      const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
      const delta = new THREE.Vector3();
      const step =
        this.controlCamera.position.distanceTo(this.controls.target) * 0.025;
      if (event.key === "ArrowLeft") delta.addScaledVector(right, -step);
      if (event.key === "ArrowRight") delta.addScaledVector(right, step);
      if (event.key === "ArrowUp") delta.addScaledVector(up, step);
      if (event.key === "ArrowDown") delta.addScaledVector(up, -step);
      // Clamp the requested focus before moving the camera by the same amount.
      // This preserves orbit radius at the panning limit.
      const previous = this.controls.target.clone();
      this.controls.target.add(delta);
      this.controls.target.clampLength(0, this.controls.maxTargetRadius);
      this.controlCamera.position.add(
        this.controls.target.clone().sub(previous),
      );
      this.controls.update();
    }
  }

  setQuality(quality: RenderQuality) {
    const key = JSON.stringify(quality);
    if (this.appliedQuality === key) return;
    this.appliedQuality = key;
    this.quality = normalizeQuality(quality);
    this.pipeline.smaa.enabled = this.quality.antialias === "smaa";
    applyTextureQuality(this.scene, this.renderer, this.quality);
    this.resize();
  }

  resize() {
    if (!this.isOpen) return;
    const width = this.canvasHost.clientWidth,
      height = this.canvasHost.clientHeight;
    resizeQuality(
      this.renderer,
      this.pipeline.composer,
      this.canvasHost,
      this.quality,
    );
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.controlCamera.aspect = this.camera.aspect;
    this.controlCamera.updateProjectionMatrix();
  }

  update(time: number) {
    if (!this.isOpen) return;
    const dt = Math.min(this.lastTime ? time - this.lastTime : 1 / 60, 0.05);
    this.lastTime = time;
    if (this.source) {
      damp(this.clarity, this.targetClarity, 8, dt);
      if (Math.abs(this.clarity.value - this.targetClarity) < .0001 && Math.abs(this.clarity.velocity) < .001)
        this.clarity = { value: this.targetClarity, velocity: 0 };
      this.source.setClarity?.(this.clarity.value);
      damp(this.spread, this.targetSpread, this.reduced ? 45 : 5.5, dt);
      if (
        Math.abs(this.spread.value - this.targetSpread) < 0.0001 &&
        Math.abs(this.spread.velocity) < 0.001
      ) {
        this.spread = { value: this.targetSpread, velocity: 0 };
        this.setStatus(this.targetSpread ? "已拆解" : "已组装");
      }
      for (const part of PARTS) {
        this.groups.get(part.id)!.position.z = part.depth * this.spread.value;
      }
    }
    // —— 画框展板：悬停检测 → 缩放弹簧 → 聚焦补间/惯性 ——
    if (this.board?.print && this.focusPhase === "none" && !this.loading) {
      const exploded =
        this.targetSpread === 1 && this.spread.value > 0.99;
      let hit = false;
      if (exploded && this.pointerInside) {
        this.raycaster.setFromCamera(this.pointerNdc, this.camera);
        hit =
          this.raycaster.intersectObject(this.board.print, false).length > 0;
      }
      if (hit !== this.boardHover) {
        this.boardHover = hit;
        this.boardScaleTarget = hit ? 1.1 : 1;
        // 复用自定义指针的“可点击”判定：canvas inline cursor 为 pointer 即切换。
        this.renderer.domElement.style.cursor = hit ? "pointer" : "";
      }
    }
    if (this.board) {
      damp(this.boardScale, this.boardScaleTarget, 9, dt);
      if (
        Math.abs(this.boardScale.value - this.boardScaleTarget) < 0.0005 &&
        Math.abs(this.boardScale.velocity) < 0.005
      )
        this.boardScale = { value: this.boardScaleTarget, velocity: 0 };
      if (this.boardScale.value !== 1 || this.focusPivot)
        this.applyBoardScale(this.boardScale.value);
    }
    if (this.focusPhase === "enter" || this.focusPhase === "exit") {
      this.focusT = Math.min(1, this.focusT + dt / 0.7);
      const p = this.reduced ? 1 : easeInOutCubic(this.focusT);
      if (this.focusPivot) {
        this.focusPivot.quaternion.slerpQuaternions(
          this.pivotFromQuat,
          this.pivotToQuat,
          p,
        );
        this.focusPivot.position.lerpVectors(
          this.pivotFromPos,
          this.pivotToPos,
          p,
        );
      }
      this.controlCamera.position.lerpVectors(
        this.camFrom.pos,
        this.camTo.pos,
        p,
      );
      this.controls.target.lerpVectors(
        this.camFrom.target,
        this.camTo.target,
        p,
      );
      this.controls.update();
      this.cameraMotion.snap(this.controlCamera, this.controls.target);
      if (this.focusT === 1) {
        if (this.focusPhase === "enter") this.focusPhase = "focused";
        else this.finishExitFocus();
      }
    } else if (this.focusPhase === "focused" && !this.focusDrag) {
      // 松手后的角速度指数衰减滑行，最终保持当前角度。
      if (
        Math.abs(this.spinVel.x) > 0.002 ||
        Math.abs(this.spinVel.y) > 0.002
      ) {
        this.spin.x += this.spinVel.x * dt;
        this.spin.y += this.spinVel.y * dt;
        const decay = Math.exp(-3.2 * dt);
        this.spinVel.x *= decay;
        this.spinVel.y *= decay;
        this.applyFocusSpin();
      }
    }
    this.controls.update();
    this.cameraMotion.update(
      this.controlCamera,
      this.controls.target,
      dt,
      this.reduced,
    );
    // Match the detail scene's gentle haze without washing out the object as
    // the user zooms. The assembled model is centered on the world origin.
    const fog = this.scene.fog as THREE.Fog;
    const objectDistance = this.camera.position.length();
    fog.near = Math.max(0, objectDistance - 1);
    fog.far = objectDistance + 12;
    if (this.quality.antialias === "smaa") this.pipeline.composer.render();
    else this.renderer.render(this.scene, this.camera);
    this.root.dataset.stats = JSON.stringify({
      ready: Boolean(this.source),
      clarity: this.clarity.value,
      targetClarity: this.targetClarity,
      spread: this.spread.value,
      target: this.targetSpread,
      distance: this.camera.position.distanceTo(this.cameraMotion.focus),
      targetPosition: this.cameraMotion.focus.toArray(),
      requestedTarget: this.controls.target.toArray(),
      requestedDistance: this.controlCamera.position.distanceTo(
        this.controls.target,
      ),
      cameraPosition: this.camera.position.toArray(),
      resetting: this.cameraMotion.resetting,
      azimuth: this.controls.getAzimuthalAngle(),
      polar: this.controls.getPolarAngle(),
      parts: [...this.groups].map(([id, group]) => ({
        id,
        z: group.position.z,
        meshes: group.children.length,
      })),
    });
  }
}
