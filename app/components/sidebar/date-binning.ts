import { format, isAfter, isThisWeek, isThisYear, isToday, isYesterday, subDays } from 'date-fns';
import type { ChatHistoryItem } from '~/lib/persistence';

type Bin = { category: string; items: ChatHistoryItem[] };

export function binDates(_list: ChatHistoryItem[]) {
  const list = _list.toSorted((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

  const binLookup: Record<string, Bin> = {};
  const bins: Array<Bin> = [];

  list.forEach(item => {
    /*
     * date-fns `format` throws RangeError on an Invalid Date, and this runs during render — so a
     * single chat with a missing or malformed timestamp would take down the whole page rather
     * than just look wrong. Bucket those separately instead.
     */
    const parsed = new Date(item.timestamp);

    if (Number.isNaN(parsed.getTime())) {
      const bin = binLookup.Older ?? { category: 'Older', items: [] };

      if (!binLookup.Older) {
        binLookup.Older = bin;
        bins.push(bin);
      }

      bin.items.push(item);

      return;
    }

    const category = dateCategory(parsed);

    if (!(category in binLookup)) {
      const bin = {
        category,
        items: [item],
      };

      binLookup[category] = bin;

      bins.push(bin);
    } else {
      binLookup[category].items.push(item);
    }
  });

  return bins;
}

function dateCategory(date: Date) {
  if (isToday(date)) {
    return 'Today';
  }

  if (isYesterday(date)) {
    return 'Yesterday';
  }

  if (isThisWeek(date)) {
    // e.g., "Mon" instead of "Monday"
    return format(date, 'EEE');
  }

  const thirtyDaysAgo = subDays(new Date(), 30);

  if (isAfter(date, thirtyDaysAgo)) {
    return 'Past 30 Days';
  }

  if (isThisYear(date)) {
    // e.g., "Jan" instead of "January"
    return format(date, 'LLL');
  }

  // e.g., "Jan 2023" instead of "January 2023"
  return format(date, 'LLL yyyy');
}
