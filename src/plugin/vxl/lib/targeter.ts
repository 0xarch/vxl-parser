import { Voxel, VoxelSection } from "../../../types";
import { vxl, vxl_header, vxl_limb_header, vxl_limb_body, vxl_limb_tailer, voxel } from "./types";
import { defaultPalette } from "./misc";

/**
 * 将标准化 Voxel 对象转换为 vxl 中间格式
 */
export function voxelToVxl(voxel: Voxel, palette?: number[][]): vxl {
    const sections = voxel.sections;
    const nLimbs = sections.length;

    const limb_headers: vxl_limb_header[] = [];
    const limb_bodies: vxl_limb_body[] = [];
    const limb_tailers: vxl_limb_tailer[] = [];

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
        for (let i = 0; i < nSpans; i++) {
            spansVoxels[i] = new Array(zsize).fill(null);
        }
        
        for (const v of section.voxels) {
            if (!v.used) continue;
            const idx = v.y * xsize + v.x;
            spansVoxels[idx][v.z] = { 
                used: true, 
                colour: v.colour, 
                normal: v.normal, 
                x: v.x, 
                y: v.y, 
                z: v.z 
            };
        }

        // 3. 转换为 voxel[] 数组（未使用的填充 used=false）
        const spanArrays: voxel[][] = spansVoxels.map(arr =>
            arr.map(v => v ? v : { used: false, colour: 0, normal: 0, x: 0, y: 0, z: 0 })
        );

        // 4. 构建 span_data 数组（存储解压后的体素）
        const span_data = new Array(nSpans);
        for (let i = 0; i < nSpans; i++) {
            span_data[i] = { voxels: spanArrays[i] };
        }

        // 5. 肢体体（span_start/span_end: bufferify 会重新计算）
        //    但为了类型安全，填充为长度为 nSpans 的 -1 数组
        const limb_body: vxl_limb_body = {
            span_start: new Array(nSpans).fill(-1),
            span_end: new Array(nSpans).fill(-1),
            span_data
        };

        // 6. 肢体尾字段（偏移量会在 bufferify 中重新计算，任意）
        const scaleWorld = 1 / 12;
        const halfX = maxX / 2;
        const halfY = maxY / 2;
        const minBounds = [-halfX, -halfY, 0];
        const maxBounds = [halfX, halfY, maxZ];
        const transform = [
            [1, 0, 0, 0],
            [0, 1, 0, 0],
            [0, 0, 1, 0]
        ];
        const normalType = 4; // RA2

        const limb_tailer: vxl_limb_tailer = {
            span_start_off: 0,      // 占位，bufferify 会覆盖
            span_end_off: 0,        // 占位，bufferify 会覆盖
            span_data_off: 0,       // 占位，bufferify 会覆盖
            scale: scaleWorld,
            transform,
            minBounds,
            maxBounds,
            xsize,
            ysize,
            zsize,
            normalType
        };

        // 7. 肢体头
        const limbName = section.name || `Limb${limbIdx}`;
        limb_headers.push({
            limb_name: limbName.slice(0, 15),
            limb_number: limbIdx,
            unknown: 1,
            unknown2: 0
        });

        limb_bodies.push(limb_body);
        limb_tailers.push(limb_tailer);
    }

    // 8. 文件头（bodysize 会在 bufferify 中重新计算，这里先设为 0）
    const header: vxl_header = {
        filetype: "Voxel Animation",
        unknown: 1,
        n_limbs: nLimbs,
        n_limbs2: nLimbs,
        bodysize: 0,  // 占位，bufferify 会重新计算
        unknown2: 0x1f10,
        palette: palette || defaultPalette()
    };

    return { header, limb_header: limb_headers, limb_body: limb_bodies, limb_tailer: limb_tailers };
}