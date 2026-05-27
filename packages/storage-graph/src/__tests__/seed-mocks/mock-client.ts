/**
 * mock-client.ts — in-memory MockLadybugClient (테스트 전용)
 *
 * 책임 (Single Responsibility):
 *   `LadybugClient` 의 표면(`query`, `transaction`, `isReady`, `close`) 을 in-memory
 *   자료구조로 흉내내어 sequential-flow.ts 가 발행하는 4개 Cypher 패턴을 정확히
 *   실행한다. 본 모듈은 *테스트 격리* 가 유일 목표 — production code 가 절대 본
 *   파일에 의존해서는 안 된다 (storage-graph index.ts 가 export 하지 않음).
 *
 * 의존성:
 *   - 없음 (pure in-memory).
 *
 * 호출 흐름:
 *   __tests__/sequential-flow.test.ts
 *     → 세트 A/B/C 시드 함수가 본 client 의 `_mockSeed*` 메서드로 데이터 주입
 *     → getSequentialFlow(client, ...) 호출
 *     → client.query() 가 Cypher 패턴 매칭으로 정답 반환
 *
 * 지원 Cypher 패턴 (sequential-flow.ts 의 4개 + V-1~V-5 의 변형):
 *   P1 — Seed query:
 *        MATCH (md:MetaDocument {kind: $centerKind, name: $centerName})
 *               <-[:USES]-(seed:ToolCall) ...
 *   P2 — Chain traversal:
 *        MATCH path = (seed:ToolCall) -[:PARENT_OF*1..N]-> (child:ToolCall)
 *               -[:USES]->(metadoc:MetaDocument) ...
 *   P3 — Turn-after:
 *        MATCH (center_md ...) <-[:USES]-(seed) <-[:CALLED]-(:Agent)<-[:SPAWNED]-(t:Turn) ...
 *        WITH t, max(seed.started_at) AS center_at ...
 *        MATCH (t)-[:SPAWNED]->(:Agent)-[:CALLED]->(later:ToolCall) ...
 *   P4 — Self-loop count (V-5):
 *        MATCH (md ...) <-[:USES]-(seed) -[:PARENT_OF*1..N]-> (child)
 *               -[:USES]->(metadoc {kind=center,name=center}) RETURN count(*)
 *
 * 디자인 결정:
 *   - 정규식으로 cypher 문자열의 시작 토큰만 보고 패턴 식별. parser 만들지 않음.
 *   - parameter 바인딩은 `$name` placeholder 를 params 객체 키로 매칭.
 *   - 가변 깊이 `*1..N` 의 N 은 Cypher 텍스트에서 정규식 추출.
 *   - 결과는 production 의 `LadybugQueryResult.rows: Record<string,unknown>[]` 형태.
 */

import type { LadybugClient, LadybugQueryResult } from '../../client';

// =============================================================================
// in-memory 그래프 모델 — production 의 Cypher 노드/엣지 시맨틱 일부만 흉내
// =============================================================================

/** 노드 1개. label = Cypher node label (Session/Turn/Agent/ToolCall/Event/MetaDocument). */
interface MockNode {
  label: string;
  props: Record<string, unknown>;
}

/** 엣지 1개. type = REL TABLE 이름 (CONTAINS/NEXT/SPAWNED/CALLED/PARENT_OF/PRODUCED/USES/CARRIES). */
interface MockEdge {
  from_label: string;
  from_key: string; // primary key 값 (예: tool_use_id 또는 id)
  to_label: string;
  to_key: string;
  type: string;
  props: Record<string, unknown>;
}

/**
 * MockLadybugClient — `LadybugClient` 의 표면을 만족.
 *
 * production 코드가 본 인스턴스를 받아도 같은 인터페이스로 동작해야 한다 — TypeScript
 * structural typing 에 의존. `getLadybugClient()` 글로벌 싱글톤은 우회한다.
 */
export class MockLadybugClient {
  private nodes: MockNode[] = [];
  private edges: MockEdge[] = [];
  private ready = true;

  // ───────────────────────────────────────────────────────────────────────
  // LadybugClient 표면 — sequential-flow.ts 가 의존하는 4개 메서드.
  // ───────────────────────────────────────────────────────────────────────

  isReady(): boolean {
    return this.ready;
  }

  close(): void {
    this.ready = false;
  }

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    return work(); // mock 은 트랜잭션 격리 시뮬레이션 안 함 — 테스트 결정성에 무관.
  }

  /**
   * Cypher 패턴 매칭 후 결과 반환. 본 메서드가 mock 의 핵심.
   *
   * 매칭 순서: 가장 구체적 패턴부터. P3 (turn-after, 다단 join) 을 먼저, P2 다음,
   * P1 다음, P4 (count) 다음. fallthrough 무시 패턴은 빈 결과 반환 + console.warn.
   */
  async query(cypher: string, params: Record<string, unknown> = {}): Promise<LadybugQueryResult> {
    const started = Date.now();
    const text = cypher.replace(/\s+/g, ' ').trim();

    // P5 — cohort meta timeline (unified-flow 의 신규 시퀀스 복원 쿼리).
    if (this.isCohortTimelinePattern(text)) {
      const rows = this.runCohortTimeline(text, params);
      return { rows, durationMs: Date.now() - started };
    }

    // V-5 self-loop count — 가장 구체적 패턴부터.
    if (this.isSelfLoopCountPattern(text)) {
      const rows = this.runSelfLoopCount(text, params);
      return { rows, durationMs: Date.now() - started };
    }

    // P3 — turn-after (다단 SPAWNED → CALLED).
    if (this.isTurnAfterPattern(text)) {
      const rows = this.runTurnAfter(text, params);
      return { rows, durationMs: Date.now() - started };
    }

    // unified-flow: ancestor chain — (ancestor)-[:PARENT_OF*1..N]->(seed). seedIds 쪽이 target.
    if (this.isAncestorChainPattern(text)) {
      const rows = this.runAncestorChain(text, params);
      return { rows, durationMs: Date.now() - started };
    }

    // P2 — chain traversal (가변 깊이 *1..N).
    if (this.isChainTraversalPattern(text)) {
      const rows = this.runChainTraversal(text, params);
      return { rows, durationMs: Date.now() - started };
    }

    // P1 — seed query (단일 USES).
    if (this.isSeedPattern(text)) {
      const rows = this.runSeedQuery(text, params);
      return { rows, durationMs: Date.now() - started };
    }

    // V-1 — depth=1 direct USES.
    if (this.isDirectChildPattern(text)) {
      const rows = this.runDirectChild(text, params);
      return { rows, durationMs: Date.now() - started };
    }

    // 검증용 — V-3 같은 단순 `MATCH (md)<-[:USES]-(seed)-[:PARENT_OF*0..N]->(any)-[:USES]->(metadoc)` .
    if (this.isAllChainPattern(text)) {
      const rows = this.runAllChain(text, params);
      return { rows, durationMs: Date.now() - started };
    }

    console.warn(`[mock-client] unrecognized Cypher pattern: ${text.slice(0, 120)}...`);
    return { rows: [], durationMs: Date.now() - started };
  }

  // ───────────────────────────────────────────────────────────────────────
  // 테스트 전용 — 노드/엣지 직접 주입.
  // ───────────────────────────────────────────────────────────────────────

  _reset(): void {
    this.nodes = [];
    this.edges = [];
    this.ready = true;
  }

  _addNode(label: string, props: Record<string, unknown>): void {
    this.nodes.push({ label, props });
  }

  _addEdge(
    from_label: string,
    from_key: string,
    to_label: string,
    to_key: string,
    type: string,
    props: Record<string, unknown> = {},
  ): void {
    this.edges.push({ from_label, from_key, to_label, to_key, type, props });
  }

  /** 테스트 helper — 노드 직접 조회 (단언용). */
  _findNode(label: string, pkField: string, pkValue: unknown): MockNode | undefined {
    return this.nodes.find((n) => n.label === label && n.props[pkField] === pkValue);
  }

  // ───────────────────────────────────────────────────────────────────────
  // 패턴 식별 — 정규식만으로 cypher 시작 토큰 식별.
  // ───────────────────────────────────────────────────────────────────────

  private isSelfLoopCountPattern(text: string): boolean {
    // V-5 — WHERE metadoc.kind=... AND metadoc.name=... + RETURN count.
    return (
      /MATCH \(md:MetaDocument/.test(text) &&
      /-\[:PARENT_OF\*1\.\.\d+]->/.test(text) &&
      /WHERE metadoc\.kind\s*=\s*['"]?[\w:/-]+['"]?\s+AND\s+metadoc\.name/.test(text) &&
      /RETURN count\(\*\)/i.test(text)
    );
  }

  private isTurnAfterPattern(text: string): boolean {
    return (
      /<-\[:CALLED\]-\(:Agent\)<-\[:SPAWNED\]-\(t:Turn\)/.test(text) &&
      /max\(seed\.started_at\)/.test(text)
    );
  }

  private isChainTraversalPattern(text: string): boolean {
    // sequential-flow.ts 의 P2.
    return (
      /MATCH path = \(seed:ToolCall\) -\[:PARENT_OF\*1\.\.\d+]->\(child:ToolCall\) -\[:USES]->\(metadoc:MetaDocument\)/.test(
        text,
      ) ||
      /MATCH path = \(seed:ToolCall\)\s*-\[:PARENT_OF\*1\.\.\d+]->\(child:ToolCall\)\s*-\[:USES]->\(metadoc:MetaDocument\)/.test(
        text,
      )
    );
  }

  private isSeedPattern(text: string): boolean {
    // P1 — seed.tool_use_id RETURN.
    return (
      /MATCH \(md:MetaDocument \{kind: \$centerKind, name: \$centerName}\) <-\[:USES]-\(seed:ToolCall\)/.test(
        text,
      ) && /RETURN seed\.tool_use_id/.test(text)
    );
  }

  private isDirectChildPattern(text: string): boolean {
    // V-1 — depth 1 direct PARENT_OF (no * variable depth).
    return (
      /<-\[:USES]-\(seed:ToolCall\)\s+-\[:PARENT_OF]->\(child:ToolCall\)/.test(text) &&
      !/PARENT_OF\*/.test(text)
    );
  }

  private isAllChainPattern(text: string): boolean {
    // V-3 — *0..N 로 center 자기 자신도 포함하여 모두 시간순 반환.
    return /-\[:PARENT_OF\*0\.\.\d+]->\(any/.test(text);
  }

  /** P5 — cohort meta timeline: (tc:ToolCall)-[:USES]->(md) WHERE tc.turn_id IN $turnIds. */
  private isCohortTimelinePattern(text: string): boolean {
    return (
      /MATCH \(tc:ToolCall\)-\[:USES]->\(md:MetaDocument\)/.test(text) &&
      /tc\.turn_id IN \$turnIds/.test(text)
    );
  }

  /** unified-flow: (ancestor)-[:PARENT_OF*1..N]->(seed) 패턴 — chain 의 *target* 이 seedIds. */
  private isAncestorChainPattern(text: string): boolean {
    return (
      /MATCH path = \(ancestor:ToolCall\) -\[:PARENT_OF\*1\.\.\d+]->\(seed:ToolCall\)/.test(text) &&
      /MATCH \(ancestor\)-\[:USES]->\(metadoc:MetaDocument\)/.test(text)
    );
  }

  // ───────────────────────────────────────────────────────────────────────
  // 패턴별 실행 — in-memory traversal.
  // ───────────────────────────────────────────────────────────────────────

  /**
   * P1 — seed query.
   * MetaDocument(kind, name) 으로 들어오는 USES 엣지의 원천 ToolCall 들을 시간순 반환.
   */
  private runSeedQuery(text: string, params: Record<string, unknown>): Record<string, unknown>[] {
    const seeds = this.findSeeds(
      String(params.centerKind),
      String(params.centerName),
      typeof params.fromTs === 'number' ? (params.fromTs as number) : null,
      typeof params.toTs === 'number' ? (params.toTs as number) : null,
    );
    const limitMatch = text.match(/LIMIT\s+(\d+)/i);
    const limit = limitMatch ? parseInt(limitMatch[1], 10) : seeds.length;
    return seeds
      .sort((a, b) => Number(a.props.started_at) - Number(b.props.started_at))
      .slice(0, limit)
      .map((tc) => ({
        tool_use_id: tc.props.tool_use_id,
        started_at: tc.props.started_at,
        turn_id: tc.props.turn_id ?? null,
        session_id: tc.props.session_id,
      }));
  }

  /**
   * P2 — chain traversal (가변 깊이).
   * seed → PARENT_OF*1..N → child (ToolCall) → USES → metadoc (MetaDocument).
   * self 격하: metadoc 이 center 와 같은 (kind,name) 이면 제외.
   */
  private runChainTraversal(text: string, params: Record<string, unknown>): Record<string, unknown>[] {
    const depthMatch = text.match(/PARENT_OF\*1\.\.(\d+)/);
    const maxDepth = depthMatch ? parseInt(depthMatch[1], 10) : 1;
    const seedIds = Array.isArray(params.seedIds) ? (params.seedIds as string[]) : [];
    const centerKind = String(params.centerKind);
    const centerName = String(params.centerName);

    type RowOut = {
      tool_use_id: string;
      kind: string;
      name: string;
      started_at: number;
      depth: number;
      chain: string[];
      _sort_started: number;
    };
    const out: RowOut[] = [];

    // 각 seed 부터 PARENT_OF chain 을 BFS.
    for (const seedId of seedIds) {
      // chain[0] = seed 자기 자신. (스키마상 path = [seed, ..., child] 형태)
      const queue: Array<{ id: string; depth: number; chain: string[] }> = [
        { id: seedId, depth: 0, chain: [seedId] },
      ];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        if (cur.depth >= maxDepth) continue;
        const children = this.edges.filter(
          (e) => e.type === 'PARENT_OF' && e.from_label === 'ToolCall' && e.from_key === cur.id,
        );
        for (const ce of children) {
          const childId = ce.to_key;
          const childNode = this._findNode('ToolCall', 'tool_use_id', childId);
          if (!childNode) continue;
          const newChain = [...cur.chain, childId];
          const newDepth = cur.depth + 1;

          // metadoc resolution — child 의 USES 엣지.
          const usesEdge = this.edges.find(
            (e) =>
              e.type === 'USES' && e.from_label === 'ToolCall' && e.from_key === childId,
          );
          if (usesEdge) {
            const md = this.nodes.find(
              (n) =>
                n.label === 'MetaDocument' &&
                n.props.id === (this.findMetaDocPkFromEdge(usesEdge) as unknown),
            );
            const mdProps = md?.props ?? {};
            const mdKind = String(mdProps.kind ?? '');
            const mdName = String(mdProps.name ?? '');
            const isSelf = mdKind === centerKind && mdName === centerName;
            if (!isSelf && mdKind && mdName) {
              out.push({
                tool_use_id: childId,
                kind: mdKind,
                name: mdName,
                started_at: Number(childNode.props.started_at),
                depth: newDepth,
                chain: newChain,
                _sort_started: Number(childNode.props.started_at),
              });
            }
          }

          // 다음 hop.
          queue.push({ id: childId, depth: newDepth, chain: newChain });
        }
      }
    }

    return out
      .sort((a, b) => {
        if (a._sort_started !== b._sort_started) return a._sort_started - b._sort_started;
        return a.depth - b.depth;
      })
      .map((r) => ({
        kind: r.kind,
        name: r.name,
        tool_use_id: r.tool_use_id,
        started_at: r.started_at,
        depth: r.depth,
        chain: r.chain,
      }));
  }

  /**
   * unified-flow: ancestor chain.
   * (ancestor:ToolCall) -[:PARENT_OF*1..N]-> (seed:ToolCall), ancestor-USES->metadoc.
   * seedIds 가 traversal 의 *target* 측 — 부모 traversal 결과 반환.
   *
   *   chain 약속: chain[0] = ancestor 자기 자신, chain[-1] = seed.
   */
  private runAncestorChain(text: string, params: Record<string, unknown>): Record<string, unknown>[] {
    const depthMatch = text.match(/PARENT_OF\*1\.\.(\d+)/);
    const maxDepth = depthMatch ? parseInt(depthMatch[1], 10) : 1;
    const seedIds = Array.isArray(params.seedIds) ? (params.seedIds as string[]) : [];
    const centerKind = String(params.centerKind);
    const centerName = String(params.centerName);

    type RowOut = {
      tool_use_id: string;
      kind: string;
      name: string;
      started_at: number;
      depth: number;
      chain: string[];
    };
    const out: RowOut[] = [];

    // 각 seed 에서 PARENT_OF 의 *역방향* (=ancestor 방향) BFS.
    for (const seedId of seedIds) {
      const queue: Array<{ id: string; depth: number; chain: string[] }> = [
        { id: seedId, depth: 0, chain: [seedId] },
      ];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        if (cur.depth >= maxDepth) continue;
        // 부모(ancestor) — to_key === cur.id 인 PARENT_OF 엣지의 from_key.
        const parentEdges = this.edges.filter(
          (e) => e.type === 'PARENT_OF' && e.to_label === 'ToolCall' && e.to_key === cur.id,
        );
        for (const pe of parentEdges) {
          const ancestorId = pe.from_key;
          const ancestorNode = this._findNode('ToolCall', 'tool_use_id', ancestorId);
          if (!ancestorNode) continue;
          const newChain = [ancestorId, ...cur.chain];
          const newDepth = cur.depth + 1;

          const usesEdge = this.edges.find(
            (e) => e.type === 'USES' && e.from_label === 'ToolCall' && e.from_key === ancestorId,
          );
          if (usesEdge) {
            const md = this.nodes.find(
              (n) =>
                n.label === 'MetaDocument' &&
                n.props.id === (this.findMetaDocPkFromEdge(usesEdge) as unknown),
            );
            const mdProps = md?.props ?? {};
            const mdKind = String(mdProps.kind ?? '');
            const mdName = String(mdProps.name ?? '');
            const isSelf = mdKind === centerKind && mdName === centerName;
            if (!isSelf && mdKind && mdName) {
              out.push({
                tool_use_id: ancestorId,
                kind: mdKind,
                name: mdName,
                started_at: Number(ancestorNode.props.started_at),
                depth: newDepth,
                chain: newChain,
              });
            }
          }
          queue.push({ id: ancestorId, depth: newDepth, chain: newChain });
        }
      }
    }

    return out
      .sort((a, b) => {
        if (a.started_at !== b.started_at) return a.started_at - b.started_at;
        return a.depth - b.depth;
      })
      .map((r) => ({
        kind: r.kind,
        name: r.name,
        tool_use_id: r.tool_use_id,
        started_at: r.started_at,
        depth: r.depth,
        chain: r.chain,
      }));
  }

  /**
   * P3 — turn-after.
   * 같은 Turn 의 center 이후 ToolCall(메타 문서) 들을 시간순 반환.
   */
  private runTurnAfter(text: string, params: Record<string, unknown>): Record<string, unknown>[] {
    const centerKind = String(params.centerKind);
    const centerName = String(params.centerName);
    const seedIds = Array.isArray(params.seedIds) ? (params.seedIds as string[]) : [];
    const limitMatch = text.match(/LIMIT\s+(\d+)/i);
    const limit = limitMatch ? parseInt(limitMatch[1], 10) : 16;

    // 1) seedIds 의 turn 집합 + 각 turn 의 center_at (max seed.started_at).
    const turnCenterAt = new Map<string, number>();
    const turnSeedIds = new Map<string, Set<string>>();
    for (const sid of seedIds) {
      const seedNode = this._findNode('ToolCall', 'tool_use_id', sid);
      if (!seedNode) continue;
      const turnId = String(seedNode.props.turn_id ?? '');
      if (!turnId) continue;
      const startedAt = Number(seedNode.props.started_at);
      const prev = turnCenterAt.get(turnId);
      if (prev === undefined || startedAt > prev) turnCenterAt.set(turnId, startedAt);
      if (!turnSeedIds.has(turnId)) turnSeedIds.set(turnId, new Set());
      turnSeedIds.get(turnId)!.add(sid);
    }

    // 2) 각 turn 에서 center_at 이후 ToolCall + 메타 문서 매핑.
    type RowOut = { kind: string; name: string; tool_use_id: string; started_at: number; turn_id: string };
    const out: RowOut[] = [];
    for (const [turnId, centerAt] of turnCenterAt.entries()) {
      const seedSet = turnSeedIds.get(turnId)!;
      const turnTcs = this.nodes.filter(
        (n) =>
          n.label === 'ToolCall' &&
          String(n.props.turn_id ?? '') === turnId &&
          Number(n.props.started_at) > centerAt &&
          !seedSet.has(String(n.props.tool_use_id)),
      );
      for (const tc of turnTcs) {
        const tcId = String(tc.props.tool_use_id);
        const usesEdge = this.edges.find(
          (e) => e.type === 'USES' && e.from_label === 'ToolCall' && e.from_key === tcId,
        );
        if (!usesEdge) continue;
        const md = this.nodes.find(
          (n) =>
            n.label === 'MetaDocument' &&
            n.props.id === (this.findMetaDocPkFromEdge(usesEdge) as unknown),
        );
        const mdProps = md?.props ?? {};
        const mdKind = String(mdProps.kind ?? '');
        const mdName = String(mdProps.name ?? '');
        const isSelf = mdKind === centerKind && mdName === centerName;
        if (isSelf || !mdKind || !mdName) continue;
        out.push({
          kind: mdKind,
          name: mdName,
          tool_use_id: tcId,
          started_at: Number(tc.props.started_at),
          turn_id: turnId,
        });
      }
    }

    return out
      .sort((a, b) => a.started_at - b.started_at)
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }

  /**
   * P5 — cohort meta timeline.
   * 주어진 turnIds 안에서 USES→MetaDocument 가 있는 ToolCall 만 started_at 순 반환.
   */
  private runCohortTimeline(
    _text: string,
    params: Record<string, unknown>,
  ): Record<string, unknown>[] {
    const turnIds = new Set(
      (Array.isArray(params.turnIds) ? (params.turnIds as unknown[]) : []).map((t) => String(t)),
    );
    type RowOut = {
      session_id: string;
      turn_id: string;
      tool_use_id: string;
      started_at: number;
      kind: string;
      name: string;
    };
    const out: RowOut[] = [];
    for (const n of this.nodes) {
      if (n.label !== 'ToolCall') continue;
      const turnId = String(n.props.turn_id ?? '');
      if (!turnIds.has(turnId)) continue;
      const tcId = String(n.props.tool_use_id);
      const usesEdge = this.edges.find(
        (e) => e.type === 'USES' && e.from_label === 'ToolCall' && e.from_key === tcId,
      );
      if (!usesEdge) continue; // USES 없는 generic 도구는 제외 (경로 압축).
      const md = this.nodes.find(
        (m) => m.label === 'MetaDocument' && String(m.props.id) === String(usesEdge.to_key),
      );
      if (!md) continue;
      const mdKind = String(md.props.kind ?? '');
      const mdName = String(md.props.name ?? '');
      if (!mdKind || !mdName) continue;
      out.push({
        session_id: String(n.props.session_id ?? ''),
        turn_id: turnId,
        tool_use_id: tcId,
        started_at: Number(n.props.started_at),
        kind: mdKind,
        name: mdName,
      });
    }
    return out.sort((a, b) => a.started_at - b.started_at);
  }

  /** V-1 — depth=1 direct PARENT_OF child meta docs. */
  private runDirectChild(
    _text: string,
    params: Record<string, unknown>,
  ): Record<string, unknown>[] {
    const centerKind = String(params.centerKind);
    const centerName = String(params.centerName);
    const seeds = this.findSeeds(centerKind, centerName, null, null);
    const counts = new Map<string, { kind: string; name: string; cnt: number }>();
    for (const seed of seeds) {
      const seedId = String(seed.props.tool_use_id);
      const children = this.edges.filter(
        (e) => e.type === 'PARENT_OF' && e.from_key === seedId,
      );
      for (const ce of children) {
        const usesEdge = this.edges.find(
          (e) => e.type === 'USES' && e.from_label === 'ToolCall' && e.from_key === ce.to_key,
        );
        if (!usesEdge) continue;
        const md = this.nodes.find(
          (n) =>
            n.label === 'MetaDocument' &&
            n.props.id === (this.findMetaDocPkFromEdge(usesEdge) as unknown),
        );
        const mdProps = md?.props ?? {};
        const mdKind = String(mdProps.kind ?? '');
        const mdName = String(mdProps.name ?? '');
        if (!mdKind || !mdName) continue;
        if (mdKind === centerKind && mdName === centerName) continue;
        const key = `${mdKind}::${mdName}`;
        const cur = counts.get(key) ?? { kind: mdKind, name: mdName, cnt: 0 };
        cur.cnt++;
        counts.set(key, cur);
      }
    }
    return [...counts.values()]
      .sort((a, b) => (b.cnt !== a.cnt ? b.cnt - a.cnt : a.name.localeCompare(b.name)))
      .map((r) => ({ kind: r.kind, name: r.name, invocations: r.cnt }));
  }

  /**
   * V-3 — `*0..N` 모든 노드 시간순 (center 포함). path nodes 전체를 노드 단위로 펼친 결과.
   */
  private runAllChain(
    text: string,
    params: Record<string, unknown>,
  ): Record<string, unknown>[] {
    const centerKind = String(params.centerKind);
    const centerName = String(params.centerName);
    const seeds = this.findSeeds(centerKind, centerName, null, null);
    const visited = new Map<string, { name: string; at_ms: number; tool_use_id: string }>();

    // 시작점 — seed 자체 (center 의 호출). 메타 문서 이름은 center 자체.
    for (const seed of seeds) {
      const tcId = String(seed.props.tool_use_id);
      if (!visited.has(tcId)) {
        visited.set(tcId, {
          name: centerName.startsWith('/') ? centerName : `/${centerName}`,
          at_ms: Number(seed.props.started_at),
          tool_use_id: tcId,
        });
      }
    }

    // PARENT_OF chain 모두 방문.
    const depthMatch = text.match(/PARENT_OF\*0\.\.(\d+)/);
    const maxDepth = depthMatch ? parseInt(depthMatch[1], 10) : 3;
    for (const seed of seeds) {
      const queue: Array<{ id: string; depth: number }> = [
        { id: String(seed.props.tool_use_id), depth: 0 },
      ];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        if (cur.depth >= maxDepth) continue;
        const childEdges = this.edges.filter(
          (e) => e.type === 'PARENT_OF' && e.from_key === cur.id,
        );
        for (const ce of childEdges) {
          const child = this._findNode('ToolCall', 'tool_use_id', ce.to_key);
          if (!child) continue;
          const usesEdge = this.edges.find(
            (e) => e.type === 'USES' && e.from_key === ce.to_key,
          );
          const md = usesEdge
            ? this.nodes.find(
                (n) =>
                  n.label === 'MetaDocument' &&
                  n.props.id === (this.findMetaDocPkFromEdge(usesEdge) as unknown),
              )
            : undefined;
          const mdName = String(md?.props.name ?? '');
          if (mdName && !visited.has(ce.to_key)) {
            visited.set(ce.to_key, {
              name: mdName,
              at_ms: Number(child.props.started_at),
              tool_use_id: ce.to_key,
            });
          }
          queue.push({ id: ce.to_key, depth: cur.depth + 1 });
        }
      }
    }

    return [...visited.values()].sort((a, b) => a.at_ms - b.at_ms);
  }

  /** V-5 — self-loop count. center 자기 자신이 chain 에 등장하면 안 됨. */
  private runSelfLoopCount(
    _text: string,
    params: Record<string, unknown>,
  ): Record<string, unknown>[] {
    const centerKind = String(params.centerKind);
    const centerName = String(params.centerName);
    const seeds = this.findSeeds(centerKind, centerName, null, null);
    let selfLoopCount = 0;
    for (const seed of seeds) {
      const queue: Array<{ id: string; depth: number }> = [
        { id: String(seed.props.tool_use_id), depth: 0 },
      ];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        if (cur.depth >= 3) continue;
        const childEdges = this.edges.filter(
          (e) => e.type === 'PARENT_OF' && e.from_key === cur.id,
        );
        for (const ce of childEdges) {
          const usesEdge = this.edges.find(
            (e) => e.type === 'USES' && e.from_key === ce.to_key,
          );
          if (usesEdge) {
            const md = this.nodes.find(
              (n) =>
                n.label === 'MetaDocument' &&
                n.props.id === (this.findMetaDocPkFromEdge(usesEdge) as unknown),
            );
            const mdProps = md?.props ?? {};
            if (
              String(mdProps.kind ?? '') === centerKind &&
              String(mdProps.name ?? '') === centerName
            ) {
              selfLoopCount++;
            }
          }
          queue.push({ id: ce.to_key, depth: cur.depth + 1 });
        }
      }
    }
    return [{ self_loop_count: selfLoopCount }];
  }

  // ───────────────────────────────────────────────────────────────────────
  // 내부 헬퍼
  // ───────────────────────────────────────────────────────────────────────

  /** center MetaDocument 로 들어오는 USES 엣지의 원천 ToolCall 들. */
  private findSeeds(
    centerKind: string,
    centerName: string,
    fromTs: number | null,
    toTs: number | null,
  ): MockNode[] {
    const md = this.nodes.find(
      (n) =>
        n.label === 'MetaDocument' &&
        String(n.props.kind ?? '') === centerKind &&
        String(n.props.name ?? '') === centerName,
    );
    if (!md) return [];
    const mdId = md.props.id;
    const seeds: MockNode[] = [];
    for (const e of this.edges) {
      if (e.type !== 'USES') continue;
      if (e.to_label !== 'MetaDocument') continue;
      if (e.to_key !== String(mdId)) continue;
      const tc = this._findNode('ToolCall', 'tool_use_id', e.from_key);
      if (!tc) continue;
      const tcStarted = Number(tc.props.started_at);
      if (fromTs !== null && tcStarted < fromTs) continue;
      if (toTs !== null && tcStarted > toTs) continue;
      seeds.push(tc);
    }
    return seeds;
  }

  /** USES 엣지의 to_key 가 MetaDocument.id (number 일 수도 string 일 수도) — 정규화. */
  private findMetaDocPkFromEdge(usesEdge: MockEdge): unknown {
    const raw = usesEdge.to_key;
    const asNum = Number(raw);
    return Number.isFinite(asNum) ? asNum : raw;
  }
}

// =============================================================================
// 팩토리 — 테스트가 LadybugClient 타입으로 받아 sequential-flow.ts 에 그대로 전달.
// =============================================================================

export function createMockClient(): MockLadybugClient & LadybugClient {
  return new MockLadybugClient() as unknown as MockLadybugClient & LadybugClient;
}
