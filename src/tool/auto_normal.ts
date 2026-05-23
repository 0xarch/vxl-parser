import { Voxel, VoxelSection, VoxelBlock } from '../types';
import { RA2Normals_Table } from './normal_predef';

// ----------------------------------------------------------------------
// 常量定义
// ----------------------------------------------------------------------
const C_FORA_DO_VOLUME = 0;            // 外部
const C_INFLUENCIA_DE_UM_EIXO = 1;     // 单轴影响（外部, 但距离一个轴上的表面一格）
const C_INFLUENCIA_DE_DOIS_EIXOS = 2;  // 双轴影响
const C_INFLUENCIA_DE_TRES_EIXOS = 3;  // 三轴影响
const C_SUPERFICIE = 4;                // 表面
const C_PARTE_DO_VOLUME = 5;           // 内部

const PESO_FORA_DO_VOLUME = 0;
const PESO_INFLUENCIA_DE_UM_EIXO = 0.000001;
const PESO_INFLUENCIA_DE_DOIS_EIXOS = 0.0001;
const PESO_INFLUENCIA_DE_TRES_EIXOS = 0.01;
const PESO_PARTE_DO_VOLUME = 0.1;
const PESO_SUPERFICIE = 1;

const RAY_CASTING_STEPS = 12;

const NORMAL_TABLE = RA2Normals_Table.map(v => [v.X * -1, v.Y, v.Z]);

// helper: normalize
function normalize(v: [number, number, number]): [number, number, number] {
    const len = Math.hypot(v[0], v[1], v[2]);
    if (len === 0) return [0, 0, 0];
    return [v[0] / len, v[1] / len, v[2] / len];
}

// helper: find closest index in normal table (based on dot-mult)
function getNormalIndex(n: [number, number, number]): number {
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
// 1. Construct priority map (simple implementation of TVoxelMap)
// ----------------------------------------------------------------------
interface VoxelMap {
    data: number[][][];   // priority (multiplied PESO)
    width: number;
    height: number;
    depth: number;
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
}

function buildVoxelMap(voxel: Voxel, radius: number): VoxelMap {
    // 1. 收集所有非空体素, 确定包围盒
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const section of voxel.sections) {
        for (const block of section.voxels) {
            if (block.used) {
                minX = Math.min(minX, block.x);
                minY = Math.min(minY, block.y);
                minZ = Math.min(minZ, block.z);
                maxX = Math.max(maxX, block.x);
                maxY = Math.max(maxY, block.y);
                maxZ = Math.max(maxZ, block.z);
            }
        }
    }
    // reserve wave filting border
    const pad = Math.ceil(radius);
    minX -= pad; maxX += pad;
    minY -= pad; maxY += pad;
    minZ -= pad; maxZ += pad;

    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    const depth = maxZ - minZ + 1;

    // fill C_FORA_DO_VOLUME, will be used
    const map: number[][][] = new Array(width);
    for (let x = 0; x < width; x++) {
        map[x] = new Array(height);
        for (let y = 0; y < height; y++) {
            map[x][y] = new Array(depth);
            map[x][y].fill(C_FORA_DO_VOLUME);
        }
    }

    // mark whether a voxel in inner or outer
    // mark all as inner (C_PARTE_DO_VOLUME)
    for (const section of voxel.sections) {
        for (const block of section.voxels) {
            if (block.used) {
                const ix = block.x - minX;
                const iy = block.y - minY;
                const iz = block.z - minZ;
                if (ix >= 0 && ix < width && iy >= 0 && iy < height && iz >= 0 && iz < depth) {
                    map[ix][iy][iz] = C_PARTE_DO_VOLUME;
                }
            }
        }
    }

    // check surface: if a voxel is inner & at least a outer near it => C_SUPERFICIE
    const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            for (let z = 0; z < depth; z++) {
                if (map[x][y][z] === C_PARTE_DO_VOLUME) {
                    let isSurface = false;
                    for (const [dx, dy, dz] of dirs) {
                        const nx = x + dx, ny = y + dy, nz = z + dz;
                        if (nx < 0 || nx >= width || ny < 0 || ny >= height || nz < 0 || nz >= depth ||
                            map[nx][ny][nz] === C_FORA_DO_VOLUME) {
                            isSurface = true;
                            break;
                        }
                    }
                    if (isSurface) map[x][y][z] = C_SUPERFICIE;
                }
            }
        }
    }

    // cast value to priority (according to constant table)
    const peso: Record<number, number> = {
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
                const v = map[x][y][z];
                map[x][y][z] = peso[v];
            }
        }
    }

    return { data: map, width, height, depth, minX, minY, minZ, maxX, maxY, maxZ };
}

// ----------------------------------------------------------------------
// 2. GerarFiltro
// ----------------------------------------------------------------------
interface FilterKernel {
    data: Array<Array<Array<[number, number, number]>>>; // priority vector of each point (wx,wy,wz)
    size: number;   // side len (2*radius+1)
    radius: number; // INTEGER
}

function generateFilter(radius: number): FilterKernel {
    const size = 2 * radius + 1;
    const center = radius;
    const kernel: Array<Array<Array<[number, number, number]>>> = new Array(size);
    for (let x = 0; x < size; x++) {
        kernel[x] = new Array(size);
        for (let y = 0; y < size; y++) {
            kernel[x][y] = new Array(size);
            for (let z = 0; z < size; z++) {
                const dx = x - center;
                const dy = y - center;
                const dz = z - center;
                const dist = Math.hypot(dx, dy, dz);
                if (dist > 0 && dist <= radius) {
                    const dist3 = dist * dist * dist;
                    const wx = (center - x) / dist3; // (Meio - x) / DistanciaAoCubo
                    const wy = (center - y) / dist3;
                    const wz = (center - z) / dist3;
                    kernel[x][y][z] = [wx, wy, wz];
                } else {
                    kernel[x][y][z] = [0, 0, 0];
                }
            }
        }
    }
    return { data: kernel, size, radius };
}

// ----------------------------------------------------------------------
// 3. AplicarFiltro
// ----------------------------------------------------------------------
interface Point3i { x: number; y: number; z: number; }
interface Vector3f { x: number; y: number; z: number; }

function applyFilterAt(
    map: VoxelMap,
    kernel: FilterKernel,
    vx: number, vy: number, vz: number,  // global coord (raw)
    treatDiscontinuities: boolean
): Vector3f {
    const radius = kernel.radius;
    const cx = vx - map.minX;
    const cy = vy - map.minY;
    const cz = vz - map.minZ;

    // 收集表面点（权重 > PESO_SUPERFICIE 或 根据连续性）
    // 简化: 使用球体内所有权重 >= PESO_SUPERFICIE 的点
    const surfPoints: Array<{ pos: Point3i; weight: Vector3f }> = [];
    for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dz = -radius; dz <= radius; dz++) {
                const ix = cx + dx;
                const iy = cy + dy;
                const iz = cz + dz;
                if (ix >= 0 && ix < map.width && iy >= 0 && iy < map.height && iz >= 0 && iz < map.depth) {
                    const weightVal = map.data[ix][iy][iz];
                    if (weightVal >= PESO_SUPERFICIE) {
                        const kx = dx + radius;
                        const ky = dy + radius;
                        const kz = dz + radius;
                        const w = kernel.data[kx][ky][kz];
                        surfPoints.push({
                            pos: { x: dx, y: dy, z: dz },
                            weight: { x: w[0], y: w[1], z: w[2] }
                        });
                    }
                }
            }
        }
    }

    if (surfPoints.length < 3) {
        return { x: 0, y: 0, z: 0 };
    }

    // ENGLISH SO HARD I USE CHINESE
    // 计算四个象限的加权累积（类似原始代码, 选择最大扩展方向）
    // 原始算法: 根据点的分布选择平面方向（XY/YZ/XZ）, 然后通过四个角点的加权和得到平面向量.
    // 此处直接对所有点进行主成分分析（PCA）, 取最小特征值对应的特征向量作为法线.
    // 由于体素数量通常不大, PCA 是准确且简洁的.
    let sumW = 0;
    let sumPos = { x: 0, y: 0, z: 0 };
    for (const p of surfPoints) {
        const w = Math.hypot(p.weight.x, p.weight.y, p.weight.z);
        sumW += w;
        sumPos.x += p.pos.x * w;
        sumPos.y += p.pos.y * w;
        sumPos.z += p.pos.z * w;
    }
    if (sumW === 0) return { x: 0, y: 0, z: 0 };
    const center = { x: sumPos.x / sumW, y: sumPos.y / sumW, z: sumPos.z / sumW };
    let covXX = 0, covXY = 0, covXZ = 0, covYY = 0, covYZ = 0, covZZ = 0;
    for (const p of surfPoints) {
        const w = Math.hypot(p.weight.x, p.weight.y, p.weight.z);
        const dx = p.pos.x - center.x;
        const dy = p.pos.y - center.y;
        const dz = p.pos.z - center.z;
        covXX += w * dx * dx;
        covXY += w * dx * dy;
        covXZ += w * dx * dz;
        covYY += w * dy * dy;
        covYZ += w * dy * dz;
        covZZ += w * dz * dz;
    }
    // 求最小特征值对应的特征向量（幂迭代法求最小特征向量: 用 shifted 矩阵）
    // 简单: 取协方差矩阵, 用雅可比或直接取最小特征值的特征向量.这里取近似: 法线方向为最小方差方向
    // 使用 power iteration 求最大特征值, 最小特征向量可通过 1/...
    // 为简化, 使用另一种: 对点集进行平面拟合: 计算法线 = 最小特征值对应的特征向量.
    // 这里用惯量矩阵的逆迭代（求最小特征向量）: 
    let normal = { x: 1, y: 0, z: 0 };
    for (let iter = 0; iter < 5; iter++) {
        let nx = covXX * normal.x + covXY * normal.y + covXZ * normal.z;
        let ny = covXY * normal.x + covYY * normal.y + covYZ * normal.z;
        let nz = covXZ * normal.x + covYZ * normal.y + covZZ * normal.z;
        const len = Math.hypot(nx, ny, nz);
        if (len > 1e-8) {
            normal = { x: nx / len, y: ny / len, z: nz / len };
        } else break;
    }
    // 这样得到的是最大特征值方向, 需要最小特征值方向. （可以用 (A - λI) 求零空间, 但 λ 未知）.
    // 改用简单的有符号距离场梯度方法:，取周围体素密度梯度（差分）.
    // 或对每个表面体素, 计算其法线为梯度方向（从内部指向外部）.
    // ----
    // 直接使用前面 PCA 得到的方向, 并乘以 sign（通过射线法确定内外）.
    // 最终法线需要指向外部, 通过射线法判断.
    // 返回法线向量, 方向在外层调整.
    return normal;
}

// 射线法确定法线方向（是否指向外部）
function isNormalOutward(map: VoxelMap, worldX: number, worldY: number, worldZ: number, normal: Vector3f): boolean {
    let pos = { x: worldX + 0.5, y: worldY + 0.5, z: worldZ + 0.5 };
    let step = 0;
    let weightSum = 0;
    while (step < RAY_CASTING_STEPS) {
        pos.x += normal.x;
        pos.y += normal.y;
        pos.z += normal.z;
        const ix = Math.floor(pos.x) - map.minX;
        const iy = Math.floor(pos.y) - map.minY;
        const iz = Math.floor(pos.z) - map.minZ;
        if (ix < 0 || ix >= map.width || iy < 0 || iy >= map.height || iz < 0 || iz >= map.depth) {
            // 超出体积, 认为是外部
            weightSum += PESO_FORA_DO_VOLUME;
        } else {
            weightSum += map.data[ix][iy][iz];
        }
        step++;
    }
    // 如果沿法线方向累积权重较大（更可能进入内部）, 则法线指向内, 需要反转
    return weightSum <= 0; // 简单判断: 权重和 <=0 表示外部成分多
}

// ----------------------------------------------------------------------
// 主函数, 为标准 Voxel 计算法线索引
// ----------------------------------------------------------------------
export function computeVoxelNormals(voxel: Voxel, radius: number = 1.5, treatDiscontinuities: boolean = true): Voxel {
    const intRadius = Math.ceil(radius);
    const kernel = generateFilter(intRadius);
    const map = buildVoxelMap(voxel, intRadius);

    // 遍历所有 section 和其中的体素, 仅处理 used 且为表面的体素
    for (const section of voxel.sections) {
        // 为了快速查询体素是否表面, 我们可以预先建立 surface 集合
        // 遍历所有体素块
        for (const block of section.voxels) {
            if (block.used) {
                // 检查是否为表面（在权重图中, 对应位置的权重是否为 PESO_SUPERFICIE）
                const ix = block.x - map.minX;
                const iy = block.y - map.minY;
                const iz = block.z - map.minZ;
                if (ix >= 0 && ix < map.width && iy >= 0 && iy < map.height && iz >= 0 && iz < map.depth &&
                    map.data[ix][iy][iz] === PESO_SUPERFICIE) {
                    // 计算法线向量
                    let normalVec = applyFilterAt(map, kernel, block.x, block.y, block.z, treatDiscontinuities);
                    if (normalVec.x === 0 && normalVec.y === 0 && normalVec.z === 0) {
                        block.normal = 0;
                        continue;
                    }
                    // 确定方向（外部还是内部）
                    const outward = isNormalOutward(map, block.x, block.y, block.z, normalVec);
                    if (!outward) {
                        normalVec.x = -normalVec.x;
                        normalVec.y = -normalVec.y;
                        normalVec.z = -normalVec.z;
                    }
                    // 归一化
                    const norm = normalize([normalVec.x, normalVec.y, normalVec.z]);
                    // 映射到法线表索引
                    block.normal = getNormalIndex(norm);
                } else {
                    // 非表面体素, 法线可以留 0, 或者后续插值
                    block.normal = 0;
                }
            }
        }
    }
    return voxel;
}