import { existsSync, readFileSync, writeFileSync } from "node:fs";
import VXLPlugin from "./plugin/vxl/main";
import VOXPlugin from "./plugin/vox/main";
import { standardPalToVoxPal, voxPalToStandardPal } from "./tool/vox_pal";
import { computeVoxelNormals } from "./tool/auto_normal";

const SupportedTypes = ['vxl', 'vox'];
type __types = 'vxl' | 'vox'

// expected like "vxl-vox" , ...
const convert_type: [__types, __types] = (_ => {
    let [from, to] = process.argv[2].split('-');
    if (!SupportedTypes.includes(from)) {
        throw new Error(`Unsupported FROM type: ${from}`);
    }
    if (!SupportedTypes.includes(to)) {
        throw new Error(`Unsupported TO type: ${to}`);
    }
    return [from, to] as [__types, __types];
})();

const file_name = process.argv[3] ?? `input.${convert_type[0]}`;

const output_file_name = process.argv[4] ?? `output.${convert_type[1]}`;

console.log(`转换: ${file_name} -> ${output_file_name}`);

const raw_buffers = readFileSync(file_name).buffer;

const config = (_ => {
    let config = {
        autonormal: true,
        normalrange: 3.5,
        palettetransform: true
    };
    try {
        if (existsSync('parser.json')) {
            let conf_text = readFileSync('parser.json').toString();
            let conf = JSON.parse(conf_text);
            config = Object.assign(config, conf);
        }
    } catch (e) {
        console.log(`尝试读取配置，但遇到错误：`);
        console.error(e);
    }
    return config;
})();

let standard_voxel = (() => {
    if (convert_type[0] === 'vox') {
        let vox = VOXPlugin.parse(raw_buffers);
        return VOXPlugin.standarize(vox);
    } else {
        let vxl = VXLPlugin.parse(raw_buffers);
        return VXLPlugin.standarize(vxl);
    }
})();

if (config.palettetransform === true && convert_type[0] === 'vox') {
    standard_voxel = voxPalToStandardPal(standard_voxel);
}

if (config.palettetransform === true && convert_type[1] === 'vox') {
    standard_voxel = standardPalToVoxPal(standard_voxel);
}

if (config.autonormal) {
    // handle auto normal
    const normalrange = Number(config.normalrange) || 3.5;
    standard_voxel = computeVoxelNormals(standard_voxel, normalrange);
}

const output = (() => {
    if (convert_type[1] === 'vox') {
        let vox = VOXPlugin.toLocalType(standard_voxel);
        return VOXPlugin.compile(vox);
    } else {
        let vxl = VXLPlugin.toLocalType(standard_voxel);
        return VXLPlugin.compile(vxl);
    }
})();

writeFileSync(output_file_name, Buffer.from(output));