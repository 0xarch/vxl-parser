import { Voxel, VoxelBlock, VoxelSection } from "../../types.js";
import { bufferify } from "./lib/compiler.js";
import { defaultPalette } from "./lib/misc.js";
import { parseBuffer } from "./lib/parser.js";
import { voxelToVxl } from "./lib/targeter.js";
import { vxl, vxl_header } from "./lib/types.js";

export default class VXLPlugin {
    static parse(buffer: ArrayBuffer): vxl {
        return parseBuffer(buffer);
    }

    static compile(vxl: vxl): ArrayBuffer {
        return bufferify(vxl);
    }

    static standarize(vxl: vxl): Voxel {
        const sections: VoxelSection[] = [];

        for (let i = 0; i < vxl.header.n_limbs; i++) {
            const name = vxl.limb_header[i].limb_name.trim(); // 去除可能的尾部空字符
            const tailer = vxl.limb_tailer[i];
            const body = vxl.limb_body[i];

            // 边界框最大值 = 尺寸 - 1（因为坐标从 0 开始）
            // const maxX = tailer.xsize - 1;
            // const maxY = tailer.ysize - 1;
            // const maxZ = tailer.zsize - 1;
            let maxX = 0, maxY = 0, maxZ = 0;

            const voxels: VoxelBlock[] = [];

            // 遍历该肢体的所有跨度
            for (const span of body.span_data) {
                // 遍历该跨度内的每个体素位置（根据 z 索引）
                for (const vox of span.voxels) {
                    if (vox.used) {
                        voxels.push({
                            used: true,
                            colour: vox.colour,
                            normal: vox.normal,
                            x: vox.x,
                            y: vox.y,
                            z: vox.z
                        });
                        maxX = Math.max(maxX, vox.x);
                        maxY = Math.max(maxY, vox.y);
                        maxZ = Math.max(maxZ, vox.z);
                    }
                }
            }

            maxX += 1;
            maxY += 1;
            maxZ += 1;

            // calc offset
            const offset_x = (tailer.maxBounds[0] + tailer.minBounds[0]);
            const offset_y = (tailer.maxBounds[1] + tailer.minBounds[1]);
            // const offset_z = (tailer.maxBounds[2] + tailer.maxBounds[2]) / 2;
            const offset_z = tailer.maxBounds[2] - (tailer.zsize + maxZ) / 2;

            // console.log(tailer.maxBounds, tailer.minBounds, [offset_x, offset_y], [tailer.xsize, tailer.ysize], [maxX, maxY]);

            sections.push({
                name,
                max_bound_box: [maxX, maxY, maxZ],
                voxels,
                offset_x,
                offset_y,
                offset_z
            });
        }

        return { sections };
    }

    static rebuild(buffer: ArrayBuffer): ArrayBuffer {
        let vxl = this.parse(buffer);

        let standard = this.standarize(vxl);

        let rebuilded = this.toLocalType(standard);

        let result = this.compile(rebuilded);

        return result;
    }

    static toLocalType(voxel: Voxel): vxl {
        const vxl = voxelToVxl(voxel, defaultPalette());
        return vxl;
    }
}