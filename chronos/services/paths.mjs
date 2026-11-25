import { homedir } from 'node:os';
import { workerData } from 'node:worker_threads';
import { join, resolve } from 'node:path';

export const t3Home = process.env.CHRONOS_T3_HOME || join(homedir(), '.t3');
export const servicesData = process.env.CHRONOS_SERVICES_DATA || t3Home;
export const serviceDir = name => process.env.CHRONOS_SERVICES_DATA
  ? join(servicesData, name)
  : join(t3Home, 'caches', 't3-customizations', name);

// A worker shares the host cwd. Resolve relative API paths as in the standalone entry.
export const resolveServicePath = (...parts) => resolve(workerData?.serviceCwd ?? process.cwd(), ...parts);
