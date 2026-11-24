import { homedir } from 'node:os';
import { join } from 'node:path';

export const t3Home = process.env.CHRONOS_T3_HOME || join(homedir(), '.t3');
export const servicesData = process.env.CHRONOS_SERVICES_DATA || t3Home;
export const serviceDir = name => process.env.CHRONOS_SERVICES_DATA
  ? join(servicesData, name)
  : join(t3Home, 'caches', 't3-customizations', name);
