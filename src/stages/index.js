import stage1 from './stage1.js';
import stage2 from './stage2.js';

export const stages = [stage1, stage2];
export const stageById = (id) => stages.find((s) => s.id === id);
