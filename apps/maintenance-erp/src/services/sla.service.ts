export interface ServiceCalendar {
  workingDays: number[]; // 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat, 7=Sun
  windowStartHour: number; // e.g. 9 for 09:00
  windowEndHour: number; // e.g. 18 for 18:00
  holidays?: string[]; // Array of 'YYYY-MM-DD'
  is24x7?: boolean;
}

export class SlaService {
  /**
   * Default business calendar: Monday to Saturday, 09:00 to 18:00 (9 working hours/day).
   */
  static readonly DEFAULT_CALENDAR: ServiceCalendar = {
    workingDays: [1, 2, 3, 4, 5, 6],
    windowStartHour: 9,
    windowEndHour: 18,
    holidays: [],
    is24x7: false,
  };

  /**
   * Pure calculation of SLA deadline based on business hours.
   */
  static calculateDeadline(
    startTimeInput: Date | string,
    targetHours: number,
    calendar: ServiceCalendar = this.DEFAULT_CALENDAR
  ): Date {
    const start = typeof startTimeInput === 'string' ? new Date(startTimeInput) : new Date(startTimeInput);

    if (calendar.is24x7 || targetHours <= 0) {
      return new Date(start.getTime() + targetHours * 60 * 60 * 1000);
    }

    const workingHoursPerDay = calendar.windowEndHour - calendar.windowStartHour;
    if (workingHoursPerDay <= 0) {
      return new Date(start.getTime() + targetHours * 60 * 60 * 1000);
    }

    let remainingMinutes = Math.round(targetHours * 60);
    let current = new Date(start.getTime());

    // Align starting time to business hours
    current = this.alignToNextBusinessTime(current, calendar);

    while (remainingMinutes > 0) {
      // Calculate minutes remaining today before window closes
      const endOfToday = new Date(current.getTime());
      endOfToday.setUTCHours(calendar.windowEndHour, 0, 0, 0);

      const availableMinutesToday = Math.max(0, Math.floor((endOfToday.getTime() - current.getTime()) / (60 * 1000)));

      if (remainingMinutes <= availableMinutesToday) {
        current = new Date(current.getTime() + remainingMinutes * 60 * 1000);
        remainingMinutes = 0;
      } else {
        remainingMinutes -= availableMinutesToday;
        // Advance to start of next working day
        current = new Date(current.getTime());
        current.setUTCDate(current.getUTCDate() + 1);
        current.setUTCHours(calendar.windowStartHour, 0, 0, 0);
        current = this.alignToNextBusinessTime(current, calendar);
      }
    }

    return current;
  }

  /**
   * Aligns a timestamp to the next open business window.
   */
  private static alignToNextBusinessTime(date: Date, calendar: ServiceCalendar): Date {
    let current = new Date(date.getTime());

    while (true) {
      const isoDay = current.getUTCDay() === 0 ? 7 : current.getUTCDay();
      const dateStr = current.toISOString().slice(0, 10);
      const isWorkingDay = calendar.workingDays.includes(isoDay) && !(calendar.holidays || []).includes(dateStr);

      if (!isWorkingDay) {
        // Advance to next day at window start
        current.setUTCDate(current.getUTCDate() + 1);
        current.setUTCHours(calendar.windowStartHour, 0, 0, 0);
        continue;
      }

      const currentHour = current.getUTCHours() + current.getUTCMinutes() / 60;

      if (currentHour < calendar.windowStartHour) {
        // Earlier than window start: snap to start
        current.setUTCHours(calendar.windowStartHour, 0, 0, 0);
        return current;
      } else if (currentHour >= calendar.windowEndHour) {
        // Later than window end: advance to next day at window start
        current.setUTCDate(current.getUTCDate() + 1);
        current.setUTCHours(calendar.windowStartHour, 0, 0, 0);
        continue;
      } else {
        // Within business window
        return current;
      }
    }
  }

  /**
   * Evaluates if SLA has been breached.
   */
  static isSlaBreached(deadline: Date | string, completionTime: Date | string = new Date()): boolean {
    const d = typeof deadline === 'string' ? new Date(deadline) : deadline;
    const c = typeof completionTime === 'string' ? new Date(completionTime) : completionTime;
    return c.getTime() > d.getTime();
  }
}
