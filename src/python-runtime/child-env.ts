import { delimiter } from 'node:path'

import { minimalSystemPath } from './platform.js'

const REMOVE = [
  'PYTHONPATH',
  'PYTHONHOME',
  'PYTHONSTARTUP',
  'PYTHONEXECUTABLE',
  'PYTHONUSERBASE',
  'NODE_OPTIONS',
]

const REMOVE_PREFIX = ['PIP_', 'LD_', 'DYLD_']

export interface PythonEnvOptions {
  pythonDir: string
  homeDir: string
  tempDir: string
  baseEnv?: Record<string, string | undefined>
}

/**
 * Minimal environment for the private interpreter. `-I` already ignores PYTHON* variables; this
 * also removes native-loader variables and keeps the child from reading the user's home/config.
 */
export function pythonChildEnv(options: PythonEnvOptions): Record<string, string> {
  const base = options.baseEnv ?? process.env
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue
    if (REMOVE.includes(key) || REMOVE_PREFIX.some((prefix) => key.startsWith(prefix))) continue
    if (key === 'PATH' || key === 'Path') continue
    env[key] = value
  }
  env.PATH = [options.pythonDir, minimalSystemPath(base)].join(delimiter)
  env.HOME = options.homeDir
  env.USERPROFILE = options.homeDir
  env.TMPDIR = options.tempDir
  env.TEMP = options.tempDir
  env.TMP = options.tempDir
  env.PYTHONUTF8 = '1'
  env.PYTHONIOENCODING = 'utf-8'
  env.PYTHONNOUSERSITE = '1'
  env.PYTHONDONTWRITEBYTECODE = '1'
  return env
}
