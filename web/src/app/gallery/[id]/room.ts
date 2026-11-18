import {
  BoxGeometry,
  GridHelper,
  Group,
  HemisphereLight,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  PointLight,
} from "three";

import { DOOR_H, DOOR_HALF, HALL_END, HALL_H, HALL_HALF, ROOM_H, ROOM_HALF } from "@/lib/space";

export const WALL = "#f4f1ec";
const CEILING = "#fbfaf7";
const FLOOR = "#c9a272";
const TRIM = "#5c4834";
const LAMP = "#fffaf0";
const T = 40;
const SKIRT = 70;
const CASING = 60;
// ceiling lights per side, and how bright each one is
const LAMPS = 3;
const LAMP_SIZE = 1400;
const LAMP_POWER = 1.2;

type Span = [number, number];

/** The gallery room round the origin and the hallway into it through the +z wall. */
export function buildRoom(): Group {
  const room = new Group();
  const wall = new MeshLambertMaterial({ color: WALL });
  const trim = new MeshLambertMaterial({ color: TRIM });
  const lamp = new MeshBasicMaterial({ color: LAMP });
  const R = ROOM_HALF;
  const D = DOOR_HALF;
  const HH = HALL_HALF;

  const box = (mat: Material, x: Span, y: Span, z: Span) => {
    const m = new Mesh(new BoxGeometry(x[1] - x[0], y[1] - y[0], z[1] - z[0]), mat);
    m.position.set((x[0] + x[1]) / 2, (y[0] + y[1]) / 2, (z[0] + z[1]) / 2);
    room.add(m);
  };
  // floors face up, ceilings face down
  const slab = (color: string, x: Span, y: number, z: Span, up: boolean) => {
    const m = new Mesh(
      new PlaneGeometry(x[1] - x[0], z[1] - z[0]),
      new MeshLambertMaterial({ color }),
    );
    m.rotation.x = up ? -Math.PI / 2 : Math.PI / 2;
    m.position.set((x[0] + x[1]) / 2, y, (z[0] + z[1]) / 2);
    room.add(m);
  };
  const skirt = (x: Span, z: Span) => box(trim, x, [0, SKIRT], z);

  // room
  slab(FLOOR, [-R, R], 0, [-R, R], true);
  slab(CEILING, [-R, R], ROOM_H, [-R, R], false);
  const boards = new GridHelper(2 * R, 40, "#a8824f", "#b8915f");
  boards.position.y = 0.5;
  room.add(boards);

  box(wall, [-R - T, R + T], [0, ROOM_H], [-R - T, -R]);
  box(wall, [-R - T, -R], [0, ROOM_H], [-R, R]);
  box(wall, [R, R + T], [0, ROOM_H], [-R, R]);
  box(wall, [-R - T, -D], [0, ROOM_H], [R, R + T]);
  box(wall, [D, R + T], [0, ROOM_H], [R, R + T]);
  box(wall, [-D, D], [DOOR_H, ROOM_H], [R, R + T]);

  skirt([-R, R], [-R, -R + 8]);
  skirt([-R, -R + 8], [-R, R]);
  skirt([R - 8, R], [-R, R]);
  skirt([-R, -D - CASING], [R - 8, R]);
  skirt([D + CASING, R], [R - 8, R]);

  // door casing, both sides
  for (const z of [
    [R - 10, R],
    [R + T, R + T + 10],
  ] as Span[]) {
    box(trim, [-D - CASING, -D], [0, DOOR_H + CASING], z);
    box(trim, [D, D + CASING], [0, DOOR_H + CASING], z);
    box(trim, [-D, D], [DOOR_H, DOOR_H + CASING], z);
  }

  // hallway
  slab(FLOOR, [-HH, HH], 0, [R, HALL_END], true);
  slab(CEILING, [-HH, HH], HALL_H, [R + T, HALL_END], false);
  box(wall, [-HH - T, -HH], [0, HALL_H], [R + T, HALL_END]);
  box(wall, [HH, HH + T], [0, HALL_H], [R + T, HALL_END]);
  box(wall, [-HH - T, HH + T], [0, HALL_H], [HALL_END, HALL_END + T]);
  skirt([-HH, -HH + 8], [R + T, HALL_END]);
  skirt([HH - 8, HH], [R + T, HALL_END]);
  skirt([-HH, HH], [HALL_END - 8, HALL_END]);

  // light: soft fill everywhere, then a grid of ceiling panels, each with a lamp under it
  room.add(new HemisphereLight("#ffffff", "#e8dcc8", 2.4));
  const panel = new PlaneGeometry(LAMP_SIZE, LAMP_SIZE);
  const gap = (2 * R) / LAMPS;
  for (let i = 0; i < LAMPS; i++) {
    for (let j = 0; j < LAMPS; j++) {
      const x = -R + gap * (i + 0.5);
      const z = -R + gap * (j + 0.5);
      const m = new Mesh(panel, lamp);
      m.rotation.x = Math.PI / 2;
      m.position.set(x, ROOM_H - 1, z);
      room.add(m);
      const bulb = new PointLight(LAMP, LAMP_POWER, ROOM_H * 1.6, 0);
      bulb.position.set(x, ROOM_H - 150, z);
      room.add(bulb);
    }
  }
  const hallLamp = new Mesh(new PlaneGeometry(2 * HH - 200, 400), lamp);
  hallLamp.rotation.x = Math.PI / 2;
  hallLamp.position.set(0, HALL_H - 1, (R + HALL_END) / 2);
  room.add(hallLamp);
  const hallBulb = new PointLight(LAMP, 0.8, 2500, 0);
  hallBulb.position.set(0, HALL_H - 100, (R + HALL_END) / 2);
  room.add(hallBulb);

  return room;
}
