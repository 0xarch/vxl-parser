import { VoxData } from "./types";
import { parseBuffer } from "./parser";
import { bufferify } from "./compiler";
import { standarize, toLocalType } from "./standard";
import { Voxel } from "../../types";

export default class VOXPlugin {
    static parse(buffer: ArrayBuffer): VoxData {
        return parseBuffer(buffer);
    }

    static compile(vox: VoxData): ArrayBuffer {
        return bufferify(vox);
    }

    static standarize(vox: VoxData): Voxel {
        return standarize(vox);
    }

    static toLocalType(voxel: Voxel): VoxData {
        return toLocalType(voxel);
    }

    static rebuild(buffer: ArrayBuffer): ArrayBuffer {
        let lay1 = this.parse(buffer);
        let lay2 = standarize(lay1);
        let lay3 = toLocalType(lay2);
        let lay4 = this.compile(lay3);
        return lay4;
    }
}