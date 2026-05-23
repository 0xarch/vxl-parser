// 该文件不再需要，因为使用分离的标准化构建

import { Voxel, VoxelSection } from "../../../types";
import { voxel, vxl_limb_tailer } from "./types";
import { defaultPalette } from "./misc";

function compressSpan(voxels: voxel[], zSize: number): Uint8Array {
    // 输入：该 (x,y) 列上所有 z 的体素（长度 zSize，未使用的体素 voxel.used === false）
    const chunks: Uint8Array[] = [];
    let z = 0;
    while (z < zSize) {
        // 计算跳过空体素数（允许0）
        let skip = 0;
        while (z + skip < zSize && !voxels[z + skip].used) skip++;
        chunks.push(new Uint8Array([skip])); // 总是写入 skip 字节
        z += skip;
        if (z >= zSize) break;

        // 连续非空体素块
        let nv = 0;
        while (z + nv < zSize && voxels[z + nv].used) nv++;
        if (nv === 0) continue;

        chunks.push(new Uint8Array([nv])); // 头部 nv
        const block = new Uint8Array(nv * 2);
        for (let i = 0; i < nv; i++) {
            block[i * 2] = voxels[z + i].colour;
            block[i * 2 + 1] = voxels[z + i].normal;
        }
        chunks.push(block);
        chunks.push(new Uint8Array([nv])); // 尾部 nv
        z += nv;
    }
    // 末尾2字节（通常为0）
    chunks.push(new Uint8Array(2));
    // 合并
    const totalLen = chunks.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(totalLen);
    let off = 0;
    for (const arr of chunks) {
        result.set(arr, off);
        off += arr.length;
    }
    return result;
}

// interface LimbBuildResult {
//     bodyData: Uint8Array;      // 整个 limb body 区域（span_start + span_end + span_data）
//     tailer: {
//         span_start_off: number;
//         span_end_off: number;
//         span_data_off: number;
//         xsize: number;
//         ysize: number;
//         zsize: number;
//         normalType: number;     // 通常为2
//         transform: number[][];  // 4x4
//         scale: number[];        // 3个float
//     };
// }

interface LimbBuildResult {
    bodyData: Uint8Array;
    // tailer: {
    //     span_start_off: number;
    //     span_end_off: number;
    //     span_data_off: number;
    //     xsize: number;
    //     ysize: number;
    //     zsize: number;
    //     normalType: number;
    //     transform: number[][];
    //     scale: number[];
    // };
    tailer: vxl_limb_tailer
}

// function buildLimb(section: VoxelSection): LimbBuildResult {
//     // 1. 确定尺寸
//     let maxX = 0, maxY = 0, maxZ = 0;
//     for (const v of section.voxels) {
//         if (v.used) {
//             maxX = Math.max(maxX, v.x);
//             maxY = Math.max(maxY, v.y);
//             maxZ = Math.max(maxZ, v.z);
//         }
//     }
//     const xsize = maxX + 1;
//     const ysize = maxY + 1;
//     const zsize = maxZ + 1;
//     const nSpans = xsize * ysize;

//     // 2. 为每个 (x,y) 构建跨度体素数组（按 z 排序）
//     const spansVoxels: (voxel | null)[][] = Array(nSpans);
//     for (let i = 0; i < nSpans; i++) {
//         spansVoxels[i] = new Array(zsize).fill(null);
//     }
//     for (const v of section.voxels) {
//         if (!v.used) continue;
//         const idx = v.y * xsize + v.x;
//         spansVoxels[idx][v.z] = v;
//     }
//     // 转换为 Voxel[] 数组（用于 compressSpan）
//     const spanArrays: voxel[][] = spansVoxels.map(arr =>
//         arr.map(v => v ? v : { used: false, colour: 0, normal: 0, x: 0, y: 0, z: 0 })
//     );

//     // 3. 压缩每个跨度，并记录偏移
//     const spanStartOffsets = new Int32Array(nSpans);
//     const spanEndOffsets = new Int32Array(nSpans);
//     const compressedChunks: Uint8Array[] = [];
//     let currentDataOffset = 0;
//     for (let i = 0; i < nSpans; i++) {
//         const hasVoxels = spanArrays[i].some(v => v.used);
//         if (!hasVoxels) {
//             spanStartOffsets[i] = -1;
//             spanEndOffsets[i] = -1;
//             continue;
//         }
//         const compressed = compressSpan(spanArrays[i], zsize);
//         spanStartOffsets[i] = currentDataOffset;
//         spanEndOffsets[i] = currentDataOffset + compressed.length;
//         compressedChunks.push(compressed);
//         currentDataOffset += compressed.length;
//     }

//     // 4. 构建 body 的连续内存：先 span_start 数组，再 span_end 数组，最后 span_data
//     const startArrayBytes = new Uint8Array(spanStartOffsets.buffer);
//     const endArrayBytes = new Uint8Array(spanEndOffsets.buffer);
//     const dataArrayBytes = new Uint8Array(currentDataOffset);
//     let pos = 0;
//     for (const chunk of compressedChunks) {
//         dataArrayBytes.set(chunk, pos);
//         pos += chunk.length;
//     }

//     const bodyData = new Uint8Array(startArrayBytes.length + endArrayBytes.length + dataArrayBytes.length);
//     bodyData.set(startArrayBytes, 0);
//     bodyData.set(endArrayBytes, startArrayBytes.length);
//     bodyData.set(dataArrayBytes, startArrayBytes.length + endArrayBytes.length);

//     // 5. 计算尾部偏移（相对于 body 起始）
//     const span_start_off = 0;
//     const span_end_off = startArrayBytes.length;
//     const span_data_off = startArrayBytes.length + endArrayBytes.length;

//     // 默认变换矩阵（单位矩阵）和缩放（1,1,1）
//     const transform = [
//         [1, 0, 0, 0],
//         [1, 0, 0, 0],
//         [1, 0, 0, 0],
//         [0, 0, 0, 1]
//     ];
//     const scale = [10,10,10];
//     const normalType = 2;

//     return {
//         bodyData,
//         tailer: {
//             span_start_off,
//             span_end_off,
//             span_data_off,
//             xsize,
//             ysize,
//             zsize,
//             normalType,
//             transform,
//             scale,
//         }
//     };
// }

function buildLimb(section: VoxelSection): LimbBuildResult {
    // 1. 计算体素尺寸（最大坐标+1）
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

    // 2. 构建每个 (x,y) 列的体素数组（按 z 排序）
    const spansVoxels: (voxel | null)[][] = Array(nSpans);
    for (let i = 0; i < nSpans; i++) spansVoxels[i] = new Array(zsize).fill(null);
    for (const v of section.voxels) {
        if (!v.used) continue;
        const idx = v.y * xsize + v.x;
        spansVoxels[idx][v.z] = v;
    }
    const spanArrays: voxel[][] = spansVoxels.map(arr =>
        arr.map(v => v ? v : { used: false, colour: 0, normal: 0, x: 0, y: 0, z: 0 })
    );

    // 3. 压缩跨度，记录偏移
    const spanStartOffsets = new Int32Array(nSpans);
    const spanEndOffsets = new Int32Array(nSpans);
    const compressedChunks: Uint8Array[] = [];
    let currentDataOffset = 0;
    for (let i = 0; i < nSpans; i++) {
        const hasVoxels = spanArrays[i].some(v => v.used);
        if (!hasVoxels) {
            spanStartOffsets[i] = -1;
            spanEndOffsets[i] = -1;
            continue;
        }
        const compressed = compressSpan(spanArrays[i], zsize);
        spanStartOffsets[i] = currentDataOffset;
        spanEndOffsets[i] = currentDataOffset + compressed.length;
        compressedChunks.push(compressed);
        currentDataOffset += compressed.length;
    }

    // 4. 组装 body 数据（start数组 + end数组 + data）
    const startArrayBytes = new Uint8Array(spanStartOffsets.buffer);
    const endArrayBytes = new Uint8Array(spanEndOffsets.buffer);
    const dataArrayBytes = new Uint8Array(currentDataOffset);
    let pos = 0;
    for (const chunk of compressedChunks) {
        dataArrayBytes.set(chunk, pos);
        pos += chunk.length;
    }
    const bodyData = new Uint8Array(startArrayBytes.length + endArrayBytes.length + dataArrayBytes.length);
    bodyData.set(startArrayBytes, 0);
    bodyData.set(endArrayBytes, startArrayBytes.length);
    bodyData.set(dataArrayBytes, startArrayBytes.length + endArrayBytes.length);

    // 5. 计算偏移（相对于 body 起始）
    const span_start_off = 0;
    const span_end_off = startArrayBytes.length;
    const span_data_off = startArrayBytes.length + endArrayBytes.length;

    // 6. 计算包围盒（世界坐标）
    const scaleWorld = 1 / 12;   // 固定
    // 体素坐标范围：0..maxX, 0..maxY, 0..maxZ
    const halfX = (maxX) / 2;
    const halfY = (maxY) / 2;
    // const minBounds = [-halfX, 0, -halfZ];
    // const maxBounds = [halfX, maxY, halfZ];
    const minBounds = [-halfX, -halfY, 0];
    const maxBounds = [halfX, halfY, maxZ];

    // 7. 变换矩阵（3x4，行主序）
    const transform = [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0]
    ];
    const normalType = 4;

    return {
        bodyData,
        tailer: {
            span_start_off,
            span_end_off,
            span_data_off,
            scale: scaleWorld,
            transform,
            minBounds,
            maxBounds,
            xsize,
            ysize,
            zsize,
            normalType
        }
    };
}

function writeHeader(view: DataView, offset: number, header: any) {
    for (let i = 0; i < 16; i++) {
        view.setUint8(offset + i, header.filetype.charCodeAt(i) || 0);
    }
    let pos = offset + 16;
    view.setUint32(pos, header.unknown, true); pos += 4;
    view.setUint32(pos, header.n_limbs, true); pos += 4;
    view.setUint32(pos, header.n_limbs2, true); pos += 4;
    view.setUint32(pos, header.bodysize, true); pos += 4;
    view.setUint16(pos, header.unknown2, true); pos += 2;
    // 写入调色板（256*3）
    for (let i = 0; i < 256; i++) {
        const rgb = header.palette[i];
        view.setUint8(pos++, rgb[0]);
        view.setUint8(pos++, rgb[1]);
        view.setUint8(pos++, rgb[2]);
    }
}

function writeLimbHeader(view: DataView, offset: number, name: string, number: number) {
    for (let i = 0; i < 16; i++) {
        view.setUint8(offset + i, i < name.length ? name.charCodeAt(i) : 0);
    }
    let pos = offset + 16;
    view.setUint32(pos, number, true); pos += 4;
    view.setUint32(pos, 1, true); pos += 4;   // unknown = 1
    view.setUint32(pos, 0, true);             // unknown2 = 0
}

function writeLimbTailer(view: DataView, offset: number, tail: vxl_limb_tailer) {
    let pos = offset;
    view.setUint32(pos, tail.span_start_off, true); pos += 4;
    view.setUint32(pos, tail.span_end_off, true); pos += 4;
    view.setUint32(pos, tail.span_data_off, true); pos += 4;

    view.setUint32(pos, tail.scale, true); pos += 4;

    // transform 3x4 floats
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 4; j++) {
            view.setFloat32(pos, tail.transform[i][j], true);
            pos += 4;
        }
    }
    // bounds
    for (let i = 0; i < 3; i++) {
        view.setFloat32(pos, tail.minBounds[i], true);
        pos += 4;
    }
    for (let i = 0; i < 3; i++) {
        view.setFloat32(pos, tail.maxBounds[i], true);
        pos += 4;
    }
    // xsize, ysize, zsize, normalType
    view.setUint8(pos++, tail.xsize);
    view.setUint8(pos++, tail.ysize);
    view.setUint8(pos++, tail.zsize);
    view.setUint8(pos++, tail.normalType);
}

export function buildVXL(voxel: Voxel): ArrayBuffer {
    const sections = voxel.sections;
    const nLimbs = sections.length;
    
    // 构建每个肢体
    const limbResults = sections.map(s => buildLimb(s));

    // 计算 total body size
    const totalBodySize = limbResults.reduce((sum, r) => sum + r.bodyData.length, 0);

    // 准备文件头 (802 字节)
    const header = {
        filetype: "Voxel Animation",
        unknown: 1,
        n_limbs: nLimbs,
        n_limbs2: nLimbs,
        bodysize: totalBodySize,
        unknown2: 0x1f10,
        palette: defaultPalette() // 需要提供调色板，可以从原文件继承或使用默认
    };

    // 计算总文件大小
    const totalSize = 802 + 28 * nLimbs + totalBodySize + 92 * nLimbs;
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    let offset = 0;

    // 写入文件头
    writeHeader(view, offset, header);
    offset += 802;

    // 写入肢体头
    for (let i = 0; i < nLimbs; i++) {
        const limbName = sections[i].name || `Limb${i}`;
        writeLimbHeader(view, offset, limbName, i);
        offset += 28;
    }

    // 写入所有肢体 body（连续拼接）
    const bodyStartOffset = offset;
    for (const res of limbResults) {
        for (let i = 0; i < res.bodyData.length; i++) {
            view.setUint8(offset + i, res.bodyData[i]);
        }
        offset += res.bodyData.length;
    }

    offset = bodyStartOffset + totalBodySize;
    // 写入肢体尾（每个92字节）
    for (let i = 0; i < nLimbs; i++) {
        const tail = limbResults[i].tailer;
        writeLimbTailer(view, offset, tail);
        offset += 92;
    }

    return buffer;
}