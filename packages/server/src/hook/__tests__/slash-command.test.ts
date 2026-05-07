/**
 * slash-command 추출 단위 테스트
 *
 * 목적: extractSlashCommand가 다양한 prompt 형태에서 안정적으로 동작함을 확인.
 *  - 정상: <command-name>/foo</command-name> → 'foo'
 *  - 선행 슬래시 없는 형태: <command-name>foo</command-name> → 'foo'
 *  - 부재: 일반 텍스트 → null
 *  - 빈 태그: <command-name></command-name> → null
 *  - 양 끝 공백: <command-name>  /foo  </command-name> → 'foo'
 */

import { describe, it, expect } from 'bun:test';
import { extractSlashCommand } from '../slash-command';

describe('extractSlashCommand', () => {
  it('returns command name without leading slash', () => {
    expect(extractSlashCommand('<command-name>/foo</command-name>')).toBe('foo');
  });

  it('handles command name without slash', () => {
    expect(extractSlashCommand('<command-name>foo</command-name>')).toBe('foo');
  });

  it('returns null when tag is absent', () => {
    expect(extractSlashCommand('Just a regular prompt')).toBeNull();
    expect(extractSlashCommand('')).toBeNull();
  });

  it('returns null for empty tag', () => {
    expect(extractSlashCommand('<command-name></command-name>')).toBeNull();
  });

  it('trims surrounding whitespace inside tag', () => {
    expect(extractSlashCommand('<command-name>  /foo  </command-name>')).toBe('foo');
  });

  it('handles tag mid-text', () => {
    expect(extractSlashCommand('hello <command-name>/clear</command-name> world')).toBe('clear');
  });

  it('returns null on null/undefined input', () => {
    expect(extractSlashCommand(undefined)).toBeNull();
    expect(extractSlashCommand(null)).toBeNull();
  });

  it('extracts only first occurrence', () => {
    expect(extractSlashCommand(
      '<command-name>/first</command-name> and <command-name>/second</command-name>',
    )).toBe('first');
  });
});
