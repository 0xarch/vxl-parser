import { Voxel, VoxelSection } from "../../../types";
import { vxl, vxl_header, vxl_limb_header, vxl_limb_body, vxl_limb_tailer, voxel } from "./types";
import { defaultPalette } from "./misc";

// 与 bufferify 中完全一致的压缩函数（仅用于计算长度）
function computeCompressedLength(voxels: voxel[], zSize: number): number {
    let length = 0;
    let z = 0;
    while (z < zSize) {
        let skip = 0;
        while (z + skip < zSize && !voxels[z + skip].used) skip++;
        length += 1; // skip 字节
        z += skip;
        if (z >= zSize) break;

        let nv = 0;
        while (z + nv < zSize && voxels[z + nv].used) nv++;
        if (nv === 0) continue;

        length += 1;             // 头部 nv
        length += nv * 2;        // 颜色和法线
        length += 1;             // 尾部 nv
        z += nv;
    }
    length += 2; // 末尾填充
    return length;
}

/**
 * 将标准化 Voxel 对象转换为 vxl 中间格式（计算好所有偏移量，供 bufferify 使用）
 */
export function voxelToVxl(voxel: Voxel, palette?: number[][]): vxl {
    const sections = voxel.sections;
    const nLimbs = sections.length;

    const limb_headers: vxl_limb_header[] = [];
    const limb_bodies: vxl_limb_body[] = [];
    const limb_tailers: vxl_limb_tailer[] = [];
    let totalBodySize = 0;

    for (let limbIdx = 0; limbIdx < nLimbs; limbIdx++) {
        const section = sections[limbIdx];

        // 1. 确定尺寸（体素最大坐标+1）
        let maxX = 0, maxY = 0, maxZ = 0;
        for (const v of section.voxels) {
            if (v.used) {
                maxX = Math.max(maxX, v.x);
                maxY = Math.max(maxY, v.y);
                maxZ = Math.max(maxZ, v.z);
            }
        }
        const xsize = maxX + 1;
        const ysize = maxY + 1;
        const zsize = maxZ + 1;
        const nSpans = xsize * ysize;

        // 2. 构建每列体素数组（按 z 排序）
        const spansVoxels: (voxel | null)[][] = Array(nSpans);
        for (let i = 0; i < nSpans; i++) spansVoxels[i] = new Array(zsize).fill(null);
        for (const v of section.voxels) {
            if (!v.used) continue;
            const idx = v.y * xsize + v.x;
            spansVoxels[idx][v.z] = { used: true, colour: v.colour, normal: v.normal, x: v.x, y: v.y, z: v.z };
        }
        // 转换为 voxel[]（未使用的填充 used=false）
        const spanArrays: voxel[][] = spansVoxels.map(arr =>
            arr.map(v => v ? v : { used: false, colour: 0, normal: 0, x: 0, y: 0, z: 0 })
        );

        // 3. 计算每个跨度的压缩长度，并记录偏移（相对于 span_data 区域起始）
        const spanStartOffsets = new Int32Array(nSpans);
        const spanEndOffsets = new Int32Array(nSpans);
        let dataOffset = 0;
        for (let i = 0; i < nSpans; i++) {
            const hasVoxels = spanArrays[i].some(v => v.used);
            if (!hasVoxels) {
                spanStartOffsets[i] = -1;
                spanEndOffsets[i] = -1;
                continue;
            }
            const len = computeCompressedLength(spanArrays[i], zsize);
            spanStartOffsets[i] = dataOffset;
            spanEndOffsets[i] = dataOffset + len;
            dataOffset += len;
        }

        // 4. 构建 span_data 数组（仅存储解压后的体素，供 bufferify 重新压缩）
        const span_data = new Array(nSpans);
        for (let i = 0; i < nSpans; i++) {
            span_data[i] = { voxels: spanArrays[i] };
        }

        // 5. 计算 body 区域布局
        const startArrayBytes = nSpans * 4;
        const endArrayBytes = nSpans * 4;
        const dataArrayBytes = dataOffset;
        const bodySize = startArrayBytes + endArrayBytes + dataArrayBytes;

        // 6. 肢体尾字段
        const scaleWorld = 1 / 12;
        const halfX = maxX / 2;
        const halfY = maxY / 2;
        // 边界框（对称居中，底部 y=0）
        const minBounds = [-halfX, -halfY, 0];
        const maxBounds = [ halfX,  halfY, maxZ];
        const transform = [
            [1, 0, 0, 0],
            [0, 1, 0, 0],
            [0, 0, 1, 0]
        ];
        const normalType = 4; // 与原始 RA2 风格一致

        const tailer: vxl_limb_tailer = {
            span_start_off: 0,
            span_end_off: startArrayBytes,
            span_data_off: startArrayBytes + endArrayBytes,
            scale: scaleWorld,
            transform,
            minBounds,
            maxBounds,
            xsize,
            ysize,
            zsize,
            normalType
        };

        // 肢体头
        const limbName = section.name || `Limb${limbIdx}`;
        limb_headers.push({
            limb_name: limbName.slice(0, 15),
            limb_number: limbIdx,
            unknown: 1,
            unknown2: 0
        });

        limb_bodies.push({
            span_start: Array.from(spanStartOffsets),
            span_end: Array.from(spanEndOffsets),
            span_data
        });

        limb_tailers.push(tailer);
        totalBodySize += bodySize;
    }

    const header: vxl_header = {
        filetype: "Voxel Animation",
        unknown: 1,
        n_limbs: nLimbs,
        n_limbs2: nLimbs,
        bodysize: totalBodySize,
        unknown2: 0x1f10,
        palette: palette || defaultPalette()
    };

    return { header, limb_header: limb_headers, limb_body: limb_bodies, limb_tailer: limb_tailers };
}