export interface StatementQueryDto {
  fromDate: string;
  toDate: string;
}

export function validateStatementQuery(query: any): StatementQueryDto {
  if (!query) {
    throw new Error('Both fromDate and toDate query parameters are required (YYYY-MM-DD)');
  }

  const fromDateStr = query.fromDate || query.from_date;
  const toDateStr = query.toDate || query.to_date;

  if (!fromDateStr || !toDateStr) {
    throw new Error('Both fromDate and toDate query parameters are required (YYYY-MM-DD)');
  }

  const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoDateRegex.test(fromDateStr) || !isoDateRegex.test(toDateStr)) {
    throw new Error('Invalid date format for fromDate or toDate. Expected YYYY-MM-DD');
  }

  const from = new Date(fromDateStr);
  const to = new Date(toDateStr);

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    throw new Error('Invalid date format for fromDate or toDate. Expected YYYY-MM-DD');
  }
  if (from > to) {
    throw new Error('fromDate cannot be after toDate (must be on or before toDate)');
  }

  return {
    fromDate: fromDateStr,
    toDate: toDateStr,
  };
}
