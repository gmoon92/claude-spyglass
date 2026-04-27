/**
 * Analysis Tab Component
 *
 * @description TOP 소모 요청, 통계 분석
 */

/** @jsxImportSource react */
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useAnalysis } from '../hooks/useAnalysis';
import type { AnalysisResult } from '../hooks/useAnalysis';
import { RequestTypeFormatter, TokenFormatter } from '../formatters';


/**
 * Analysis Tab props
 */
export interface AnalysisTabProps {
  isActive?: boolean;
  apiUrl?: string;
  /** ADR-013: Top Requests에서 Enter 시 세션 점프 */
  onSessionSelect?: (sessionId: string) => void;
}


/**
 * Analysis Tab 컴포넌트
 */
export function AnalysisTab({ isActive = false, apiUrl, onSessionSelect }: AnalysisTabProps): JSX.Element {
  const [activeSection, setActiveSection] = useState(0);
  const [selectedRow, setSelectedRow] = useState(0);
  const { data, loading } = useAnalysis({ apiUrl });

  const sections = ['Overview', 'Top Requests', 'By Type', 'By Tool'];

  // 키보드 핸들링 — isActive 가드로 비활성 탭 이벤트 차단
  useInput((_input, key) => {
    if (!isActive) return;
    if (key.leftArrow) {
      setActiveSection(prev => Math.max(0, prev - 1));
      setSelectedRow(0);
    } else if (key.rightArrow) {
      setActiveSection(prev => Math.min(sections.length - 1, prev + 1));
      setSelectedRow(0);
    } else if (activeSection === 1 && key.upArrow) {
      setSelectedRow(prev => Math.max(0, prev - 1));
    } else if (activeSection === 1 && key.downArrow) {
      const max = Math.min((data?.topRequests?.length ?? 0) - 1, 9);
      setSelectedRow(prev => Math.min(max, prev + 1));
    } else if (activeSection === 1 && key.return && onSessionSelect) {
      // ADR-013: Top Requests Enter → 세션 점프
      const req = data?.topRequests?.[selectedRow] as any;
      const sid = req?.session_id;
      if (sid) onSessionSelect(sid);
    }
  });

  if (loading && !data) {
    return (
      <Box flexDirection="column" padding={2}>
        <Text color="yellow">Loading analysis data...</Text>
      </Box>
    );
  }

  if (!data || (!data.topRequests.length && !data.typeStats.length && !data.toolStats.length)) {
    return (
      <Box flexDirection="column" padding={2}>
        <Text color="gray">데이터가 없습니다</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {/* 섹션 탭 */}
      <Box marginBottom={1}>
        {sections.map((section, index) => (
          <Box key={section} paddingX={2}>
            <Text color={index === activeSection ? 'cyan' : 'gray'} bold={index === activeSection}>
              {index === activeSection ? '> ' : '  '}{section}
            </Text>
          </Box>
        ))}
      </Box>

      {/* 섹션 컨텐츠 */}
      <Box flexDirection="column">
        {activeSection === 0 && <OverviewSection data={data} />}
        {activeSection === 1 && <TopRequestsSection requests={data.topRequests} selectedRow={selectedRow} canJump={!!onSessionSelect} />}
        {activeSection === 2 && <ByTypeSection stats={data.typeStats} />}
        {activeSection === 3 && <ByToolSection stats={data.toolStats} />}
      </Box>

      {/* 오류 인라인 표시 */}
      {(data.errors.top || data.errors.type || data.errors.tool) && (
        <Box marginTop={1}>
          <Text color="red" dimColor>일부 데이터 로드 실패 — 재시도 중</Text>
        </Box>
      )}

      {/* 도움말 */}
      <Box marginTop={1}>
        <Text color="gray">←→ Switch Section</Text>
      </Box>
    </Box>
  );
}

/**
 * Overview 섹션
 */
function OverviewSection({ data }: { data: AnalysisResult }): JSX.Element {
  const totalRequests = data.typeStats.reduce((sum, s) => sum + s.count, 0);
  const totalTokens = data.typeStats.reduce((sum, s) => sum + s.total_tokens, 0);
  const avgTokens = totalRequests > 0 ? Math.round(totalTokens / totalRequests) : 0;

  return (
    <Box flexDirection="column">
      <Text bold underline color="cyan">Summary</Text>
      <Box flexDirection="row" marginY={1}>
        <Box width="33%">
          <Text color="gray">Total Requests</Text>
          <Text bold>{totalRequests}</Text>
        </Box>
        <Box width="33%">
          <Text color="gray">Total Tokens</Text>
          <Text bold color="yellow">{TokenFormatter.format(totalTokens)}</Text>
        </Box>
        <Box width="33%">
          <Text color="gray">Avg Tokens/Req</Text>
          <Text bold>{TokenFormatter.format(avgTokens)}</Text>
        </Box>
      </Box>
    </Box>
  );
}

/**
 * TOP Requests 섹션 (ADR-013 — selectedRow + Enter 점프)
 */
function TopRequestsSection({
  requests,
  selectedRow = 0,
  canJump = false,
}: {
  requests: AnalysisResult['topRequests'];
  selectedRow?: number;
  canJump?: boolean;
}): JSX.Element {
  return (
    <Box flexDirection="column">
      <Text bold underline color="cyan">Top Token Consumers</Text>
      <Box marginTop={1}>
        <Box width="6%"><Text bold> </Text></Box>
        <Box width="10%"><Text bold>#</Text></Box>
        <Box width="24%"><Text bold>Type</Text></Box>
        <Box width="40%"><Text bold>Tool/Model</Text></Box>
        <Box width="20%" justifyContent="flex-end"><Text bold>Tokens</Text></Box>
      </Box>
      {requests.slice(0, 10).map((req, index) => {
        const isSelected = index === selectedRow;
        const prefix = isSelected ? '> ' : '  ';
        const baseColor = isSelected ? 'cyan' : 'gray';
        return (
          <Box key={req.id} height={1}>
            <Box width="6%"><Text color={baseColor} bold={isSelected}>{prefix}</Text></Box>
            <Box width="10%"><Text color={baseColor}>{index + 1}</Text></Box>
            <Box width="24%">
              <Text color={RequestTypeFormatter.getColor(req.type)}>{req.type}</Text>
            </Box>
            <Box width="40%">
              <Text wrap="truncate" color={isSelected ? 'cyan' : 'white'} bold={isSelected}>{req.tool_name || '-'}</Text>
            </Box>
            <Box width="20%" justifyContent="flex-end">
              <Text color="yellow">{TokenFormatter.format(req.tokens_total)}</Text>
            </Box>
          </Box>
        );
      })}
      {canJump && requests.length > 0 && (
        <Box marginTop={1}>
          <Text color="gray">↑↓ Navigate | Enter → 세션 점프</Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * By Type 섹션
 */
function ByTypeSection({
  stats,
}: {
  stats: AnalysisResult['typeStats'];
}): JSX.Element {
  const totalTokens = stats.reduce((sum, s) => sum + s.total_tokens, 0);

  return (
    <Box flexDirection="column">
      <Text bold underline color="cyan">Requests by Type</Text>
      <Box marginTop={1}>
        <Box width="30%"><Text bold>Type</Text></Box>
        <Box width="20%"><Text bold>Count</Text></Box>
        <Box width="25%" justifyContent="flex-end"><Text bold>Tokens</Text></Box>
        <Box width="25%" justifyContent="flex-end"><Text bold>%</Text></Box>
      </Box>
      {stats.map(stat => {
        const percentage = totalTokens > 0 ? (stat.total_tokens / totalTokens) * 100 : 0;
        return (
          <Box key={stat.type} height={1}>
            <Box width="30%">
              <Text color={RequestTypeFormatter.getColor(stat.type)}>{stat.type}</Text>
            </Box>
            <Box width="20%"><Text>{stat.count}</Text></Box>
            <Box width="25%" justifyContent="flex-end">
              <Text color="yellow">{TokenFormatter.format(stat.total_tokens)}</Text>
            </Box>
            <Box width="25%" justifyContent="flex-end">
              <Text color="gray">{percentage.toFixed(1)}%</Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * By Tool 섹션
 */
function ByToolSection({
  stats,
}: {
  stats: AnalysisResult['toolStats'];
}): JSX.Element {
  return (
    <Box flexDirection="column">
      <Text bold underline color="cyan">Top Tools</Text>
      <Box marginTop={1}>
        <Box width="40%"><Text bold>Tool</Text></Box>
        <Box width="30%"><Text bold>Calls</Text></Box>
        <Box width="30%" justifyContent="flex-end"><Text bold>Tokens</Text></Box>
      </Box>
      {stats.slice(0, 10).map(stat => (
        <Box key={stat.tool_name} height={1}>
          <Box width="40%"><Text color="yellow">{stat.tool_name}</Text></Box>
          <Box width="30%"><Text>{stat.call_count}</Text></Box>
          <Box width="30%" justifyContent="flex-end">
            <Text color="cyan">{TokenFormatter.format(stat.total_tokens)}</Text>
          </Box>
        </Box>
      ))}
    </Box>
  );
}
