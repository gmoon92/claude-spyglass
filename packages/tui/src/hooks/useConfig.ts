import { useState, useCallback } from 'react';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface SpyglassConfig {
  warning: number;
  critical: number;
  apiUrl: string;
  pollInterval: number;
}

const DEFAULTS: SpyglassConfig = {
  warning: 5000,
  critical: 10000,
  apiUrl: 'http://localhost:9999',
  pollInterval: 5000,
};

const CONFIG_PATH = join(process.env.HOME ?? '~', '.spyglass', 'config.json');

function readConfig(): { config: SpyglassConfig; error?: string } {
  if (!existsSync(CONFIG_PATH)) {
    return { config: { ...DEFAULTS } };
  }
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<SpyglassConfig>;
    return { config: { ...DEFAULTS, ...parsed } };
  } catch {
    return { config: { ...DEFAULTS }, error: 'config.json 파싱 실패 — 기본값 사용 중' };
  }
}

function writeConfig(config: SpyglassConfig): string | null {
  try {
    const dir = join(process.env.HOME ?? '~', '.spyglass');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : '쓰기 실패';
  }
}

export interface UseConfigReturn {
  config: SpyglassConfig;
  loadError: string | undefined;
  saveError: string | null;
  save: (next: SpyglassConfig) => void;
}

export function useConfig(): UseConfigReturn {
  const { config: initial, error: loadError } = readConfig();
  const [config, setConfig] = useState<SpyglassConfig>(initial);
  const [saveError, setSaveError] = useState<string | null>(null);

  const save = useCallback((next: SpyglassConfig) => {
    const err = writeConfig(next);
    setSaveError(err);
    if (!err) setConfig(next);
  }, []);

  return { config, loadError, saveError, save };
}
