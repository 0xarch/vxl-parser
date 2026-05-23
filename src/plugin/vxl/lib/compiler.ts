// compiler.ts
import assert from "node:assert";
import { voxel, vxl, vxl_limb_tailer } from "./types";

function compressSpan(voxels: voxel[], zSize: number): Uint8Array {
    const chunks: Uint8Array[] = [];
    let z = 0;
    while (z < zSize) {
        // 计算跳过的空体素数（可能为 0）
        let skip = 0;
        while (z + skip < zSize && !voxels[z + skip].used) skip++;
        // 总是写入 skip 字节（允许 0）
        chunks.push(new Uint8Array([skip]));
        z += skip;
        if (z >= zSize) break;

        // 连续非空体素块
        let nv = 0;
        while (z + nv < zSize && voxels[z + nv].used) nv++;
        if (nv === 0) continue; // 理论上不会发生

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
    // 每个跨度结束后加 2 字节填充（如需完全一致，应从原始数据复制）
    chunks.push(new Uint8Array(2));
    // 合并
    let totalLen = chunks.reduce((sum, arr) => sum + arr.length, 0);
    let result = new Uint8Array(totalLen);
    let off = 0;
    for (let arr of chunks) {
        result.set(arr, off);
        off += arr.length;
    }
    return result;
}

export function bufferify(vxl: vxl): ArrayBuffer {
    const header = vxl.header;
    const nLimbs = header.n_limbs;

    // 1. 为每个肢体重新计算压缩数据及偏移
    const limbsData: {
        span_start: Int32Array;
        span_end: Int32Array;
        compressedData: Uint8Array;
        bodySize: number;
        newTailer: vxl_limb_tailer;
    }[] = [];

    let totalBodySize = 0;
    for (let i = 0; i < nLimbs; i++) {
        const origTailer = vxl.limb_tailer[i];
        const body = vxl.limb_body[i];
        const xsize = origTailer.xsize;
        const ysize = origTailer.ysize;
        const zsize = origTailer.zsize;
        const nSpans = xsize * ysize;

        // 确保 body.span_data 长度为 nSpans，缺失的补空
        const spanArrays: voxel[][] = new Array(nSpans);
        for (let j = 0; j < nSpans; j++) {
            if (j < body.span_data.length && body.span_data[j]) {
                spanArrays[j] = body.span_data[j].voxels.slice();
            } else {
                spanArrays[j] = new Array(zsize).fill(null).map(() => ({ used: false, colour: 0, normal: 0, x: 0, y: 0, z: 0 }));
            }
        }

        // 压缩每个跨度并记录偏移
        const spanStartOffsets = new Int32Array(nSpans);
        const spanEndOffsets = new Int32Array(nSpans);
        const compressedChunks: Uint8Array[] = [];
        let dataOffset = 0;
        for (let j = 0; j < nSpans; j++) {
            const hasVoxels = spanArrays[j].some(v => v.used);
            if (!hasVoxels) {
                spanStartOffsets[j] = -1;
                spanEndOffsets[j] = -1;
                continue;
            }
            const compressed = compressSpan(spanArrays[j], zsize);
            spanStartOffsets[j] = dataOffset;
            spanEndOffsets[j] = dataOffset + compressed.length;
            compressedChunks.push(compressed);
            dataOffset += compressed.length;
        }

        // 合并压缩数据
        const compressedData = new Uint8Array(dataOffset);
        let pos = 0;
        for (const chunk of compressedChunks) {
            compressedData.set(chunk, pos);
            pos += chunk.length;
        }

        const startArrayBytes = nSpans * 4;
        const endArrayBytes = nSpans * 4;
        const dataArrayBytes = dataOffset;
        const bodySize = startArrayBytes + endArrayBytes + dataArrayBytes;

        // 新的肢体尾（保留原 tailer 的其他字段，更新偏移）
        const newTailer = {
            ...origTailer,
            span_start_off: totalBodySize,
            span_end_off: totalBodySize + startArrayBytes,
            span_data_off: totalBodySize + startArrayBytes + endArrayBytes,
        };

        limbsData.push({
            span_start: spanStartOffsets,
            span_end: spanEndOffsets,
            compressedData,
            bodySize,
            newTailer
        });
        totalBodySize += bodySize;
    }

    // 更新头部 bodysize
    const newHeader = { ...header, bodysize: totalBodySize };

    // 2. 计算总文件大小并分配缓冲区
    const totalSize = 802 + 28 * nLimbs + totalBodySize + 92 * nLimbs;
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    let offset = 0;

    // 3. 写入文件头（使用 newHeader）
    for (let i = 0; i < 16; i++) {
        const ch = i < newHeader.filetype.length ? newHeader.filetype.charCodeAt(i) : 0;
        view.setUint8(offset + i, ch);
    }
    offset += 16;
    view.setUint32(offset, newHeader.unknown, true); offset += 4;
    view.setUint32(offset, newHeader.n_limbs, true); offset += 4;
    view.setUint32(offset, newHeader.n_limbs2, true); offset += 4;
    view.setUint32(offset, newHeader.bodysize, true); offset += 4;
    view.setUint16(offset, newHeader.unknown2, true); offset += 2;
    for (let i = 0; i < 256; i++) {
        const rgb = newHeader.palette[i];
        view.setUint8(offset++, rgb[0]);
        view.setUint8(offset++, rgb[1]);
        view.setUint8(offset++, rgb[2]);
    }
    assert(offset === 802);

    // 4. 写入肢体头
    for (let i = 0; i < nLimbs; i++) {
        const lh = vxl.limb_header[i];
        for (let j = 0; j < 16; j++) {
            const ch = j < lh.limb_name.length ? lh.limb_name.charCodeAt(j) : 0;
            view.setUint8(offset + j, ch);
        }
        offset += 16;
        view.setUint32(offset, lh.limb_number, true); offset += 4;
        view.setUint32(offset, lh.unknown, true); offset += 4;
        view.setUint32(offset, lh.unknown2, true); offset += 4;
    }
    assert(offset === 802 + nLimbs * 28);

    // 5. 写入 body 区域（连续拼接）
    const bodyStartOffset = offset;
    let currentBodyOff = bodyStartOffset;
    for (let i = 0; i < nLimbs; i++) {
        const data = limbsData[i];
        // span_start 数组
        for (let j = 0; j < data.span_start.length; j++) {
            view.setInt32(currentBodyOff + j * 4, data.span_start[j], true);
        }
        currentBodyOff += data.span_start.length * 4;
        // span_end 数组
        for (let j = 0; j < data.span_end.length; j++) {
            view.setInt32(currentBodyOff + j * 4, data.span_end[j], true);
        }
        currentBodyOff += data.span_end.length * 4;
        // compressedData
        for (let j = 0; j < data.compressedData.length; j++) {
            view.setUint8(currentBodyOff + j, data.compressedData[j]);
        }
        currentBodyOff += data.compressedData.length;
    }
    offset = bodyStartOffset + totalBodySize;
    assert(offset === bodyStartOffset + totalBodySize);

    // 6. 写入肢体尾（使用 newTailer）
    for (let i = 0; i < nLimbs; i++) {
        const tail = limbsData[i].newTailer;
        view.setUint32(offset, tail.span_start_off, true); offset += 4;
        view.setUint32(offset, tail.span_end_off, true); offset += 4;
        view.setUint32(offset, tail.span_data_off, true); offset += 4;
        view.setFloat32(offset, tail.scale, true); offset += 4;
        for (let row = 0; row < 3; row++) {
            for (let col = 0; col < 4; col++) {
                view.setFloat32(offset, tail.transform[row][col], true);
                offset += 4;
            }
        }
        for (let i = 0; i < 3; i++) {
            view.setFloat32(offset, tail.minBounds[i], true); offset += 4;
        }
        for (let i = 0; i < 3; i++) {
            view.setFloat32(offset, tail.maxBounds[i], true); offset += 4;
        }
        view.setUint8(offset++, tail.xsize);
        view.setUint8(offset++, tail.ysize);
        view.setUint8(offset++, tail.zsize);
        view.setUint8(offset++, tail.normalType);
    }

    return buffer;
}