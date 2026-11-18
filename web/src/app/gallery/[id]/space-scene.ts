import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";

import type { Layout, Photo, Placement } from "@/lib/api";
import {
  ahead,
  alongPath,
  cardSize,
  clampPlacement,
  clampStep,
  entrance,
  EYE_H,
  fitView,
  HALL_START,
  keepInside,
  lookBy,
  planeHit,
  type Stance,
  stance,
  tapStep,
  type Vec3,
  walkIntent,
} from "@/lib/space";

import { buildRoom, WALL } from "./room";

export interface SceneEvents {
  onSelect: (id: string | null) => void;
  onMove: (id: string, p: Placement) => void;
  onOpen: (id: string) => void;
}

type Drag = {
  id: string;
  pointer: number;
  from: Vector2;
  start: Placement;
  mode: "move" | "depth" | "turn";
  plane: { point: Vec3; normal: Vec3 };
  grab: Vec3;
  moved: boolean;
};

type Glide = { path: Stance[]; start: number; ms: number };

interface Card {
  photo: Photo;
  group: Group;
  body: Mesh<BoxGeometry, MeshLambertMaterial>;
  image: Mesh<PlaneGeometry, MeshBasicMaterial>;
  outline: Mesh<PlaneGeometry, MeshBasicMaterial>;
  shadow: Mesh<CircleGeometry, MeshBasicMaterial>;
  placement: Placement;
}

const FOV = 50;
// fingers wobble more than mice
const TAP_SLOP_PX = 4;
const TOUCH_SLOP_PX = 10;
const SEL = "#316ac5";
const PAPER = "#f3f1ea";
const THICK = 4;
const OUTLINE = 10;
const DEG = Math.PI / 180;
// world units and degrees per second
const WALK_SPEED = 800;
const TURN_SPEED = 90;
const FAST = 2.5;
const GLIDE_SPEED = 2000;
const ENTRY_SPEED = 1100;
// world units per pixel
const PINCH_SPEED = 4;
const WHEEL_SPEED = 1.5;
const WALK_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/**
 * A photo as a texture. If the CORS check fails, fetch again past the HTTP cache: an
 * `immutable` copy cached without the CORS header would otherwise fail forever.
 */
export async function loadPhoto(url: string): Promise<Texture> {
  const get = async (cache: RequestCache) => {
    const res = await fetch(url, { mode: "cors", cache });
    if (!res.ok) throw new Error(`${res.status} loading photo`);
    return res.blob();
  };
  const blob = await get("default").catch(() => get("reload"));
  const tex = new Texture(await createImageBitmap(blob, { imageOrientation: "flipY" }));
  // the bitmap is already flipped
  tex.flipY = false;
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function freeTexture(tex: Texture) {
  if (tex.image instanceof ImageBitmap) tex.image.close();
  tex.dispose();
}

function shadowTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(40,25,10,0.45)");
    g.addColorStop(1, "rgba(40,25,10,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  return new CanvasTexture(canvas);
}

/** The 3D canvas. Owns the WebGL side; React owns the layout and hands it in via `sync`. */
export class SpaceScene {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(FOV, 1, 10, 30000);
  private raycaster = new Raycaster();
  private shadowTex = shadowTexture();
  private cards = new Map<string, Card>();
  private selected: string | null = null;
  private stalk: Line;
  private drag: Drag | null = null;
  private empty: { from: Vector2; pointer: number } | null = null;
  private me: Stance = HALL_START;
  private touches = new Map<number, Vector2>();
  private look: { pointer: number; last: Vector2 } | null = null;
  private pinch: number | null = null;
  private held = new Set<string>();
  private glide: Glide | null = null;
  private last = 0;
  private dirty = true;
  private frame = 0;
  private resize: ResizeObserver;
  private fitted = false;
  private entered = false;
  private disposed = false;

  constructor(
    private container: HTMLElement,
    private events: SceneEvents,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.className = "space-canvas";
    container.prepend(this.renderer.domElement);

    this.scene.background = new Color(WALL);
    this.scene.add(buildRoom());

    // line from the selected photo down to the floor, so you can tell how far back it is
    this.stalk = new Line(
      new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]),
      new LineBasicMaterial({ color: SEL }),
    );
    this.stalk.visible = false;
    this.scene.add(this.stalk);

    this.aim();

    container.addEventListener("pointerdown", this.onDown, true);
    container.addEventListener("pointermove", this.onMove);
    container.addEventListener("pointerup", this.onUp);
    container.addEventListener("pointercancel", this.onUp);
    container.addEventListener("dblclick", this.onDoubleClick);
    container.addEventListener("wheel", this.onWheel, { passive: false });
    container.addEventListener("keydown", this.onKeyDown);
    container.addEventListener("keyup", this.onKeyUp);
    container.addEventListener("blur", this.onBlur);

    this.resize = new ResizeObserver(() => this.fitSize());
    this.resize.observe(container);
    this.fitSize();
    this.loop();
  }

  sync(photos: Photo[], layout: Layout, selected: string | null) {
    const ids = new Set(photos.map((p) => p.id));
    for (const [id, card] of this.cards) {
      if (!ids.has(id) || !layout[id]) this.drop(id, card);
    }
    for (const photo of photos) {
      const p = layout[photo.id];
      if (!p) continue;
      const card = this.cards.get(photo.id) ?? this.add(photo);
      if (this.drag?.id !== photo.id) this.place(card, p);
    }
    this.select(selected);
    if (!this.entered || (!this.fitted && this.cards.size)) {
      this.fitted = this.cards.size > 0;
      this.fit(layout, photos);
    }
    this.invalidate();
  }

  /** Head for the spot that takes in every photo: in through the door the first time. */
  private fit(layout: Layout, photos: Photo[]) {
    const { width, height } = this.container.getBoundingClientRect();
    const to = stance(fitView(layout, photos, FOV, width / Math.max(height, 1) || 1.5));
    const path = this.entered ? [this.me, keepInside(to)] : entrance(to);
    this.entered = true;
    const end = path[path.length - 1];
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.glide = null;
      this.me = end;
      this.aim();
      return;
    }
    this.me = path[0];
    this.aim();
    const dist = path
      .slice(1)
      .reduce((d, b, i) => d + Math.hypot(b.x - path[i].x, b.z - path[i].z), 0);
    this.glide = {
      path,
      start: performance.now(),
      ms: Math.min(6000, Math.max(800, (dist / ENTRY_SPEED) * 1000)),
    };
  }

  /** Where the camera sits, in world units. */
  eye(): Vec3 {
    const { x, y, z } = this.camera.position;
    return { x, y, z };
  }

  /** Which way round the vertical you're facing, in degrees (0 = looking down -z). */
  viewYaw(): number {
    return this.me.yaw;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.container.removeEventListener("pointerdown", this.onDown, true);
    this.container.removeEventListener("pointermove", this.onMove);
    this.container.removeEventListener("pointerup", this.onUp);
    this.container.removeEventListener("pointercancel", this.onUp);
    this.container.removeEventListener("dblclick", this.onDoubleClick);
    this.container.removeEventListener("wheel", this.onWheel);
    this.container.removeEventListener("keydown", this.onKeyDown);
    this.container.removeEventListener("keyup", this.onKeyUp);
    this.container.removeEventListener("blur", this.onBlur);
    for (const [id, card] of this.cards) this.drop(id, card);
    this.shadowTex.dispose();
    this.scene.traverse((o) => {
      if (o instanceof Mesh || o instanceof Line) {
        o.geometry.dispose();
        o.material.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // --- cards ---

  private add(photo: Photo): Card {
    const { w, h } = cardSize(photo);
    const group = new Group();
    group.rotation.order = "YXZ";
    group.userData.id = photo.id;

    // back and edges of the print; also what pointer picks hit
    const body = new Mesh(new BoxGeometry(w, h, THICK), new MeshLambertMaterial({ color: PAPER }));
    body.userData.id = photo.id;
    group.add(body);

    const image = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: "#d8d2c4" }));
    image.position.z = THICK / 2 + 0.2;
    group.add(image);
    loadPhoto(photo.display_url).then(
      (tex) => this.setTexture(photo.id, tex),
      (err) => console.warn(`3D canvas: couldn't load photo ${photo.id}`, err),
    );

    // selection ring: sticks out past the edges, hidden unless selected
    const outline = new Mesh(
      new PlaneGeometry(w + 2 * OUTLINE, h + 2 * OUTLINE),
      new MeshBasicMaterial({ color: SEL, side: DoubleSide }),
    );
    outline.visible = false;
    group.add(outline);

    const shadow = new Mesh(
      new CircleGeometry(w * 0.6, 32),
      new MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    this.scene.add(shadow);

    this.scene.add(group);
    const card: Card = {
      photo,
      group,
      body,
      image,
      outline,
      shadow,
      placement: { x: 0, y: 0, z: 0, yaw: 0, r: 0, s: 1 },
    };
    this.cards.set(photo.id, card);
    return card;
  }

  private setTexture(id: string, tex: Texture) {
    const card = this.cards.get(id);
    if (!card || this.disposed) {
      freeTexture(tex);
      return;
    }
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    card.image.material.map = tex;
    card.image.material.color.set("#ffffff");
    card.image.material.needsUpdate = true;
    this.invalidate();
  }

  private drop(id: string, card: Card) {
    this.scene.remove(card.group, card.shadow);
    for (const mesh of [card.body, card.image, card.outline]) {
      mesh.geometry.dispose();
      if (mesh.material.map) freeTexture(mesh.material.map);
      mesh.material.dispose();
    }
    card.shadow.geometry.dispose();
    card.shadow.material.dispose();
    this.cards.delete(id);
    if (this.selected === id) this.selected = null;
  }

  private place(card: Card, p: Placement) {
    card.placement = p;
    card.group.position.set(p.x, p.y, p.z);
    card.group.rotation.set(0, p.yaw * DEG, -p.r * DEG);
    card.group.scale.setScalar(p.s);
    card.shadow.position.set(p.x, 1 + Math.min(p.y, 200) * 0.002, p.z);
    card.shadow.scale.setScalar(p.s * (1 + p.y / 2000));
    if (this.selected === card.photo.id) this.moveStalk(card);
    this.invalidate();
  }

  private select(id: string | null) {
    if (this.selected === id) return;
    const prev = this.selected && this.cards.get(this.selected);
    if (prev) prev.outline.visible = false;
    this.selected = id && this.cards.has(id) ? id : null;
    const card = this.selected && this.cards.get(this.selected);
    this.stalk.visible = Boolean(card);
    if (card) {
      card.outline.visible = true;
      this.moveStalk(card);
    }
    this.invalidate();
  }

  private moveStalk(card: Card) {
    const { x, y, z } = card.group.position;
    this.stalk.geometry.setFromPoints([new Vector3(x, y, z), new Vector3(x, 0, z)]);
  }

  // --- pointer ---

  private ray(e: PointerEvent | MouseEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray;
  }

  private pick(e: PointerEvent | MouseEvent): { id: string; point: Vec3 } | null {
    this.ray(e);
    const bodies = [...this.cards.values()].map((c) => c.body);
    const hit = this.raycaster.intersectObjects(bodies, false)[0];
    return hit ? { id: hit.object.userData.id as string, point: hit.point } : null;
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0 || e.target !== this.renderer.domElement) return;
    this.touches.set(e.pointerId, new Vector2(e.clientX, e.clientY));
    this.container.setPointerCapture(e.pointerId);
    this.glide = null;
    // so the arrow keys walk
    this.container.focus({ preventScroll: true });
    if (this.touches.size === 2 && !this.drag) {
      // two fingers pinch to step forward or back; never a tap or a look
      const [a, b] = this.touches.values();
      this.pinch = a.distanceTo(b);
      this.empty = this.look = null;
      return;
    }
    if (this.touches.size > 1) return;
    const hit = this.pick(e);
    if (!hit) {
      this.empty = { from: new Vector2(e.clientX, e.clientY), pointer: e.pointerId };
      this.look = { pointer: e.pointerId, last: new Vector2(e.clientX, e.clientY) };
      return;
    }
    const card = this.cards.get(hit.id)!;
    const pos = card.group.position;
    const mode = e.altKey ? "turn" : e.shiftKey ? "depth" : "move";
    const look = this.camera.getWorldDirection(new Vector3());
    const normal = mode === "depth" ? { x: 0, y: 1, z: 0 } : { x: look.x, y: look.y, z: look.z };
    const point = { x: pos.x, y: pos.y, z: pos.z };
    const ray = this.raycaster.ray;
    const at = planeHit(ray.origin, ray.direction, point, normal) ?? point;
    this.drag = {
      id: hit.id,
      pointer: e.pointerId,
      from: new Vector2(e.clientX, e.clientY),
      start: card.placement,
      mode,
      plane: { point, normal },
      grab: { x: at.x - pos.x, y: at.y - pos.y, z: at.z - pos.z },
      moved: false,
    };
    this.events.onSelect(hit.id);
  };

  private onMove = (e: PointerEvent) => {
    this.touches.get(e.pointerId)?.set(e.clientX, e.clientY);
    if (this.pinch !== null && this.touches.size >= 2) {
      const [a, b] = this.touches.values();
      const dist = a.distanceTo(b);
      this.stepForward((dist - this.pinch) * PINCH_SPEED);
      this.pinch = dist;
      return;
    }
    const l = this.look;
    if (l && e.pointerId === l.pointer) {
      // grab the world: what's under your finger stays under it
      const k = FOV / Math.max(1, this.renderer.domElement.clientHeight);
      this.me = lookBy(this.me, (e.clientX - l.last.x) * k, (e.clientY - l.last.y) * k);
      l.last.set(e.clientX, e.clientY);
      this.aim();
      return;
    }
    const d = this.drag;
    if (!d) {
      if (e.buttons === 0 && e.target === this.renderer.domElement) {
        this.renderer.domElement.style.cursor = this.pick(e) ? "grab" : "";
      }
      return;
    }
    if (e.pointerId !== d.pointer) return;
    const dx = e.clientX - d.from.x;
    const dy = e.clientY - d.from.y;
    if (!d.moved && Math.hypot(dx, dy) < TAP_SLOP_PX) return;
    d.moved = true;
    this.renderer.domElement.style.cursor = "grabbing";

    let next: Placement;
    if (d.mode === "turn") {
      next = { ...d.start, yaw: d.start.yaw + dx * 0.5, s: d.start.s * 2 ** (-dy / 200) };
    } else {
      const ray = this.ray(e);
      const at = planeHit(ray.origin, ray.direction, d.plane.point, d.plane.normal);
      if (!at) return;
      next = { ...d.start, x: at.x - d.grab.x, y: at.y - d.grab.y, z: at.z - d.grab.z };
      if (d.mode === "depth") next.y = d.start.y;
    }
    next = clampPlacement(next);
    const card = this.cards.get(d.id);
    if (card) this.place(card, next);
    this.events.onMove(d.id, next);
  };

  private onUp = (e: PointerEvent) => {
    if (!this.touches.delete(e.pointerId)) return;
    this.container.releasePointerCapture?.(e.pointerId);
    if (this.touches.size < 2) this.pinch = null;
    if (this.look?.pointer === e.pointerId) this.look = null;
    if (this.drag && e.pointerId === this.drag.pointer) {
      this.drag = null;
      this.renderer.domElement.style.cursor = "";
      return;
    }
    if (this.empty && e.pointerId === this.empty.pointer) {
      const still = Math.hypot(e.clientX - this.empty.from.x, e.clientY - this.empty.from.y);
      const slop = e.pointerType === "mouse" ? TAP_SLOP_PX : TOUCH_SLOP_PX;
      this.empty = null;
      // a click on empty space (not the end of a look) clears the selection
      if (still >= slop || e.type !== "pointerup") return;
      if (this.selected || e.pointerType === "mouse") this.events.onSelect(null);
      else this.walkTo(e);
    }
  };

  private onWheel = (e: WheelEvent) => {
    if (e.target !== this.renderer.domElement) return;
    e.preventDefault();
    this.glide = null;
    const px = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 40 : e.deltaY;
    this.stepForward(-px * WHEEL_SPEED);
  };

  private onDoubleClick = (e: MouseEvent) => {
    const hit = this.pick(e);
    if (hit) this.events.onOpen(hit.id);
  };

  // --- walking ---

  private onKeyDown = (e: KeyboardEvent) => {
    // keys on the photo buttons edit photos
    if (e.target !== this.container || e.altKey || e.ctrlKey || e.metaKey) return;
    if (WALK_KEYS.has(e.key)) e.preventDefault();
    this.held.add(e.key);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.held.delete(e.key);
  };

  private onBlur = () => {
    this.held.clear();
  };

  /** Glide to where a tap hit the floor. */
  private walkTo(e: PointerEvent) {
    const ray = this.ray(e);
    const spot = planeHit(ray.origin, ray.direction, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    const step = spot && tapStep(spot, this.me);
    if (!step) return;
    const dist = Math.hypot(step.x, step.z);
    this.glide = {
      path: [this.me, { ...this.me, x: this.me.x + step.x, z: this.me.z + step.z }],
      start: performance.now(),
      ms: Math.min(1200, Math.max(350, (dist / GLIDE_SPEED) * 1000)),
    };
  }

  private stepForward(d: number) {
    const dir = ahead(this.me.yaw);
    const s = clampStep({ x: dir.x * d, z: dir.z * d }, this.me);
    this.me = { ...this.me, x: this.me.x + s.x, z: this.me.z + s.z };
    this.aim();
  }

  /** Put the camera where you're standing, looking where you're facing. */
  private aim() {
    this.camera.position.set(this.me.x, EYE_H, this.me.z);
    this.camera.rotation.set(this.me.pitch * DEG, this.me.yaw * DEG, 0, "YXZ");
    this.invalidate();
  }

  private walk(now: number) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;

    const { forward, turn, fast } = walkIntent(this.held);
    if (forward || turn) {
      this.glide = null;
      const k = (fast ? FAST : 1) * dt;
      if (turn) this.me = lookBy(this.me, turn * TURN_SPEED * k, 0);
      if (forward) this.stepForward(forward * WALK_SPEED * k);
      this.aim();
      return;
    }

    const g = this.glide;
    if (!g) return;
    const t = Math.min(1, Math.max(0, (now - g.start) / g.ms));
    this.me = alongPath(g.path, ease(t));
    if (t === 1) this.glide = null;
    this.aim();
  }

  // --- frame loop ---

  private fitSize() {
    const { width, height } = this.container.getBoundingClientRect();
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  private invalidate() {
    this.dirty = true;
  }

  private loop = (now = performance.now()) => {
    this.frame = requestAnimationFrame(this.loop);
    this.walk(now);
    if (!this.dirty) return;
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
  };
}
