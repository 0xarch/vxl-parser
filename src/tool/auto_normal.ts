import { Voxel, VoxelSection, VoxelBlock } from '../types';
import { RA2Normals_Table } from './normal_predef';

// ----------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------
const C_FORA_DO_VOLUME = 0;
const C_INFLUENCIA_DE_UM_EIXO = 1;
const C_INFLUENCIA_DE_DOIS_EIXOS = 2;
const C_INFLUENCIA_DE_TRES_EIXOS = 3;
const C_SUPERFICIE = 4;
const C_PARTE_DO_VOLUME = 5;

const PESO_FORA_DO_VOLUME = 0;
const PESO_INFLUENCIA_DE_UM_EIXO = 0.000001;
const PESO_INFLUENCIA_DE_DOIS_EIXOS = 0.0001;
const PESO_INFLUENCIA_DE_TRES_EIXOS = 0.01;
const PESO_PARTE_DO_VOLUME = 0.1;
const PESO_SUPERFICIE = 1;

const RAY_CASTING_STEPS = 12;

const NORMAL_TABLE: Array<[number, number, number]> = RA2Normals_Table.map(v => [ (v.Z) * 1, (v.X) * 1, (v.Y) * 1 ]);

function normalize(v: [number, number, number]): [number, number, number] {
    const len = Math.hypot(v[0], v[1], v[2]);
    if (len === 0) return [0, 0, 0];
    return [v[0] / len, v[1] / len, v[2] / len];
}

function getNearestNormalIndex(n: [number, number, number]): number {
    let bestIdx = 0;
    let bestDot = -Infinity;
    for (let i = 1; i < NORMAL_TABLE.length; i++) {
        const tn = NORMAL_TABLE[i];
        const dot = n[0] * tn[0] + n[1] * tn[1] + n[2] * tn[2];
        if (dot > bestDot) {
            bestDot = dot;
            bestIdx = i;
        }
    }
    return bestIdx;
}

// ----------------------------------------------------------------------
// TVoxelMap
// ----------------------------------------------------------------------
interface VoxelMap {
    data: number[][][];   // PESO_*
    width: number;
    height: number;
    depth: number;
    minX: number;
    minY: number;
    minZ: number;
}

function buildVoxelMap(voxel: Voxel, radius: number): VoxelMap {
    // 1. 收集所有非空体素，确定包围盒并向外扩展 radius
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const s of voxel.sections) {
        for (const b of s.voxels) {
            if (b.used) {
                minX = Math.min(minX, b.x);
                minY = Math.min(minY, b.y);
                minZ = Math.min(minZ, b.z);
                maxX = Math.max(maxX, b.x);
                maxY = Math.max(maxY, b.y);
                maxZ = Math.max(maxZ, b.z);
            }
        }
    }
    const pad = Math.ceil(radius);
    minX -= pad; maxX += pad;
    minY -= pad; maxY += pad;
    minZ -= pad; maxZ += pad;

    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    const depth = maxZ - minZ + 1;

    // intialize C_FORA_DO_VOLUME
    const data: number[][][] = new Array(width);
    for (let x = 0; x < width; x++) {
        data[x] = new Array(height);
        for (let y = 0; y < height; y++) {
            data[x][y] = new Array(depth);
            data[x][y].fill(C_FORA_DO_VOLUME);
        }
    }

    // first, mark all as used
    for (const s of voxel.sections) {
        for (const b of s.voxels) {
            if (b.used) {
                const ix = b.x - minX;
                const iy = b.y - minY;
                const iz = b.z - minZ;
                if (ix >= 0 && ix < width && iy >= 0 && iy < height && iz >= 0 && iz < depth) {
                    data[ix][iy][iz] = C_PARTE_DO_VOLUME;
                }
            }
        }
    }

    // 检测表面：内部体素且至少有一个六邻域为空（或超出边界）则为表面
    const dirs = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            for (let z = 0; z < depth; z++) {
                if (data[x][y][z] === C_PARTE_DO_VOLUME) {
                    for (const [dx, dy, dz] of dirs) {
                        const nx = x + dx, ny = y + dy, nz = z + dz;
                        if (nx < 0 || nx >= width || ny < 0 || ny >= height || nz < 0 || nz >= depth ||
                            data[nx][ny][nz] === C_FORA_DO_VOLUME) {
                            data[x][y][z] = C_SUPERFICIE;
                            break;
                        }
                    }
                }
            }
        }
    }

    // convert to prior
    const pesoMap: Record<number, number> = {
        [C_FORA_DO_VOLUME]: PESO_FORA_DO_VOLUME,
        [C_INFLUENCIA_DE_UM_EIXO]: PESO_INFLUENCIA_DE_UM_EIXO,
        [C_INFLUENCIA_DE_DOIS_EIXOS]: PESO_INFLUENCIA_DE_DOIS_EIXOS,
        [C_INFLUENCIA_DE_TRES_EIXOS]: PESO_INFLUENCIA_DE_TRES_EIXOS,
        [C_PARTE_DO_VOLUME]: PESO_PARTE_DO_VOLUME,
        [C_SUPERFICIE]: PESO_SUPERFICIE,
    };
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            for (let z = 0; z < depth; z++) {
                data[x][y][z] = pesoMap[data[x][y][z]];
            }
        }
    }

    return { data, width, height, depth, minX, minY, minZ };
}

// ----------------------------------------------------------------------
// GenerFiltro
// ----------------------------------------------------------------------
interface FilterKernel {
    data: Array<Array<Array<[number, number, number]>>>;
    size: number;
    radius: number;
}

function generateFilter(radius: number): FilterKernel {
    const size = 2 * radius + 1;
    const center = radius;
    const data: Array<Array<Array<[number, number, number]>>> = new Array(size);
    for (let x = 0; x < size; x++) {
        data[x] = new Array(size);
        for (let y = 0; y < size; y++) {
            data[x][y] = new Array(size);
            for (let z = 0; z < size; z++) {
                const dx = x - center;
                const dy = y - center;
                const dz = z - center;
                const dist = Math.hypot(dx, dy, dz);
                if (dist > 0 && dist <= radius) {
                    const dist3 = dist * dist * dist;
                    const wx = (center - x) / dist3;
                    const wy = (center - y) / dist3;
                    const wz = (center - z) / dist3;
                    data[x][y][z] = [wx, wy, wz];
                } else {
                    data[x][y][z] = [0, 0, 0];
                }
            }
        }
    }
    return { data, size, radius };
}

// ----------------------------------------------------------------------
// DetectarSuperficieEsferica (simple version)
// ----------------------------------------------------------------------
function collectSurfacePoints(
    map: VoxelMap,
    kernel: FilterKernel,
    centerX: number, centerY: number, centerZ: number,
    minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number
): Array<{ pos: [number,number,number]; filter: [number,number,number] }> {
    const points: Array<{ pos: [number,number,number]; filter: [number,number,number] }> = [];
    for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
            for (let z = minZ; z <= maxZ; z++) {
                const ix = x - map.minX;
                const iy = y - map.minY;
                const iz = z - map.minZ;
                if (ix >= 0 && ix < map.width && iy >= 0 && iy < map.height && iz >= 0 && iz < map.depth) {
                    if (map.data[ix][iy][iz] >= PESO_SUPERFICIE) {
                        const kx = x - centerX + kernel.radius;
                        const ky = y - centerY + kernel.radius;
                        const kz = z - centerZ + kernel.radius;
                        if (kx >= 0 && kx < kernel.size && ky >= 0 && ky < kernel.size && kz >= 0 && kz < kernel.size) {
                            const f = kernel.data[kx][ky][kz];
                            points.push({ pos: [x, y, z], filter: f });
                        }
                    }
                }
            }
        }
    }
    return points;
}

// ----------------------------------------------------------------------
// part of AcharPlanoTangenteEmXY/YZ/XZ
// ----------------------------------------------------------------------
function computeQuadrantPoints(
    points: Array<{ pos: [number,number,number]; filter: [number,number,number] }>,
    centerX: number, centerY: number, centerZ: number,
    plane: 'xy' | 'yz' | 'xz'
): { sw: [number,number,number]; nw: [number,number,number]; se: [number,number,number]; ne: [number,number,number] } {
    let sw = [0,0,0], nw = [0,0,0], se = [0,0,0], ne = [0,0,0];
    for (const p of points) {
        const [x,y,z] = p.pos;
        const [wx, wy, wz] = p.filter;
        if (plane === 'xy') {
            if (x <= centerX && y <= centerY) { sw[0] += wx; sw[1] += wy; sw[2] += wz; }
            if (x <= centerX && y >= centerY) { nw[0] += wx; nw[1] += wy; nw[2] += wz; }
            if (x >= centerX && y <= centerY) { se[0] += wx; se[1] += wy; se[2] += wz; }
            if (x >= centerX && y >= centerY) { ne[0] += wx; ne[1] += wy; ne[2] += wz; }
        } else if (plane === 'yz') {
            if (y <= centerY && z <= centerZ) { sw[0] += wx; sw[1] += wy; sw[2] += wz; }
            if (y <= centerY && z >= centerZ) { nw[0] += wx; nw[1] += wy; nw[2] += wz; }
            if (y >= centerY && z <= centerZ) { se[0] += wx; se[1] += wy; se[2] += wz; }
            if (y >= centerY && z >= centerZ) { ne[0] += wx; ne[1] += wy; ne[2] += wz; }
        } else { // xz
            if (x <= centerX && z <= centerZ) { sw[0] += wx; sw[1] += wy; sw[2] += wz; }
            if (x <= centerX && z >= centerZ) { nw[0] += wx; nw[1] += wy; nw[2] += wz; }
            if (x >= centerX && z <= centerZ) { se[0] += wx; se[1] += wy; se[2] += wz; }
            if (x >= centerX && z >= centerZ) { ne[0] += wx; ne[1] += wy; ne[2] += wz; }
        }
    }
    // @ts-ignore
    return { sw, nw, se, ne };
}

// ----------------------------------------------------------------------
// calculate normal
// ----------------------------------------------------------------------
function computeNormalFromPoints(
    sw: [number,number,number],
    nw: [number,number,number],
    se: [number,number,number],
    ne: [number,number,number]
): [number,number,number] {
    // 1. sw, se, ne
    let v1: [number,number,number] = [se[0]-sw[0], se[1]-sw[1], se[2]-sw[2]];
    let v2: [number,number,number] = [ne[0]-sw[0], ne[1]-sw[1], ne[2]-sw[2]];
    let normal: [number,number,number] = [
        v1[1]*v2[2] - v1[2]*v2[1],
        v1[2]*v2[0] - v1[0]*v2[2],
        v1[0]*v2[1] - v1[1]*v2[0]
    ];
    if (normal[0] !== 0 || normal[1] !== 0 || normal[2] !== 0) return normalize(normal);

    // 2. nw, ne, se
    v1 = [ne[0]-nw[0], ne[1]-nw[1], ne[2]-nw[2]];
    v2 = [se[0]-nw[0], se[1]-nw[1], se[2]-nw[2]];
    normal = [
        v1[1]*v2[2] - v1[2]*v2[1],
        v1[2]*v2[0] - v1[0]*v2[2],
        v1[0]*v2[1] - v1[1]*v2[0]
    ];
    if (normal[0] !== 0 || normal[1] !== 0 || normal[2] !== 0) return normalize(normal);

    // 3. sw, nw, se
    v1 = [nw[0]-sw[0], nw[1]-sw[1], nw[2]-sw[2]];
    v2 = [se[0]-sw[0], se[1]-sw[1], se[2]-sw[2]];
    normal = [
        v1[1]*v2[2] - v1[2]*v2[1],
        v1[2]*v2[0] - v1[0]*v2[2],
        v1[0]*v2[1] - v1[1]*v2[0]
    ];
    return normalize(normal);
}

// ----------------------------------------------------------------------
// PegarValorDoPonto
// ----------------------------------------------------------------------
function isNormalOutward(
    map: VoxelMap,
    startX: number, startY: number, startZ: number,
    normal: [number, number, number]
): boolean {
    let pos = [startX + 0.5, startY + 0.5, startZ + 0.5];
    let weightSum = 0;
    for (let i = 0; i < RAY_CASTING_STEPS; i++) {
        pos[0] += normal[0];
        pos[1] += normal[1];
        pos[2] += normal[2];
        const ix = Math.floor(pos[0]) - map.minX;
        const iy = Math.floor(pos[1]) - map.minY;
        const iz = Math.floor(pos[2]) - map.minZ;
        if (ix < 0 || ix >= map.width || iy < 0 || iy >= map.height || iz < 0 || iz >= map.depth) {
            weightSum += PESO_FORA_DO_VOLUME;
        } else {
            weightSum += map.data[ix][iy][iz];
        }
    }
    return weightSum <= 0;
}

// ----------------------------------------------------------------------
// CALC!
// ----------------------------------------------------------------------
export function computeVoxelNormals(voxel: Voxel, radius: number = 1.5): Voxel {
    const intRadius = Math.ceil(radius);
    const kernel = generateFilter(intRadius);
    const map = buildVoxelMap(voxel, intRadius);
    const centerX = 0, centerY = 0, centerZ = 0;

    for (const section of voxel.sections) {
        for (const block of section.voxels) {
            if (!block.used) continue;

            const ix = block.x - map.minX;
            const iy = block.y - map.minY;
            const iz = block.z - map.minZ;
            if (ix < 0 || ix >= map.width || iy < 0 || iy >= map.height || iz < 0 || iz >= map.depth) continue;
            if (map.data[ix][iy][iz] !== PESO_SUPERFICIE) {
                block.normal = 0;
                continue;
            }

            const minX = block.x - intRadius, maxX = block.x + intRadius;
            const minY = block.y - intRadius, maxY = block.y + intRadius;
            const minZ = block.z - intRadius, maxZ = block.z + intRadius;
            const points = collectSurfacePoints(map, kernel, block.x, block.y, block.z,
                minX, maxX, minY, maxY, minZ, maxZ);

            if (points.length < 4) {
                block.normal = 0;
                continue;
            }

            let rangeX = maxX - minX;
            let rangeY = maxY - minY;
            let rangeZ = maxZ - minZ;
            let plane: 'xy' | 'yz' | 'xz';
            if (rangeX >= rangeY && rangeX >= rangeZ) plane = 'yz';
            else if (rangeY >= rangeX && rangeY >= rangeZ) plane = 'xz';
            else plane = 'xy';

            let { sw, nw, se, ne } = computeQuadrantPoints(points, block.x, block.y, block.z, plane);

            let normal = computeNormalFromPoints(sw, nw, se, ne);
            if (normal[0] === 0 && normal[1] === 0 && normal[2] === 0) {
                block.normal = 0;
                continue;
            }

            const outward = isNormalOutward(map, block.x, block.y, block.z, normal);
            if (!outward) {
                normal = [-normal[0], -normal[1], -normal[2]];
            }

            block.normal = getNearestNormalIndex(normal);
        }
    }

    return voxel;
}
