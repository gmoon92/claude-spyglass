/** @jsxImportSource react */
import { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { useConfig } from '../hooks/useConfig';
import type { SpyglassConfig } from '../hooks/useConfig';

export interface SettingsTabProps {
  isActive?: boolean;
}

const FIELDS: Array<{ key: keyof SpyglassConfig; label: string; hint: string }> = [
  { key: 'warning', label: 'Warning Threshold (tokens)', hint: '이 토큰 수 초과 시 경고' },
  { key: 'critical', label: 'Critical Threshold (tokens)', hint: '이 토큰 수 초과 시 위험' },
  { key: 'apiUrl', label: 'API Server URL', hint: 'spyglass 서버 주소' },
  { key: 'pollInterval', label: 'Poll Interval (ms)', hint: '자동 갱신 주기' },
];

export function SettingsTab({ isActive = false }: SettingsTabProps): JSX.Element {
  const { config, loadError, saveError, save } = useConfig();
  const [cursor, setCursor] = useState(0);
  const [editValue, setEditValue] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // 저장 성공 피드백 1초 후 소거
  useEffect(() => {
    if (!saved) return;
    const id = setTimeout(() => setSaved(false), 1000);
    return () => clearTimeout(id);
  }, [saved]);

  useInput((input, key) => {
    if (!isActive) return;

    if (editValue !== null) {
      // 편집 모드
      if (key.return) {
        const field = FIELDS[cursor];
        const numFields = ['warning', 'critical', 'pollInterval'] as const;
        const isNum = (numFields as readonly string[]).includes(field.key);
        const parsed = isNum ? parseInt(editValue, 10) : editValue;
        if (isNum && isNaN(parsed as number)) {
          setEditValue(null);
          return;
        }
        const next = { ...config, [field.key]: parsed };
        save(next);
        setSaved(true);
        setEditValue(null);
      } else if (key.escape) {
        setEditValue(null);
      } else if (key.backspace || key.delete) {
        setEditValue(prev => (prev ?? '').slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setEditValue(prev => (prev ?? '') + input);
      }
    } else {
      // 탐색 모드
      if (key.upArrow) setCursor(prev => Math.max(0, prev - 1));
      else if (key.downArrow) setCursor(prev => Math.min(FIELDS.length - 1, prev + 1));
      else if (key.return) {
        setEditValue(String(config[FIELDS[cursor].key]));
      }
    }
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold color="cyan">Settings</Text>

      {loadError && (
        <Box marginY={1}>
          <Text color="yellow">⚠ {loadError}</Text>
        </Box>
      )}

      <Box flexDirection="column" marginTop={1}>
        {FIELDS.map((field, index) => {
          const isCursor = index === cursor;
          const isEditing = isCursor && editValue !== null;
          const displayVal = isEditing ? editValue : String(config[field.key]);

          return (
            <Box key={field.key} flexDirection="column" marginBottom={1}>
              <Box>
                <Text color={isCursor ? 'cyan' : 'gray'} bold={isCursor}>
                  {isCursor ? '> ' : '  '}
                </Text>
                <Text color={isCursor ? 'cyan' : 'white'} bold={isCursor}>
                  {field.label}
                </Text>
              </Box>
              <Box marginLeft={4}>
                {isEditing ? (
                  <Text color="yellow" bold>{displayVal}<Text color="gray">█</Text></Text>
                ) : (
                  <Text color="green">{displayVal}</Text>
                )}
              </Box>
              {isCursor && (
                <Box marginLeft={4}>
                  <Text color="gray" dimColor>{field.hint}</Text>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      {/* 저장 상태 */}
      <Box marginTop={1}>
        {saveError ? (
          <Text color="red">✗ 저장 실패: {saveError}</Text>
        ) : saved ? (
          <Text color="green">✓ 저장됨</Text>
        ) : null}
      </Box>

      <Box marginTop={1}>
        <Text color="gray">↑↓ Navigate | Enter Edit/Save | ESC Cancel</Text>
      </Box>
    </Box>
  );
}
