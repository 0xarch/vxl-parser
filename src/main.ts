import { readFileSync, writeFileSync } from "node:fs";
import VXLPlugin from "./plugin/vxl/main";
import VOXPlugin from "./plugin/vox/main";
import { voxPalToStandardPal } from "./tool/vox_pal";

const file_name = process.argv[2] ?? 'test.vox';

const output_file_name = process.argv[3] ?? `parsed.vxl`;
// const output_file_name = process.argv[3] ?? `${file_name}_parsed.vxl`;

console.log(`Parsing: ${file_name} -> ${output_file_name}`);

const raw_buffers = readFileSync(file_name).buffer;

// const vxl = VXLPlugin.parse(raw_buffers);

// console.log(vxl.limb_tailer[0]);

// const parsed_buffers = VXLPlugin.rebuild(vxl);

const vox = VOXPlugin.parse(raw_buffers);

const voxel = VOXPlugin.standarize(vox);

const ra_voxel = voxPalToStandardPal(voxel);

const vxl = VXLPlugin.toLocalType(ra_voxel);

const parsed_buffers = VXLPlugin.compile(vxl);
// const parsed_buffers = VOXPlugin.compile(VOXPlugin.toLocalType(ra_voxel));

writeFileSync(output_file_name, Buffer.from(parsed_buffers));