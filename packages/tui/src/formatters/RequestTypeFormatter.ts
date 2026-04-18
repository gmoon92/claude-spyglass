export type RequestType = 'prompt' | 'tool_call' | 'system';

const TYPE_CONFIG = {
  prompt:    { label: 'P', color: 'cyan',   desc: 'Prompt' },
  tool_call: { label: 'T', color: 'yellow', desc: 'Tool' },
  system:    { label: 'S', color: 'gray',   desc: 'System' },
} as const satisfies Record<RequestType, { label: string; color: string; desc: string }>;

type Config = { label: string; color: string; desc: string };

export class RequestTypeFormatter {
  private static readonly CONFIG: Record<string, Config> = TYPE_CONFIG;

  static getLabel(type: string): string {
    return this.CONFIG[type]?.label ?? type.charAt(0).toUpperCase();
  }

  static getColor(type: string): string {
    return this.CONFIG[type]?.color ?? 'gray';
  }

  static getDescription(type: string): string {
    return this.CONFIG[type]?.desc ?? type;
  }

  static formatBadge(type: string): { label: string; color: string } {
    return { label: this.getLabel(type), color: this.getColor(type) };
  }

  /** Type 컬럼 표시용: tool_call이면 "Tool:toolName" 형태 반환 */
  static formatDisplay(type: string, toolName?: string | null): string {
    if (type === 'tool_call' && toolName) return `Tool:${toolName}`;
    return this.getDescription(type);
  }

  static getAllTypes(): RequestType[] {
    return Object.keys(TYPE_CONFIG) as RequestType[];
  }
}
