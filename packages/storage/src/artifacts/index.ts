/**
 * artifacts — CAS(Content-Addressed Storage) 공용 진입점 (roadmap Phase 2)
 *
 * @description 청킹(chunker) + 저장 추상화(artifact-store)를 한 곳에서 재노출한다.
 *   storage 패키지 배럴(src/index.ts)이 이 모듈을 통해 CAS API를 외부(server)로 공개한다.
 */

export {
  splitConversation,
  joinConversation,
  sha256HexBytes,
  type SplitConversation,
} from './chunker';

export {
  SqliteArtifactStore,
  type ArtifactStore,
  type ArtifactRef,
} from './artifact-store';
