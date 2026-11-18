import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  DoubleSide,
  DirectionalLight,
  Fog,
  GridHelper,
  Group,
  HemisphereLight,
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
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { Layout, Photo, Placement } from "@/lib/api";
import {
  cardSize,
  clampPlacement,
  clampStep,
  fitView,
  heading,
  planeHit,
  SPACE_H,
  SPACE_HALF,
  type Step,
  tapStep,
  turnAbout,
  type Vec3,
  walkIntent,
} from "@/lib/space";

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

type Glide = { from: Vec3; target: Vec3; step: Step; start: number; ms: number };

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
const TAP_SLOP_PX = 4;
const SKY = "#a9c8e8";
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
  private controls: OrbitControls;
  private raycaster = new Raycaster();
  private shadowTex = shadowTexture();
  private cards = new Map<string, Card>();
  private selected: string | null = null;
  private stalk: Line;
  private drag: Drag | null = null;
  private empty: { from: Vector2; pointer: number } | null = null;
  private pointers = new Set<number>();
  private held = new Set<string>();
  private glide: Glide | null = null;
  private last = 0;
  private dirty = true;
  private frame = 0;
  private resize: ResizeObserver;
  private fitted = false;
  private disposed = false;

  constructor(
    private container: HTMLElement,
    private events: SceneEvents,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.className = "space-canvas";
    container.prepend(this.renderer.domElement);

    this.scene.background = new Color(SKY);
    this.scene.fog = new Fog(SKY, 7000, 16000);
    this.scene.add(new HemisphereLight("#ffffff", "#8a5a2b", 2.2));
    const sun = new DirectionalLight("#fff6e8", 1.4);
    sun.position.set(800, 2000, 1200);
    this.scene.add(sun);

    const floor = new Mesh(
      new PlaneGeometry(SPACE_HALF * 2, SPACE_HALF * 2),
      new MeshLambertMaterial({ color: "#c49a63" }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    const grid = new GridHelper(SPACE_HALF * 2, 24, "#8a5a2b", "#a87a45");
    grid.position.y = 0.5;
    this.scene.add(grid);

    // line from the selected photo down to the floor, so you can tell how far back it is
    this.stalk = new Line(
      new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]),
      new LineBasicMaterial({ color: SEL }),
    );
    this.stalk.visible = false;
    this.scene.add(this.stalk);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = 150;
    this.controls.maxDistance = SPACE_HALF * 3;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.controls.addEventListener("change", () => {
      this.keepTargetInside();
      this.invalidate();
    });

    // capture phase on the container: runs before OrbitControls sees the pointer
    container.addEventListener("pointerdown", this.onDown, true);
    container.addEventListener("pointermove", this.onMove);
    container.addEventListener("pointerup", this.onUp);
    container.addEventListener("pointercancel", this.onUp);
    container.addEventListener("dblclick", this.onDoubleClick);
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
    if (!this.fitted && this.cards.size) {
      this.fitted = true;
      this.fit(layout, photos);
    }
    this.invalidate();
  }

  private fit(layout: Layout, photos: Photo[]) {
    const { width, height } = this.container.getBoundingClientRect();
    const view = fitView(layout, photos, FOV, width / Math.max(height, 1) || 1.5);
    this.controls.target.set(view.target.x, view.target.y, view.target.z);
    this.camera.position.set(view.position.x, view.position.y, view.position.z);
    this.controls.update();
    this.invalidate();
  }

  /** Where the camera sits, in world units. */
  eye(): Vec3 {
    const { x, y, z } = this.camera.position;
    return { x, y, z };
  }

  /** Which way round the vertical the camera looks from, in degrees (0 = looking down -z). */
  viewYaw(): number {
    return this.controls.getAzimuthalAngle() / DEG;
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
    this.container.removeEventListener("keydown", this.onKeyDown);
    this.container.removeEventListener("keyup", this.onKeyUp);
    this.container.removeEventListener("blur", this.onBlur);
    for (const [id, card] of this.cards) this.drop(id, card);
    this.shadowTex.dispose();
    this.controls.dispose();
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
    this.pointers.add(e.pointerId);
    // a second finger makes it a pinch, not a tap
    if (this.pointers.size > 1) this.empty = null;
    if (e.button !== 0 || e.target !== this.renderer.domElement) return;
    this.glide = null;
    // so the arrow keys walk
    this.container.focus({ preventScroll: true });
    const hit = this.pick(e);
    if (!hit) {
      if (this.pointers.size === 1) {
        this.empty = { from: new Vector2(e.clientX, e.clientY), pointer: e.pointerId };
      }
      return;
    }
    // ours, not the camera's
    this.controls.enabled = false;
    this.container.setPointerCapture(e.pointerId);
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
    this.pointers.delete(e.pointerId);
    if (this.drag && e.pointerId === this.drag.pointer) {
      this.container.releasePointerCapture?.(e.pointerId);
      this.drag = null;
      this.controls.enabled = true;
      this.renderer.domElement.style.cursor = "";
      return;
    }
    if (this.empty && e.pointerId === this.empty.pointer) {
      const still = Math.hypot(e.clientX - this.empty.from.x, e.clientY - this.empty.from.y);
      this.empty = null;
      // a click on empty space (not the end of an orbit) clears the selection
      if (still >= TAP_SLOP_PX || e.type !== "pointerup") return;
      if (this.selected || e.pointerType === "mouse") this.events.onSelect(null);
      else this.walkTo(e);
    }
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
    const step = spot && tapStep(spot, this.camera.position, this.controls.target);
    if (!step) return;
    const dist = Math.hypot(step.x, step.z);
    this.glide = {
      from: this.camera.position.clone(),
      target: this.controls.target.clone(),
      step,
      start: performance.now(),
      ms: Math.min(1200, Math.max(350, (dist / GLIDE_SPEED) * 1000)),
    };
  }

  private moveBy(step: Step) {
    this.camera.position.x += step.x;
    this.camera.position.z += step.z;
    this.controls.target.x += step.x;
    this.controls.target.z += step.z;
  }

  private walk(now: number) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const eye = this.camera.position;
    const target = this.controls.target;

    const { forward, turn, fast } = walkIntent(this.held);
    if (forward || turn) {
      this.glide = null;
      const k = fast ? FAST : 1;
      if (turn) {
        const t = turnAbout(eye, target, turn * TURN_SPEED * k * dt);
        target.set(t.x, t.y, t.z);
      }
      const dir = heading(eye, target);
      if (forward && dir) {
        const d = forward * WALK_SPEED * k * dt;
        this.moveBy(clampStep({ x: dir.x * d, z: dir.z * d }, eye, target));
      }
      this.controls.update();
      return;
    }

    const g = this.glide;
    if (!g) return;
    const t = Math.min(1, Math.max(0, (now - g.start) / g.ms));
    const k = ease(t);
    eye.set(g.from.x + g.step.x * k, eye.y, g.from.z + g.step.z * k);
    target.set(g.target.x + g.step.x * k, target.y, g.target.z + g.step.z * k);
    if (t === 1) this.glide = null;
    this.controls.update();
  }

  // --- frame loop ---

  private keepTargetInside() {
    const t = this.controls.target;
    const clampTo = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    t.set(
      clampTo(t.x, -SPACE_HALF, SPACE_HALF),
      clampTo(t.y, 0, SPACE_H),
      clampTo(t.z, -SPACE_HALF, SPACE_HALF),
    );
  }

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
    // damping keeps emitting "change" for a few frames after you let go
    this.controls.update();
    if (!this.dirty) return;
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
  };
}
