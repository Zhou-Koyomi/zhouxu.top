// 展板几何实证：复现 buildArtworkBoard layout + viewer reparent/explode/focus。
import * as THREE from "./node_modules/three/build/three.module.js";

const cx = 0.1655, cy = 1.943;
function build(aspect) {
  const backG = new THREE.BoxGeometry(1, 1, 0.026);
  const printG = new THREE.BoxGeometry(1, 1, 0.012);
  const hG = new THREE.BoxGeometry(1, 0.09, 0.012);
  const vG = new THREE.BoxGeometry(0.09, 1, 0.012);
  const m = new THREE.MeshBasicMaterial();
  const back = new THREE.Mesh(backG, m);
  const print = new THREE.Mesh(printG, m);
  const bars = [new THREE.Mesh(hG, m), new THREE.Mesh(hG, m), new THREE.Mesh(vG, m), new THREE.Mesh(vG, m)];
  const parts = ["substrate", "optical-core", "optical-lenses", "optical-lenses", "optical-lenses", "optical-lenses"];
  const meshes = [back, print, ...bars];
  meshes.forEach((mesh, i) => (mesh.userData.assemblyPart = parts[i]));
  const printW = aspect > 1 ? 3.017 : 2.122 * aspect;
  const printH = aspect > 1 ? 3.017 / aspect : 2.122;
  back.scale.set(3.057, 2.162, 1); back.position.set(cx, cy, 0.143);
  print.scale.set(printW, printH, 1); print.position.set(cx, cy, 0.1625);
  const outerW = printW + 0.06, outerH = printH + 0.06;
  bars[0].scale.set(outerW, 1, 1); bars[0].position.set(cx, cy + printH / 2 - 0.015, 0.165);
  bars[1].scale.set(outerW, 1, 1); bars[1].position.set(cx, cy - printH / 2 + 0.015, 0.165);
  bars[2].scale.set(1, outerH - 0.18, 1); bars[2].position.set(cx - printW / 2 + 0.015, cy, 0.165);
  bars[3].scale.set(1, outerH - 0.18, 1); bars[3].position.set(cx + printW / 2 - 0.015, cy, 0.165);
  return { meshes, printW, printH, outerW, outerH };
}

function box(mesh) {
  mesh.updateWorldMatrix(true, false);
  const b = new THREE.Box3().setFromObject(mesh);
  const f = (v) => `[${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}]`;
  return `${f(b.min)} → ${f(b.max)}`;
}

for (const [name, aspect] of [["竖图 X-011", 1080 / 1303], ["横图 X-012", 1280 / 731]]) {
  console.log(`\n=== ${name} aspect=${aspect.toFixed(3)}`);
  const { meshes, printW, printH } = build(aspect);
  console.log(`printW=${printW.toFixed(3)} printH=${printH.toFixed(3)}`);
  const model = new THREE.Group();
  model.add(...meshes);
  // viewer: reparent 到部件组
  const groups = new Map();
  for (const id of ["substrate", "optical-core", "optical-lenses"]) {
    const g = new THREE.Group();
    g.name = id;
    groups.set(id, g);
  }
  for (const child of [...model.children]) groups.get(child.userData.assemblyPart).add(child);
  for (const g of groups.values()) model.add(g);
  model.position.set(0, -1.85, 0);
  model.updateMatrixWorld(true);
  const names = ["back", "print", "bar-top", "bar-bottom", "bar-left", "bar-right"];
  console.log("-- 装配态（viewer 世界坐标，model y-1.85）:");
  meshes.forEach((mesh, i) => console.log(`  ${names[i]}: ${box(mesh)}`));
  // 爆炸 spread=1
  groups.get("substrate").position.z = -1.1;
  groups.get("optical-core").position.z = -0.15;
  groups.get("optical-lenses").position.z = 0.75;
  console.log("-- 爆炸态:");
  meshes.forEach((mesh, i) => console.log(`  ${names[i]}: ${box(mesh)}`));
  groups.get("substrate").position.z = 0;
  groups.get("optical-core").position.z = 0;
  groups.get("optical-lenses").position.z = 0;
  // 聚焦：attach 到 pivot（含爆炸态 z 不在此列，新规则聚焦在拆解态——附加一版爆炸态 attach）
  console.log("-- 聚焦 attach（装配态 → pivot 于 board center）:");
  const pivot = new THREE.Group();
  const scene = new THREE.Scene();
  scene.add(model, pivot);
  model.updateMatrixWorld(true);
  const center = new THREE.Vector3(cx, cy, 0.16).add(model.position);
  pivot.position.copy(center);
  for (const mesh of meshes) pivot.attach(mesh);
  pivot.updateMatrixWorld(true);
  meshes.forEach((mesh, i) => console.log(`  ${names[i]}: ${box(mesh)}`));
}
