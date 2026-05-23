export interface Voxel {
    sections: VoxelSection[];
}

export interface VoxelSection {
    voxels: VoxelBlock[];
    max_bound_box: [number,number,number]; // unsigned int[3] max bound box, can include empty voxel // every voxel should have non-neg coord (at least 0,0,0)
    name: string;
}

export interface VoxelBlock {
    used: boolean;
    colour: number;
    normal: number;
    x: number;
    y: number;
    z: number;
}