// compiler.ts
import assert from "node:assert";
import { voxel, vxl } from "./types";

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

    // 开始构建完整的文件缓冲区
    // 计算总大小：头部802 + 肢体头28*n + bodyTotalSize + 肢体尾92*n
    const totalSize = 802 + 28 * nLimbs + header.bodysize + 92 * nLimbs;
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    let offset = 0;

    // 1. 写入文件头 (802 字节)
    // filetype[16]
    for (let i = 0; i < 16; i++) {
        const ch = i < header.filetype.length ? header.filetype.charCodeAt(i) : 0;
        view.setUint8(offset + i, ch);
    }
    offset += 16;
    view.setUint32(offset, header.unknown, true); offset += 4;
    view.setUint32(offset, header.n_limbs, true); offset += 4;
    view.setUint32(offset, header.n_limbs2, true); offset += 4;
    view.setUint32(offset, header.bodysize, true); offset += 4;  // bodysize 应为所有 body 数据总大小
    view.setUint16(offset, header.unknown2, true); offset += 2;
    // palette (256 * 3)
    for (let i = 0; i < 256; i++) {
        const rgb = header.palette[i];
        view.setUint8(offset++, rgb[0]);
        view.setUint8(offset++, rgb[1]);
        view.setUint8(offset++, rgb[2]);
    }
    // 此时 offset 应该等于 802
    assert(offset === 802);

    // 2. 写入肢体头 (每个28字节)
    for (let i = 0; i < nLimbs; i++) {
        const lh = vxl.limb_header[i];
        // limb_name[16]
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

    // 3. 写入 body 区域 
    const bodyStartOffset = offset;
    offset += header.bodysize;
    for (let i = 0; i < nLimbs; i++) {
        const tailer = vxl.limb_tailer[i];
        const body = vxl.limb_body[i];
        const n = tailer.xsize * tailer.ysize;
        // write span_start
        let span_start_pos = bodyStartOffset + tailer.span_start_off;
        for (let j = 0; j < n; j++) {
            view.setInt32(span_start_pos, body.span_start[j], true);
            span_start_pos += 4;
        }
        // write span_end
        let span_end_pos = bodyStartOffset + tailer.span_end_off;
        for (let j = 0; j < n; j++) {
            view.setInt32(span_end_pos, body.span_end[j], true);
            span_end_pos += 4;
        }
        for (let j = 0; j < n; j++) {
            let spanOffset = bodyStartOffset + tailer.span_data_off + body.span_start[j];
            if (body.span_start[j] === -1 || body.span_end[j] === -1) {
                continue;
            }
            const voxels = body.span_data[j].voxels;
            const data = compressSpan(voxels, tailer.zsize);
            data.forEach(byte => {
                view.setUint8(spanOffset, byte);
                spanOffset++;
            });
        }
    }

    // 4. 写入肢体尾 (每个92字节)
    for (let i = 0; i < nLimbs; i++) {
        const tail = vxl.limb_tailer[i];
        view.setUint32(offset, tail.span_start_off, true); offset += 4;
        view.setUint32(offset, tail.span_end_off, true); offset += 4;
        view.setUint32(offset, tail.span_data_off, true); offset += 4;
        view.setFloat32(offset, tail.scale, true); offset += 4;
        // transform[4][4]
        for (let row = 0; row < 3; row++) {
            for (let col = 0; col < 4; col++) {
                view.setFloat32(offset, tail.transform[row][col], true);
                offset += 4;
            }
        }
        // minBounds[3], maxBounds[3]
        for (let i = 0; i < 3; i++) {
            view.setFloat32(offset, tail.minBounds[i], true);
            offset += 4;
        }
        for (let i = 0; i < 3; i++) {
            view.setFloat32(offset, tail.maxBounds[i], true);
            offset += 4;
        }
        view.setUint8(offset++, tail.xsize);
        view.setUint8(offset++, tail.ysize);
        view.setUint8(offset++, tail.zsize);
        view.setUint8(offset++, tail.normalType);
    }

    return buffer;
}