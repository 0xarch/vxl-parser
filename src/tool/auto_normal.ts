import { Voxel, VoxelSection } from '../types';
import { RA2Normals_Table } from './normal_predef';

// ----------------------------------------------------------------------
// Port of VXLSE III's Tangent Plane auto normal algorithm.
//
// Original: resources/vxlse/source/control/voxels/Voxel_AutoNormals.pas
// It was published in SIBGRAPI 2007 as "Finding Surface Normals From Voxels".
//
// The comments in the original source are in Brazilian Portuguese; the
// constants below keep the original names so the port can be compared with
// the reference implementation line by line.
// ----------------------------------------------------------------------

// Level of influence of a map cell in relation to the model.
const C_FORA_DO_VOLUME = 0;
const C_INFLUENCIA_DE_UM_EIXO = 1;
const C_INFLUENCIA_DE_DOIS_EIXOS = 2;
const C_INFLUENCIA_DE_TRES_EIXOS = 3;
const C_SUPERFICIE = 4;
const C_PARTE_DO_VOLUME = 5;

// Weights used when detecting the tendency of the mass.
const PESO_FORA_DO_VOLUME = 0;
const PESO_INFLUENCIA_DE_UM_EIXO = 0.000001;
const PESO_INFLUENCIA_DE_DOIS_EIXOS = 0.0001;
const PESO_INFLUENCIA_DE_TRES_EIXOS = 0.01;
const PESO_PARTE_DO_VOLUME = 0.1;
const PESO_SUPERFICIE = 1;

const C_TAMANHO_RAYCASTING = 12;

// VXLSE stores the section in OpenGL coordinates internally:
//   gl(X, Y, Z) = westwood(Y, Z, X)
// and the normal palette is permuted the same way:
//   glNormal = (westwood.Y, westwood.Z, westwood.X)
// The normal index written to disk is the raw OpenGL index, because
// OpenGLToWestwoodCoordinates() only permutes voxel data, never normals.
// The tables in normal_predef.ts keep Westwood's original ordering.
const NORMAL_TABLE: Array<[number, number, number]> = RA2Normals_Table
    .map(v => [v.Y, v.Z, v.X]);

// VXLSE stores every vector component, filter coefficient and map weight as
// Delphi `single` (IEEE-754 binary32). Emulating the rounding step after each
// assignment is required to reproduce its exact results around ties.
const sf = Math.fround;

const PESO_POR_NIVEL: number[] = [
    PESO_FORA_DO_VOLUME,
    PESO_INFLUENCIA_DE_UM_EIXO,
    PESO_INFLUENCIA_DE_DOIS_EIXOS,
    PESO_INFLUENCIA_DE_TRES_EIXOS,
    PESO_SUPERFICIE,
    PESO_PARTE_DO_VOLUME,
].map(sf);

type Vec3 = [number, number, number];

function normalize(v: Vec3): Vec3 {
    const len = sf(Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]));
    if (len > 0) {
        return [sf(v[0] / len), sf(v[1] / len), sf(v[2] / len)];
    }
    return [0, 0, 0];
}

function getNearestNormalIndex(n: Vec3): number {
    let bestIdx = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < NORMAL_TABLE.length; i++) {
        const t = NORMAL_TABLE[i];
        const dx = n[0] - t[0];
        const dy = n[1] - t[1];
        const dz = n[2] - t[2];
        const diff = sf(dx * dx + dy * dy + dz * dz);
        if (diff < bestDiff) {
            bestDiff = diff;
            bestIdx = i;
        }
    }
    return bestIdx;
}

// ----------------------------------------------------------------------
// TFiltroDistancia / GerarFiltro
// ----------------------------------------------------------------------
interface Filter {
    size: number;
    radius: number;
    middle: number;
    // filter[((x * size) + y) * size + z]
    data: Float64Array;
    // Whether the filter vector is non-zero at that position.
    valid: Uint8Array;
}

function generateFilter(alcance: number): Filter {
    const middle = Math.trunc(alcance);
    const size = 2 * middle + 1;
    const data = new Float64Array(size * size * size * 3);
    const valid = new Uint8Array(size * size * size);
    const index = (x: number, y: number, z: number) => ((x * size) + y) * size + z;

    for (let x = 0; x < size; x++) {
        for (let y = 0; y < size; y++) {
            for (let z = 0; z < size; z++) {
                const dist = sf(Math.sqrt(
                    (x - middle) * (x - middle) +
                    (y - middle) * (y - middle) +
                    (z - middle) * (z - middle)
                ));
                const i = index(x, y, z);
                if (dist > 0 && dist <= alcance) {
                    const distCubed = sf(Math.pow(dist, 3));
                    const i3 = i * 3;
                    data[i3] = sf((middle - x) / distCubed);
                    data[i3 + 1] = sf((middle - y) / distCubed);
                    data[i3 + 2] = sf((middle - z) / distCubed);
                    valid[i] = 1;
                }
            }
        }
    }

    return { size, radius: middle, middle, data, valid };
}

// ----------------------------------------------------------------------
// TVoxelMap.GenerateFullMap
// ----------------------------------------------------------------------
interface VoxelMap {
    used: Uint8Array;
    level: Int16Array;    // C_* level before ConvertValues
    weight: Float64Array; // PESO_*
    width: number;
    height: number;
    depth: number;
    originX: number;
    originY: number;
    originZ: number;
}

function buildVoxelMap(section: VoxelSection, bias: number): VoxelMap | null {
    // The VXLSE map covers the section's tailer size plus a bias on every
    // side. The output size is determined by the used bounding box, so using
    // that bounding box here is equivalent (and avoids carrying empty margins).
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const b of section.voxels) {
        if (b.used) {
            minX = Math.min(minX, b.x);
            minY = Math.min(minY, b.y);
            minZ = Math.min(minZ, b.z);
            maxX = Math.max(maxX, b.x);
            maxY = Math.max(maxY, b.y);
            maxZ = Math.max(maxZ, b.z);
        }
    }
    if (minX === Infinity) return null;

    const originX = minX - bias;
    const originY = minY - bias;
    const originZ = minZ - bias;
    const width = maxX - minX + 1 + 2 * bias;
    const height = maxY - minY + 1 + 2 * bias;
    const depth = maxZ - minZ + 1 + 2 * bias;
    const index = (x: number, y: number, z: number) => (x * height + y) * depth + z;

    const used = new Uint8Array(width * height * depth);
    const level = new Int16Array(width * height * depth);

    // Mark used voxels (C_MODE_USED).
    for (const b of section.voxels) {
        if (!b.used) continue;
        const x = b.x - originX;
        const y = b.y - originY;
        const z = b.z - originZ;
        const i = index(x, y, z);
        used[i] = 1;
        level[i] = 1;
    }

    // GenerateFullMap's FloodFill + MergeMapData marks enclosed empty cells
    // as part of the volume. Only empty cells reachable from the map corner
    // are truly outside.
    const visited = new Uint8Array(width * height * depth);
    const queue = new Int32Array(width * height * depth);
    let queueHead = 0;
    let queueTail = 0;
    const start = index(0, 0, 0);
    visited[start] = 1;
    queue[queueTail++] = start;
    const neighbours = [
        [-1, 0, 0], [1, 0, 0],
        [0, -1, 0], [0, 1, 0],
        [0, 0, -1], [0, 0, 1],
    ];
    while (queueHead < queueTail) {
        const current = queue[queueHead++];
        const z = current % depth;
        const y = Math.floor(current / depth) % height;
        const x = Math.floor(current / (depth * height));
        for (const [dx, dy, dz] of neighbours) {
            const nx = x + dx, ny = y + dy, nz = z + dz;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height || nz < 0 || nz >= depth) continue;
            const ni = index(nx, ny, nz);
            if (visited[ni] || used[ni]) continue;
            visited[ni] = 1;
            queue[queueTail++] = ni;
        }
    }
    for (let i = 0; i < level.length; i++) {
        if (!used[i] && !visited[i]) {
            level[i] = 1;
        }
    }

    // TVoxelMap.MapInfluences: for each axis line, add one to every cell
    // between the first and the last used voxel.
    // z axis (for each x, y).
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            let first = -1;
            let last = -1;
            for (let z = 0; z < depth; z++) {
                if (used[index(x, y, z)]) {
                    if (first === -1) first = z;
                    last = z;
                }
            }
            if (first !== -1) {
                for (let z = first; z <= last; z++) level[index(x, y, z)]++;
            }
        }
    }
    // x axis (for each y, z).
    for (let y = 0; y < height; y++) {
        for (let z = 0; z < depth; z++) {
            let first = -1;
            let last = -1;
            for (let x = 0; x < width; x++) {
                if (used[index(x, y, z)]) {
                    if (first === -1) first = x;
                    last = x;
                }
            }
            if (first !== -1) {
                for (let x = first; x <= last; x++) level[index(x, y, z)]++;
            }
        }
    }
    // y axis (for each x, z).
    for (let x = 0; x < width; x++) {
        for (let z = 0; z < depth; z++) {
            let first = -1;
            let last = -1;
            for (let y = 0; y < height; y++) {
                if (used[index(x, y, z)]) {
                    if (first === -1) first = y;
                    last = y;
                }
            }
            if (first !== -1) {
                for (let y = first; y <= last; y++) level[index(x, y, z)]++;
            }
        }
    }

    // TVoxelMap.MapSurfaces(C_SURFACE): a cell at level 4 is only considered
    // surface if at least one of its 26 neighbours has a lower level.
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            for (let z = 0; z < depth; z++) {
                const i = index(x, y, z);
                if (level[i] !== C_SUPERFICIE) continue;
                let inside = true;
                for (let dx = -1; dx <= 1 && inside; dx++) {
                    for (let dy = -1; dy <= 1 && inside; dy++) {
                        for (let dz = -1; dz <= 1 && inside; dz++) {
                            if (dx === 0 && dy === 0 && dz === 0) continue;
                            const nx = x + dx, ny = y + dy, nz = z + dz;
                            if (nx < 0 || nx >= width || ny < 0 || ny >= height || nz < 0 || nz >= depth) continue;
                            if (level[index(nx, ny, nz)] < C_SUPERFICIE) {
                                inside = false;
                            }
                        }
                    }
                }
                if (inside) {
                    level[i] = C_PARTE_DO_VOLUME;
                }
            }
        }
    }

    const weight = new Float64Array(level.length);
    for (let i = 0; i < level.length; i++) {
        weight[i] = PESO_POR_NIVEL[level[i]];
    }

    return { used, level, weight, width, height, depth, originX, originY, originZ };
}

// ----------------------------------------------------------------------
// PegarValorDoPonto
// ----------------------------------------------------------------------
function pointValue(map: VoxelMap, last: Vec3, point: Vec3): number {
    const px = Math.trunc(point[0]);
    const py = Math.trunc(point[1]);
    const pz = Math.trunc(point[2]);

    if (px < 0 || px >= map.width || py < 0 || py >= map.height || pz < 0 || pz >= map.depth) {
        return 0;
    }
    if (last[0] === px && last[1] === py && last[2] === pz) {
        return 0;
    }

    last[0] = px;
    last[1] = py;
    last[2] = pz;
    const i = (px * map.height + py) * map.depth + pz;
    let result = map.weight[i];
    if (result >= PESO_PARTE_DO_VOLUME) {
        result = PESO_SUPERFICIE;
    }
    return result;
}

// ----------------------------------------------------------------------
// AcharPlanoTangenteEmXY / YZ / XZ
//
// The two tangent axes are `a` and `b`, the third axis is traversed in full.
// The original functions sum the filter vectors of all surface points in each
// quadrant; the quadrants overlap on the middle plane (filter index === middle).
// ----------------------------------------------------------------------
function tangentPlane(
    surface: Uint8Array,
    filter: Filter,
    limitsMin: Vec3,
    limitsMax: Vec3,
    axisA: 0 | 1 | 2,
    axisB: 0 | 1 | 2,
    axisFull: 0 | 1 | 2
): [Vec3, Vec3, Vec3, Vec3] {
    const { size, middle, data } = filter;
    const sw: Vec3 = [0, 0, 0];
    const nw: Vec3 = [0, 0, 0];
    const se: Vec3 = [0, 0, 0];
    const ne: Vec3 = [0, 0, 0];
    const index = (x: number, y: number, z: number) => ((x * size) + y) * size + z;

    const minA = limitsMin[axisA], maxA = limitsMax[axisA];
    const minB = limitsMin[axisB], maxB = limitsMax[axisB];
    const minC = limitsMin[axisFull], maxC = limitsMax[axisFull];

    const add = (dest: Vec3, i: number) => {
        const i3 = i * 3;
        dest[0] = sf(dest[0] + data[i3]);
        dest[1] = sf(dest[1] + data[i3 + 1]);
        dest[2] = sf(dest[2] + data[i3 + 2]);
    };

    const coarse = (a: number, b: number, c: number) => {
        const pos: Vec3 = [0, 0, 0];
        pos[axisA] = a;
        pos[axisB] = b;
        pos[axisFull] = c;
        return pos;
    };

    // Ponto 1: Sudoeste (A <= Meio e B <= Meio)
    for (let a = minA; a <= middle; a++) {
        for (let b = minB; b <= middle; b++) {
            for (let c = minC; c <= maxC; c++) {
                const p = coarse(a, b, c);
                const i = index(p[0], p[1], p[2]);
                if (surface[i]) add(sw, i);
            }
        }
    }
    // Ponto 2: Noroeste (A <= Meio e B >= Meio)
    for (let a = minA; a <= middle; a++) {
        for (let b = middle; b <= maxB; b++) {
            for (let c = minC; c <= maxC; c++) {
                const p = coarse(a, b, c);
                const i = index(p[0], p[1], p[2]);
                if (surface[i]) add(nw, i);
            }
        }
    }
    // Ponto 3: Sudeste (A >= Meio e B <= Meio)
    for (let a = middle; a <= maxA; a++) {
        for (let b = minB; b <= middle; b++) {
            for (let c = minC; c <= maxC; c++) {
                const p = coarse(a, b, c);
                const i = index(p[0], p[1], p[2]);
                if (surface[i]) add(se, i);
            }
        }
    }
    // Ponto 4: Nordeste (A >= Meio e B >= Meio)
    for (let a = middle; a <= maxA; a++) {
        for (let b = middle; b <= maxB; b++) {
            for (let c = minC; c <= maxC; c++) {
                const p = coarse(a, b, c);
                const i = index(p[0], p[1], p[2]);
                if (surface[i]) add(ne, i);
            }
        }
    }

    return [sw, nw, se, ne];
}

// ----------------------------------------------------------------------
// Normal cross products (with the same fallback order as the original)
// ----------------------------------------------------------------------
function normalFromQuadrants(sw: Vec3, nw: Vec3, se: Vec3, ne: Vec3): Vec3 {
    let n: Vec3 = [
        sf((ne[1] - se[1]) * (sw[2] - se[2]) - (sw[1] - se[1]) * (ne[2] - se[2])),
        sf((ne[2] - se[2]) * (sw[0] - se[0]) - (sw[2] - se[2]) * (ne[0] - se[0])),
        sf((ne[0] - se[0]) * (sw[1] - se[1]) - (sw[0] - se[0]) * (ne[1] - se[1])),
    ];
    if (n[0] !== 0 || n[1] !== 0 || n[2] !== 0) return n;

    n = [
        sf((nw[1] - ne[1]) * (se[2] - ne[2]) - (se[1] - ne[1]) * (nw[2] - ne[2])),
        sf((nw[2] - ne[2]) * (se[0] - ne[0]) - (se[2] - ne[2]) * (nw[0] - ne[0])),
        sf((nw[0] - ne[0]) * (se[1] - ne[1]) - (se[0] - ne[0]) * (nw[1] - ne[1])),
    ];
    if (n[0] !== 0 || n[1] !== 0 || n[2] !== 0) return n;

    n = [
        sf((sw[1] - nw[1]) * (ne[2] - nw[2]) - (ne[1] - nw[1]) * (sw[2] - nw[2])),
        sf((sw[2] - nw[2]) * (ne[0] - nw[0]) - (ne[2] - nw[2]) * (sw[0] - nw[0])),
        sf((sw[0] - nw[0]) * (ne[1] - nw[1]) - (ne[0] - nw[0]) * (sw[1] - nw[1])),
    ];
    if (n[0] !== 0 || n[1] !== 0 || n[2] !== 0) return n;

    return [
        sf((se[1] - sw[1]) * (nw[2] - sw[2]) - (nw[1] - sw[1]) * (se[2] - sw[2])),
        sf((se[2] - sw[2]) * (nw[0] - sw[0]) - (nw[2] - sw[2]) * (se[0] - sw[0])),
        sf((se[0] - sw[0]) * (nw[1] - sw[1]) - (nw[0] - sw[0]) * (se[1] - sw[1])),
    ];
}

// ----------------------------------------------------------------------
// DetectarSuperficieContinua (Treat Descontinuities)
// ----------------------------------------------------------------------
function detectSurfaceContinuous(
    map: VoxelMap,
    filter: Filter,
    surface: Uint8Array,
    limiteMin: Vec3,
    limiteMax: Vec3,
    cx: number,
    cy: number,
    cz: number
): void {
    const size = filter.size;
    const middle = filter.middle;
    const index = (x: number, y: number, z: number) => ((x * size) + y) * size + z;
    const pontoMin: Vec3 = [cx - middle, cy - middle, cz - middle];

    const visited = new Uint8Array(size * size * size);
    const list: number[] = [];
    const directions: number[] = [];

    const add = (
        mapX: number, mapY: number, mapZ: number,
        xdir: number, ydir: number, zdir: number,
        fx: number, fy: number, fz: number
    ) => {
        if (mapX < 0 || mapX >= map.width || mapY < 0 || mapY >= map.height || mapZ < 0 || mapZ >= map.depth) {
            return;
        }
        if (fx < 0 || fx >= size || fy < 0 || fy >= size || fz < 0 || fz >= size) {
            return;
        }
        const fi = index(fx, fy, fz);
        if (visited[fi]) return;
        visited[fi] = 1;
        if (map.level[(mapX * map.height + mapY) * map.depth + mapZ] === C_SUPERFICIE &&
            filter.valid[fi]) {
            list.push(mapX, mapY, mapZ);
            directions.push(xdir, ydir, zdir);
            if (fx > limiteMax[0]) limiteMax[0] = fx;
            else if (fx < limiteMin[0]) limiteMin[0] = fx;
            if (fy > limiteMax[1]) limiteMax[1] = fy;
            else if (fy < limiteMin[1]) limiteMin[1] = fy;
            if (fz > limiteMax[2]) limiteMax[2] = fz;
            else if (fz < limiteMin[2]) limiteMin[2] = fz;
            surface[fi] = 1;
        }
    };

    const centerIndex = index(middle, middle, middle);
    surface[centerIndex] = 1;
    visited[centerIndex] = 1;

    list.push(cx, cy, cz);
    directions.push(0, 0, 0);

    for (let position = 0; position < list.length; position += 3) {
        const xx = list[position];
        const yy = list[position + 1];
        const zz = list[position + 2];
        const xdir = directions[position];
        const ydir = directions[position + 1];
        const zdir = directions[position + 2];
        const px = xx - pontoMin[0];
        const py = yy - pontoMin[1];
        const pz = zz - pontoMin[2];

        // Os eixos z, y e x levam prioridade, nessa ordem.
        if (xdir !== -1) {
            add(xx + 1, yy, zz, 1, ydir, zdir, px + 1, py, pz);
        }
        if (xdir !== 1) {
            add(xx - 1, yy, zz, -1, ydir, zdir, px - 1, py, pz);
        }
        if (ydir !== -1) {
            add(xx, yy + 1, zz, xdir, 1, zdir, px, py + 1, pz);
            if (xdir !== -1) {
                add(xx + 1, yy + 1, zz, 1, 1, zdir, px + 1, py + 1, pz);
            }
            if (xdir !== 1) {
                add(xx - 1, yy + 1, zz, -1, 1, zdir, px - 1, py + 1, pz);
            }
        }
        if (ydir !== 1) {
            add(xx, yy - 1, zz, xdir, -1, zdir, px, py - 1, pz);
            if (xdir !== -1) {
                add(xx + 1, yy - 1, zz, 1, -1, zdir, px + 1, py - 1, pz);
            }
            if (xdir !== 1) {
                add(xx - 1, yy - 1, zz, -1, -1, zdir, px - 1, py - 1, pz);
            }
        }

        if (zdir !== -1) {
            add(xx, yy, zz + 1, xdir, ydir, 1, px, py, pz + 1);
            if (xdir !== -1) {
                add(xx + 1, yy, zz + 1, 1, ydir, 1, px + 1, py, pz + 1);
            }
            if (xdir !== 1) {
                // O original usa 1 como direção aqui.
                add(xx - 1, yy, zz + 1, 1, ydir, 1, px - 1, py, pz + 1);
            }
            if (ydir !== -1) {
                add(xx, yy + 1, zz + 1, xdir, 1, 1, px, py + 1, pz + 1);
                if (xdir !== -1) {
                    add(xx + 1, yy + 1, zz + 1, 1, 1, 1, px + 1, py + 1, pz + 1);
                }
                if (xdir !== 1) {
                    add(xx - 1, yy + 1, zz + 1, -1, 1, 1, px - 1, py + 1, pz + 1);
                }
            } else {
                // ydir = -1 here, so the original's "else if (ydir <> 1)"
                // is always true.
                add(xx, yy - 1, zz + 1, xdir, -1, 1, px, py - 1, pz + 1);
                if (xdir === 1) {
                    add(xx + 1, yy - 1, zz + 1, 1, -1, 1, px + 1, py - 1, pz + 1);
                }
                if (xdir === -1) {
                    add(xx - 1, yy - 1, zz + 1, -1, -1, 1, px - 1, py - 1, pz + 1);
                }
            }
        }

        // O original testa "z" (coordenada do mapa) e não "zdir".
        if (cz !== 1) {
            add(xx, yy, zz - 1, xdir, ydir, -1, px, py, pz - 1);
            if (xdir !== -1) {
                // O original usa -1 como direção aqui.
                add(xx + 1, yy, zz - 1, -1, ydir, -1, px + 1, py, pz - 1);
            }
            if (xdir !== 1) {
                add(xx - 1, yy, zz - 1, -1, ydir, -1, px - 1, py, pz - 1);
            }
            if (ydir !== -1) {
                add(xx, yy + 1, zz - 1, xdir, 1, -1, px, py + 1, pz - 1);
                if (xdir !== -1) {
                    add(xx + 1, yy + 1, zz - 1, 1, 1, -1, px + 1, py + 1, pz - 1);
                } else {
                    // xdir = -1 here, so the original's "else if (xdir <> 1)"
                    // is always true.
                    add(xx - 1, yy + 1, zz - 1, -1, 1, -1, px - 1, py + 1, pz - 1);
                }
            }
            if (ydir !== 1) {
                add(xx, yy - 1, zz - 1, xdir, -1, -1, px, py - 1, pz - 1);
                if (xdir !== -1) {
                    add(xx + 1, yy - 1, zz - 1, 1, -1, -1, px + 1, py - 1, pz - 1);
                }
                if (xdir !== 1) {
                    add(xx - 1, yy - 1, zz - 1, -1, -1, -1, px - 1, py - 1, pz - 1);
                }
            }
        }
    }
}

// ----------------------------------------------------------------------
// AplicarFiltro
// ----------------------------------------------------------------------
function applyFilter(
    map: VoxelMap,
    filter: Filter,
    cx: number,
    cy: number,
    cz: number
): number {
    const alcance = filter.radius;
    const middle = filter.middle;
    const size = filter.size;
    const index = (x: number, y: number, z: number) => ((x * size) + y) * size + z;

    // 1.38: LimiteMin/LimiteMax are the bounding box of the tangent plane.
    const limiteMin: Vec3 = [middle * 2, middle * 2, middle * 2];
    const limiteMax: Vec3 = [0, 0, 0];

    const surface = new Uint8Array(size * size * size);
    const add = (dest: Vec3, i: number) => {
        const i3 = i * 3;
        dest[0] = sf(dest[0] + filter.data[i3]);
        dest[1] = sf(dest[1] + filter.data[i3 + 1]);
        dest[2] = sf(dest[2] + filter.data[i3 + 2]);
    };

    // DetectarSuperficieContinua (the "Stretch Influence Map" option).
    detectSurfaceContinuous(map, filter, surface, limiteMin, limiteMax, cx, cy, cz);

    let vetorNormal: Vec3 = [0, 0, 0];

    // O plano tangente requer que haja pelo menos dois pontos distintos em 2 eixos
    let contaEixoProblematico = 0;
    if ((limiteMax[0] - limiteMin[0]) < 3) contaEixoProblematico++;
    if ((limiteMax[1] - limiteMin[1]) < 3) contaEixoProblematico++;
    if ((limiteMax[2] - limiteMin[2]) < 3) contaEixoProblematico++;

    if (contaEixoProblematico === 3) {
        // Ponto ou cubo isolado.
        vetorNormal = [0, 0, 0];
    } else if (contaEixoProblematico === 2) {
        vetorNormal = [0, 0, 0];
        if ((limiteMax[0] - limiteMin[0]) < 1) vetorNormal[0] = 1;
        if ((limiteMax[1] - limiteMin[1]) < 1) vetorNormal[1] = 1;
        if ((limiteMax[2] - limiteMin[2]) < 1) vetorNormal[2] = 1;
        if (vetorNormal[0] === 0 && vetorNormal[1] === 0 && vetorNormal[2] === 0) {
            // Emulação de um Cubed Normalizer de raio 1.
            for (let xx = alcance - 1; xx <= alcance + 1; xx++) {
                for (let yy = alcance - 1; yy <= alcance + 1; yy++) {
                    for (let zz = alcance - 1; zz <= alcance + 1; zz++) {
                        const i = index(xx, yy, zz);
                        if (surface[i]) {
                            add(vetorNormal, i);
                        }
                    }
                }
            }
        }
    } else if (contaEixoProblematico < 2) {
        const pontoSudoeste: Vec3 = [0, 0, 0];
        const pontoNordeste: Vec3 = [0, 0, 0];

        // Primeiro descobrimos a tendência do plano.
        for (let xx = 0; xx < size; xx++) {
            for (let yy = 0; yy < size; yy++) {
                for (let zz = 0; zz < size; zz++) {
                    const i = index(xx, yy, zz);
                    if (!surface[i]) continue;
                    const i3 = i * 3;
                    if (filter.data[i3] >= 0) pontoNordeste[0] = sf(pontoNordeste[0] + filter.data[i3]);
                    else pontoSudoeste[0] = sf(pontoSudoeste[0] + filter.data[i3]);
                    if (filter.data[i3 + 1] >= 0) pontoNordeste[1] = sf(pontoNordeste[1] + filter.data[i3 + 1]);
                    else pontoSudoeste[1] = sf(pontoSudoeste[1] + filter.data[i3 + 1]);
                    if (filter.data[i3 + 2] >= 0) pontoNordeste[2] = sf(pontoNordeste[2] + filter.data[i3 + 2]);
                    else pontoSudoeste[2] = sf(pontoSudoeste[2] + filter.data[i3 + 2]);
                }
            }
        }

        // Com a tendência acima, escolhemos os dois maiores eixos.
        let axisA: 0 | 1 | 2;
        let axisB: 0 | 1 | 2;
        let axisFull: 0 | 1 | 2;
        const rangeX = pontoNordeste[0] - pontoSudoeste[0];
        const rangeY = pontoNordeste[1] - pontoSudoeste[1];
        const rangeZ = pontoNordeste[2] - pontoSudoeste[2];

        if (rangeX > rangeY) {
            if (rangeY > rangeZ) {
                // XY
                axisA = 0; axisB = 1; axisFull = 2;
            } else {
                // XZ
                axisA = 0; axisB = 2; axisFull = 1;
            }
        } else if (rangeX > rangeZ) {
            // XY
            axisA = 0; axisB = 1; axisFull = 2;
        } else {
            // YZ
            axisA = 1; axisB = 2; axisFull = 0;
        }

        const [sw, nw, se, ne] = tangentPlane(surface, filter, limiteMin, limiteMax, axisA, axisB, axisFull);
        vetorNormal = normalFromQuadrants(sw, nw, se, ne);
    }

    // Normalize
    vetorNormal = normalize(vetorNormal);

    // Respondemos "para qual lado vai a normal?" com um falso raycasting.
    const centro: Vec3 = [cx + 0.5, cy + 0.5, cz + 0.5];
    const posicao: Vec3 = [centro[0], centro[1], centro[2]];
    const posicaoOposta: Vec3 = [centro[0], centro[1], centro[2]];
    const ultimoVisitado: Vec3 = [cx, cy, cz];
    const ultimoOpostoVisitado: Vec3 = [cx, cy, cz];

    let direcao = 0;
    for (let contador = 0; contador < C_TAMANHO_RAYCASTING; contador++) {
        posicao[0] = sf(posicao[0] + vetorNormal[0]);
        posicao[1] = sf(posicao[1] + vetorNormal[1]);
        posicao[2] = sf(posicao[2] + vetorNormal[2]);
        posicaoOposta[0] = sf(posicaoOposta[0] - vetorNormal[0]);
        posicaoOposta[1] = sf(posicaoOposta[1] - vetorNormal[1]);
        posicaoOposta[2] = sf(posicaoOposta[2] - vetorNormal[2]);
        direcao = sf(direcao + pointValue(map, ultimoVisitado, posicao) -
            pointValue(map, ultimoOpostoVisitado, posicaoOposta));
    }

    // Se a direção do vetor normal avaliado tiver mais peso do que a oposta,
    // estamos indo para dentro do volume.
    if (direcao > 0) {
        vetorNormal = [-vetorNormal[0], -vetorNormal[1], -vetorNormal[2]];
    } else if (direcao === 0) {
        // Empate técnico: quem tiver o maior Z vence.
        if (vetorNormal[2] < 0) {
            vetorNormal = [-vetorNormal[0], -vetorNormal[1], -vetorNormal[2]];
        }
    }

    return getNearestNormalIndex(vetorNormal);
}

// ----------------------------------------------------------------------
// AcharNormais
// ----------------------------------------------------------------------
export function computeVoxelNormals(voxel: Voxel, radius: number = 1.5): Voxel {
    const filter = generateFilter(radius);
    const bias = filter.radius;

    for (const section of voxel.sections) {
        // VXLSE runs the algorithm on OpenGL coordinates internally. Emulate
        // that by feeding permuted positions: gl(X, Y, Z) = westwood(Y, Z, X).
        // The normal index is kept as-is on the original block, matching
        // VXLSE's save behaviour (it never permutes normals).
        const blocks = section.voxels;
        const positions = blocks.map(b => ({ x: b.y, y: b.z, z: b.x }));
        const proxy: VoxelSection = {
            ...section,
            voxels: blocks.map((b, i) => ({ ...b, ...positions[i] })),
        };

        const map = buildVoxelMap(proxy, bias);
        if (!map) continue;

        for (let i = 0; i < blocks.length; i++) {
            const block = blocks[i];
            if (!block.used) continue;

            const cx = positions[i].x - map.originX;
            const cy = positions[i].y - map.originY;
            const cz = positions[i].z - map.originZ;
            const centerIndex = (cx * map.height + cy) * map.depth + cz;

            // VXLSE only applies a new normal to surface voxels. Voxels that
            // are not surface keep their original normal.
            if (map.level[centerIndex] !== C_SUPERFICIE) continue;

            block.normal = applyFilter(map, filter, cx, cy, cz);
        }
    }

    return voxel;
}
