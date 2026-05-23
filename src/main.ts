import { readFileSync, writeFileSync } from "node:fs";
import VXLPlugin from "./plugin/vxl/main";
import VOXPlugin from "./plugin/vox/main";
import { standardPalToVoxPal, voxPalToStandardPal } from "./tool/vox_pal";
import { computeVoxelNormals } from "./tool/auto_normal";

const SupportedTypes = ['vxl', 'vox'];
type __types = 'vxl' | 'vox'

// expected like "vxl-vox" , ...
const convert_type: [__types, __types] = (_ => {
    let [from, to] = process.argv[2].split('-');
    if(!SupportedTypes.includes(from)) {
        throw new Error(`Unsupported FROM type: ${from}`);
    }
    if(!SupportedTypes.includes(to)) {
        throw new Error(`Unsupported TO type: ${to}`);
    }
    return [from, to] as [__types, __types];
})();

const file_name = process.argv[3] ?? `input.${convert_type[0]}`;

const output_file_name = process.argv[4] ?? `output.${convert_type[1]}`;

console.log(`Parsing: ${file_name} -> ${output_file_name}`);

const raw_buffers = readFileSync(file_name).buffer;

let standard_voxel = (() => {
    if (convert_type[0] === 'vox') {
        let vox = VOXPlugin.parse(raw_buffers);
        return VOXPlugin.standarize(vox);
    } else {
        let vxl = VXLPlugin.parse(raw_buffers);
        return VXLPlugin.standarize(vxl);
    }
})();

if(convert_type[0] === 'vox') {
    standard_voxel = voxPalToStandardPal(standard_voxel);
}

if(convert_type[1] === 'vox') {
    standard_voxel = standardPalToVoxPal(standard_voxel);
}

// handle auto normal
standard_voxel = computeVoxelNormals(standard_voxel, 3.4, true);

const output = (()=>{
    if (convert_type[1] === 'vox') {
        let vox = VOXPlugin.toLocalType(standard_voxel);
        return VOXPlugin.compile(vox);
    } else {
        let vxl = VXLPlugin.toLocalType(standard_voxel);
        return VXLPlugin.compile(vxl);
    }
})();

writeFileSync(output_file_name, Buffer.from(output));