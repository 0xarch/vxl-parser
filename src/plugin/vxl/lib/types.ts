type vxl = {
    header: vxl_header;
    limb_header: vxl_limb_header[];
    limb_body: vxl_limb_body[];
    limb_tailer: vxl_limb_tailer[];
}

type vxl_header = {
    filetype: string; // char 16
    unknown: number; // long 4
    n_limbs: number; // long 4
    n_limbs2: number; // long 4
    bodysize: number; // long 4
    unknown2: number; // short int 2
    palette: number[][]; // byte[256][3] // or it's rgb565(cut off by 2) // we dont take care here
}

type vxl_limb_header = {
    limb_name: string; // char 16
    limb_number: number; // long 4
    unknown: number; // long 4 always 1
    unknown2: number; // long 4 always 2
}

type vxl_limb_body = {
    span_start: number[]; // long[n] 4
    span_end: number[]; // long[n] 4
    span_data: { voxels: voxel[], raw?: number[] }[]; // char[] actually
}

type vxl_limb_tailer = {
    span_start_off: number; // long 4
    span_end_off: number; // long 4
    span_data_off: number; // long 4
    scale: number; // float
    transform: number[][]; // float[4][3]
    minBounds: number[]; // float[3] // from FA2
    maxBounds: number[]; // float[3] // from FA2
    xsize: number; // char
    ysize: number; // char
    zsize: number; // char
    normalType: number; // char // from FA2 replaces unknown
}

export interface voxel {
    used: boolean;
    colour: number;
    normal: number;
    x: number;
    y: number;
    z: number;
}

export {
    vxl, vxl_header, vxl_limb_header, vxl_limb_body, vxl_limb_tailer
}