import { MAX_QUERY_FILTERS, DatasetQueryError } from './query.js';
import { isRecord } from './args.js';
import { isoDateFromEpoch, translateFilterDateValue } from './time-axis.js';
/**
 * Query-time normalization: the single implementation shared by query_dataset and
 * describe_dataset.queries. Every entry point executing a QuerySpec must call it; an entry that
 * skips it gives date strings a different meaning in the same turn.
 */
/**
 * Translate date-like filter values into this Dataset's time-axis bounds and add `*_iso` result
 * columns. Date strings against a numeric time column fail loudly; a skipped filter would look
 * like a successful full-table result.
 */
export async function normalizeQueryDates(input) {
    const filters = input.query.filters;
    if (filters === undefined || !filters.some((filter) => /date|time|timestamp|_dt$|report$/i.test(filter.column)))
        return { query: input.query };
    let snapshot;
    try {
        snapshot = await input.store.describeTimeAxis({
            session: input.session,
            dataset_id: input.dataset_id,
            time_column: input.time_column,
            signal: input.signal,
        });
    }
    catch {
        // Probe failure only affects this convenience translation; let the real query path report its own error.
        return { query: input.query };
    }
    if (snapshot === undefined)
        return { query: input.query };
    const axis = { axis: snapshot.axis, dates: snapshot.dates };
    const translated = [];
    let changed = false;
    for (const filter of filters) {
        const replaced = filter.column === axis.axis.column
            ? translateFilterDateValue({
                axis: axis.axis,
                dates: axis.dates,
                column: filter.column,
                operator: filter.operator,
                value: filter.value,
            })
            : undefined;
        if (replaced === undefined) {
            translated.push(filter);
            continue;
        }
        changed = true;
        for (const item of replaced) {
            if (translated.length >= MAX_QUERY_FILTERS) {
                throw new DatasetQueryError('query_spec_invalid', `date filters expand to at most ${MAX_QUERY_FILTERS} conditions`);
            }
            translated.push({ column: filter.column, operator: item.operator, value: item.value });
        }
    }
    return {
        query: changed ? { ...input.query, filters: translated } : input.query,
        axis: { column: snapshot.axis.column, ...(snapshot.axis.time_zone === undefined ? {} : { time_zone: snapshot.axis.time_zone }) },
    };
}
/** Add `*_iso` columns without replacing originals; skip an existing column to avoid collisions. */
export function withIsoTimeColumns(result, axis) {
    const rows = result.rows;
    if (!Array.isArray(rows))
        return;
    const isoColumn = `${axis.column}_iso`;
    const zone = axis.time_zone ?? 'UTC';
    for (const row of rows) {
        if (!isRecord(row) || isoColumn in row)
            continue;
        const value = row[axis.column];
        if (typeof value !== 'number' || !Number.isFinite(value))
            continue;
        row[isoColumn] = isoDateFromEpoch(value, zone);
    }
    const columns = result.columns;
    if (Array.isArray(columns) && !columns.includes(isoColumn) && rows.some((row) => isRecord(row) && isoColumn in row)) {
        columns.push(isoColumn);
    }
}
