export const TimeUtils = {
  /**
   * Returns current UTC timestamp in ISO 8601 string format
   */
  nowUTC(): string {
    return new Date().toISOString();
  },

  /**
   * Formats a given UTC ISO string to the specified timezone
   */
  formatInTimezone(isoString: string, timeZone: string, locale: string = 'en-US'): string {
    const date = new Date(isoString);
    const formatter = new Intl.DateTimeFormat(locale, {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    return formatter.format(date);
  }
};
