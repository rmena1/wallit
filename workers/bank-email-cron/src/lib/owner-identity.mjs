import { config } from '../config/index.mjs';
const normalized = name => String(name).normalize('NFC').toLowerCase().replace(/\s+/g, '');
export const isOwnerName = name => config.ownerNames.some(owner => normalized(owner) === normalized(name));
