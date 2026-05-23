import { voxel, vxl, vxl_header, vxl_limb_body, vxl_limb_header, vxl_limb_tailer } from "./types";

export function readVxlHeader(view: DataView, offset: number = 0): vxl_header {
    let pos = offset;

    let filetype = '';
    for (let i = 0; i < 16; i++) {
        filetype += String.fromCharCode(view.getUint8(pos + i)); // get char
    }
    pos += 16;

    const unknown = view.getUint32(pos, true);
    pos += 4;

    const n_limbs = view.getUint32(pos, true);
    pos += 4;

    const n_limbs2 = view.getUint32(pos, true);
    pos += 4;

    const bodysize = view.getUint32(pos, true);
    pos += 4;

    const unknown2 = view.getUint16(pos, true);
    pos += 2;

    // resolve palette
    const palette: number[][] = [];
    for (let i = 0; i < 256; i++) {
        palette[i] = [];
        for (let j = 0; j < 3; j++) {
            palette[i][j] = view.getUint8(pos);
            pos++;
        }
    }

    return {
        filetype,
        unknown,
        n_limbs,
        n_limbs2,
        bodysize,
        unknown2,
        palette,
    }
}

export function readLimbHeader(view: DataView, offset: number = 0): vxl_limb_header {
    let pos = offset;

    let limb_name = ``;
    for (let i = 0; i < 16; i++) {
        limb_name += String.fromCharCode(view.getUint8(pos + i)); // get char
    }
    pos += 16;

    const limb_number = view.getUint32(pos, true);
    pos += 4;

    const unknown = view.getUint32(pos, true);
    pos += 4;

    const unknown2 = view.getUint32(pos, true);
    pos += 4;

    return {
        limb_name,
        limb_number,
        unknown,
        unknown2
    }
}

function decompressSpan(view: DataView, offset: number, zSize: number): { voxels: voxel[]; raw: number[], bytesRead: number } {
    let pos = offset;
    const voxels: voxel[] = new Array(zSize);
    let raw: number[] = [];
    for (let i = 0; i < zSize; i++) {
        voxels[i] = { used: false, colour: 0, normal: 0, x: 0, y: 0, z: i }; // modify here
    };

    let z = 0;
    while (z < zSize) {
        const skip = view.getUint8(pos++);
        z += skip;
        raw.push(skip);
        if (z >= zSize) break;

        const nv = view.getUint8(pos++);
        raw.push(nv);
        if (z + nv > zSize) throw new Error("Span decompression overflow");

        for (let i = 0; i < nv; i++) {
            const colour = view.getUint8(pos++);
            const normal = view.getUint8(pos++);
            voxels[z] = { used: true, colour, normal, x: 0, y: 0, z }; // modifiy here
            raw.push(colour, normal);
            z++;
        }

        const nv2 = view.getUint8(pos++);
        raw.push(nv2);
        if (nv !== nv2) throw new Error(`Mismatched nv (${nv}) vs nv2 (${nv2})`);
    }
    // magic shift I dont know but has to be
    raw.push(view.getUint8(pos), view.getUint8(pos + 1));
    pos += 2;
    return { voxels, raw, bytesRead: pos - offset };
}

export function readLimbBody(view: DataView, offset: number = 0, tailer: vxl_limb_tailer): vxl_limb_body {
    let pos = offset;
    const span_count = tailer.xsize * tailer.ysize;

    let span_start_pos = pos + tailer.span_start_off;
    const span_start: number[] = [];
    for (let i = 0; i < span_count; i++) {
        let data = view.getInt32(span_start_pos, true);
        span_start.push(data);
        span_start_pos += 4;
    }

    let span_end_pos = pos + tailer.span_end_off;
    const span_end: number[] = [];
    for (let i = 0; i < span_count; i++) {
        let data = view.getInt32(span_end_pos, true);
        span_end.push(data);
        span_end_pos += 4;
    }

    const spans: { voxels: voxel[], raw: number[] }[] = [];
    for (let j = 0; j < span_count; j++) {
        if (span_start[j] === -1 || span_end[j] === -1) {
            spans.push({ voxels: [], raw: [] });
            continue;
        }
        const spanOffset = offset + tailer.span_data_off + span_start[j];
        let { voxels, raw } = decompressSpan(view, spanOffset, tailer.zsize);
        // voxels = voxels.map(voxel => {
        //     return {
        //         ...voxel,
        //         // modifiy here if it's related to tailer or something
        //     }
        // });
        // 计算当前跨度的 x, y
        const x = j % tailer.xsize;
        const y = Math.floor(j / tailer.xsize);
        // 为每个体素设置 x, y（注意：voxels 是稀疏数组，长度等于 zsize，每个元素要么 used=false 要么 used=true）
        for (let k = 0; k < voxels.length; k++) {
            if (voxels[k].used) {
                voxels[k].x = x;
                voxels[k].y = y;
                // z 已在 decompressSpan 中设置
            }
        }
        spans.push({ voxels, raw });
    }

    return {
        span_start,
        span_end,
        span_data: spans
    };
} // skip for now

export function readLimbTailer(view: DataView, offset: number = 0): vxl_limb_tailer {
    let pos = offset;

    const span_start_off = view.getUint32(pos, true);
    pos += 4;

    const span_end_off = view.getUint32(pos, true);
    pos += 4;

    const span_data_off = view.getUint32(pos, true);
    pos += 4;

    const scale = view.getFloat32(pos, true);
    pos += 4;

    const transform: number[][] = [];
    for (let i = 0; i < 3; i++) {
        transform[i] = [];
        for (let j = 0; j < 4; j++) {
            transform[i][j] = view.getFloat32(pos, true);
            pos += 4;
        }
    }

    const minBounds: number[] = [];
    for (let i = 0; i < 3; i++) {
        minBounds[i] = view.getFloat32(pos, true);
        pos += 4;
    }

    const maxBounds: number[] = [];
    for (let i = 0; i < 3; i++) {
        maxBounds[i] = view.getFloat32(pos, true);
        pos += 4;
    }

    const xsize = view.getUint8(pos);
    pos++;
    const ysize = view.getUint8(pos);
    pos++;
    const zsize = view.getUint8(pos);
    pos++;
    const normalType = view.getUint8(pos);
    pos++;
    return {
        span_start_off,
        span_end_off,
        span_data_off,
        transform,
        scale,
        minBounds,
        maxBounds,
        xsize,
        ysize,
        zsize,
        normalType
    }
}

export function parseBuffer(buffer: ArrayBuffer): vxl {
    const view = new DataView(buffer);
    let offset = 0;

    const vxl_header = readVxlHeader(view, offset);
    offset = 802; // expected?

    const limb_header: vxl_limb_header[] = [];
    for (let i = 0; i < vxl_header.n_limbs; i++) {
        limb_header.push(readLimbHeader(view, offset));
        offset += 28;
    }

    const bodyStartOffset = offset;

    // read tailer first
    offset += vxl_header.bodysize;
    const limb_tailer: vxl_limb_tailer[] = [];
    for (let i = 0; i < vxl_header.n_limbs; i++) {
        limb_tailer.push(readLimbTailer(view, offset));
        offset += 92;
    }

    offset = bodyStartOffset;
    const limb_body: vxl_limb_body[] = [];
    for (let i = 0; i < vxl_header.n_limbs; i++) {
        let read_body = readLimbBody(view, offset, limb_tailer[i]);
        limb_body.push(read_body);
    }

    return {
        header: vxl_header,
        limb_header,
        limb_body,
        limb_tailer
    };
}