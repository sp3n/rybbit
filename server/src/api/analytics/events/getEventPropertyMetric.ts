import { FastifyReply, FastifyRequest } from "fastify";
import { FilterParams } from "@rybbit/shared";

import { getFilterStatement } from "../utils/getFilterStatement.js";
import { analyticsRoute, runAnalyticsQuery } from "../utils/analyticsQuery.js";
import { getTimeStatement } from "../utils/timeWindow.js";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export type EventPropertyMetricRow = {
  value: string;
  count: number;
  percentage: number;
  numericCount: number;
  average: number | null;
  minimum: number | null;
  maximum: number | null;
  p50: number | null;
  p90: number | null;
};

export type EventPropertyNumericSummary = {
  numericCount: number;
  average: number | null;
  minimum: number | null;
  maximum: number | null;
  p50: number | null;
  p90: number | null;
};

export interface GetEventPropertyMetricRequest {
  Params: {
    siteId: string;
  };
  Querystring: FilterParams<{
    property: string;
    event_name?: string;
    event_name_like?: string;
    property_value?: string;
    limit?: number;
    page?: number;
  }>;
}

type RawMetricRow = Record<keyof EventPropertyMetricRow, unknown>;
type RawNumericSummary = Record<keyof EventPropertyNumericSummary, unknown>;

function parseNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getLimitAndOffset(limit?: number, page?: number) {
  const requestedLimit = Number(limit ?? DEFAULT_LIMIT);
  const requestedPage = Number(page ?? 1);
  const safeLimit = Math.min(
    Math.max(Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : DEFAULT_LIMIT, 1),
    MAX_LIMIT
  );
  const safePage = Math.max(Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1, 1);

  return {
    limit: safeLimit,
    offset: (safePage - 1) * safeLimit,
  };
}

function getEventNameStatement(eventName?: string, eventNameLike?: string) {
  const statements: string[] = [];

  if (eventName) {
    statements.push("AND event_name = {eventName:String}");
  }

  if (eventNameLike) {
    statements.push("AND event_name LIKE {eventNameLike:String}");
  }

  return statements.join("\n        ");
}

function getPropertyValueStatement(propertyValue?: string) {
  if (!propertyValue) {
    return "";
  }

  return "AND replaceRegexpAll(toString(kv.2), '^\"|\"$', '') = {propertyValue:String}";
}

function mapMetricRow(row: RawMetricRow): EventPropertyMetricRow {
  return {
    value: String(row.value ?? ""),
    count: parseNumber(row.count),
    percentage: parseNumber(row.percentage),
    numericCount: parseNumber(row.numericCount),
    average: parseNullableNumber(row.average),
    minimum: parseNullableNumber(row.minimum),
    maximum: parseNullableNumber(row.maximum),
    p50: parseNullableNumber(row.p50),
    p90: parseNullableNumber(row.p90),
  };
}

function mapNumericSummary(row: RawNumericSummary | undefined): EventPropertyNumericSummary {
  return {
    numericCount: parseNumber(row?.numericCount),
    average: parseNullableNumber(row?.average),
    minimum: parseNullableNumber(row?.minimum),
    maximum: parseNullableNumber(row?.maximum),
    p50: parseNullableNumber(row?.p50),
    p90: parseNullableNumber(row?.p90),
  };
}

export function buildEventPropertyMetricQueries(query: GetEventPropertyMetricRequest["Querystring"], site: number) {
  const {
    event_name: eventName,
    event_name_like: eventNameLike,
    filters,
    limit,
    page,
    property_value: propertyValue,
  } = query;
  const property = typeof query.property === "string" ? query.property.trim() : "";
  const timeStatement = getTimeStatement(query);
  const filterStatement = filters ? getFilterStatement(filters, site, timeStatement) : "";
  const eventNameStatement = getEventNameStatement(eventName, eventNameLike);
  const propertyValueStatement = getPropertyValueStatement(propertyValue);
  const { limit: safeLimit, offset } = getLimitAndOffset(limit, page);

  const propertyEventsCte = `
    WITH property_events AS (
      SELECT
        replaceRegexpAll(toString(kv.2), '^"|"$', '') AS propertyValue,
        toFloat64OrNull(replaceRegexpAll(toString(kv.2), '^"|"$', '')) AS numericValue
      FROM events
      ARRAY JOIN JSONExtractKeysAndValuesRaw(CAST(props AS String)) AS kv
      WHERE
        site_id = {siteId:Int32}
        AND type = 'custom_event'
        AND props != '{}'
        AND kv.1 = {property:String}
        ${timeStatement}
        ${filterStatement}
        ${eventNameStatement}
        ${propertyValueStatement}
    )
  `;

  const dataQuery = `
    ${propertyEventsCte}
    SELECT
      propertyValue AS value,
      count() AS count,
      round(count() * 100.0 / sum(count()) OVER (), 2) AS percentage,
      countIf(isNotNull(numericValue)) AS numericCount,
      if(countIf(isNotNull(numericValue)) > 0, round(avgIf(numericValue, isNotNull(numericValue)), 2), NULL) AS average,
      if(countIf(isNotNull(numericValue)) > 0, minIf(numericValue, isNotNull(numericValue)), NULL) AS minimum,
      if(countIf(isNotNull(numericValue)) > 0, maxIf(numericValue, isNotNull(numericValue)), NULL) AS maximum,
      if(
        countIf(isNotNull(numericValue)) > 0,
        round(quantileExactIf(0.5)(numericValue, isNotNull(numericValue)), 2),
        NULL
      ) AS p50,
      if(
        countIf(isNotNull(numericValue)) > 0,
        round(quantileExactIf(0.9)(numericValue, isNotNull(numericValue)), 2),
        NULL
      ) AS p90
    FROM property_events
    WHERE propertyValue != ''
    GROUP BY propertyValue
    ORDER BY count DESC
    LIMIT ${safeLimit} OFFSET ${offset}
  `;

  const countQuery = `
    ${propertyEventsCte}
    SELECT count() AS totalCount
    FROM (
      SELECT propertyValue
      FROM property_events
      WHERE propertyValue != ''
      GROUP BY propertyValue
    )
  `;

  const summaryQuery = `
    ${propertyEventsCte}
    SELECT
      countIf(isNotNull(numericValue)) AS numericCount,
      if(countIf(isNotNull(numericValue)) > 0, round(avgIf(numericValue, isNotNull(numericValue)), 2), NULL) AS average,
      if(countIf(isNotNull(numericValue)) > 0, minIf(numericValue, isNotNull(numericValue)), NULL) AS minimum,
      if(countIf(isNotNull(numericValue)) > 0, maxIf(numericValue, isNotNull(numericValue)), NULL) AS maximum,
      if(
        countIf(isNotNull(numericValue)) > 0,
        round(quantileExactIf(0.5)(numericValue, isNotNull(numericValue)), 2),
        NULL
      ) AS p50,
      if(
        countIf(isNotNull(numericValue)) > 0,
        round(quantileExactIf(0.9)(numericValue, isNotNull(numericValue)), 2),
        NULL
      ) AS p90
    FROM property_events
    WHERE propertyValue != ''
  `;

  const queryParams: Record<string, string | number> = {
    siteId: site,
    property,
  };
  if (eventName) queryParams.eventName = eventName;
  if (eventNameLike) queryParams.eventNameLike = eventNameLike;
  if (propertyValue) queryParams.propertyValue = propertyValue;

  return { dataQuery, countQuery, summaryQuery, queryParams };
}

export const getEventPropertyMetric = analyticsRoute<GetEventPropertyMetricRequest>(
  "event property metric",
  async (req: FastifyRequest<GetEventPropertyMetricRequest>, res: FastifyReply) => {
    const property = typeof req.query.property === "string" ? req.query.property.trim() : "";

    if (!property) {
      return res.status(400).send({ error: "Property is required" });
    }

    const { dataQuery, countQuery, summaryQuery, queryParams } = buildEventPropertyMetricQueries(
      req.query,
      Number(req.params.siteId)
    );
    const [rawData, rawCount, rawSummary] = await Promise.all([
      runAnalyticsQuery<RawMetricRow>({ query: dataQuery, params: queryParams }),
      runAnalyticsQuery<{ totalCount: unknown }>({ query: countQuery, params: queryParams }),
      runAnalyticsQuery<RawNumericSummary>({ query: summaryQuery, params: queryParams }),
    ]);
    const numericSummary = mapNumericSummary(rawSummary[0]);

    return res.send({
      data: {
        data: rawData.map(mapMetricRow),
        totalCount: parseNumber(rawCount[0]?.totalCount),
        numericSummary: numericSummary.numericCount > 0 ? numericSummary : null,
      },
    });
  }
);
