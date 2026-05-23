import { Voxel, VoxelBlock, VoxelSection } from "../../types";
import { bufferify } from "./lib/compiler";
import { defaultPalette } from "./lib/misc";
import { parseBuffer } from "./lib/parser";
import { voxelToVxl } from "./lib/targeter";
import { vxl, vxl_header } from "./lib/types";

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
            const maxX = tailer.xsize - 1;
            const maxY = tailer.ysize - 1;
            const maxZ = tailer.zsize - 1;

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
                    }
                }
            }

            sections.push({
                name,
                max_bound_box: [maxX, maxY, maxZ],
                voxels
            });
        }

        return { sections };
    }

    static rebuild(vxl: vxl): ArrayBuffer {
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