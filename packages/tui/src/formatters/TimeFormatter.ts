export class TimeFormatter {
  /** "01/01/2025 12:00 PM" — 세션 목록용 */
  static formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    return (
      date.toLocaleDateString() +
      ' ' +
      date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    );
  }

  /** "12:00:00 AM" — 상세 요청 목록용 (12h) */
  static formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  /** "12:00:00" — 실시간 요청 목록용 (24h) */
  static formatTime24h(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString('en-US', { hour12: false });
  }

  /** "1h 30m" 또는 "45m" */
  static formatDuration(startedAt: number, endedAt?: number): string {
    const end = endedAt ?? Date.now();
    const minutes = Math.floor((end - startedAt) / 60000);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    return `${minutes}m`;
  }
}
