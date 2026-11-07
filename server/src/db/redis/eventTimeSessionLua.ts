/**
 * sp3n/rybbit fork: sessions decided by event time, for trusted events that
 * carry their own timestamp (see services/tracker/eventTime.ts).
 *
 * The wall-clock session (sessionGetOrCreate) is a key whose TTL is the
 * inactivity window, so "same session" means "arrived within 30 minutes of the
 * last arrival". A backlog replayed after an outage arrives in one burst, which
 * would merge hours of play into one session and ignore every real gap. Here
 * the window is applied to the events' own times instead.
 *
 * KEYS[1] event-time session key for one (site, identity). Kept apart from the
 *         wall-clock keys so the two schemes never read each other's values.
 *
 * ARGV[1] candidate session id, used when a new session starts
 * ARGV[2] event time, epoch milliseconds, as integer text
 * ARGV[3] inactivity gap in milliseconds (30 minutes)
 * ARGV[4] key retention in milliseconds, wall-clock
 * ARGV[5] the most sessions remembered per key
 *
 * Value: "<id>|<firstMs>|<lastMs>;<id>|<firstMs>|<lastMs>;..." — one span per
 * session this identity had recently.
 *
 * An event within the gap of a remembered span joins that session (the nearest
 * one, if two qualify) and widens its span; a span never shrinks, so a late,
 * older event cannot move a session's end backwards. An event near no span
 * starts a new session, which is remembered too, so delivery out of time order
 * (concurrent consumers, live traffic overtaking a backlog) still groups each
 * session's events together. Past the limit, the session that ended longest
 * ago is forgotten.
 *
 * Retention is long (the queue's retention, not the gap) so that a session
 * open when an outage began is still known when the backlog drains. A long
 * retention cannot merge distant events, because membership is decided by the
 * event times, not by whether the key is still alive.
 *
 * Times are compared as numbers but stored as the decimal text they arrived
 * in, so no number is ever formatted back (epoch milliseconds are exact as
 * doubles, but not every Lua runtime formats them as integers).
 *
 * Returns the session id for this event.
 */
export const EVENT_TIME_SESSION_LUA = `
local candidate = ARGV[1]
local eventText = ARGV[2]
local eventMs = tonumber(eventText)
local gapMs = tonumber(ARGV[3])
local retentionMs = ARGV[4]
local maxSpans = tonumber(ARGV[5])

local spans = {}
local stored = redis.call('GET', KEYS[1])
if stored then
  for id, firstText, lastText in string.gmatch(stored, '([^|;]+)|(%d+)|(%d+)') do
    spans[#spans + 1] = {
      id = id,
      firstText = firstText,
      lastText = lastText,
      first = tonumber(firstText),
      last = tonumber(lastText),
    }
  end
end

local chosen = nil
local chosenDistance = nil
for _, span in ipairs(spans) do
  if eventMs >= span.first - gapMs and eventMs <= span.last + gapMs then
    local distance = 0
    if eventMs < span.first then
      distance = span.first - eventMs
    elseif eventMs > span.last then
      distance = eventMs - span.last
    end
    if chosen == nil or distance < chosenDistance then
      chosen = span
      chosenDistance = distance
    end
  end
end

if chosen then
  if eventMs < chosen.first then
    chosen.first = eventMs
    chosen.firstText = eventText
  end
  if eventMs > chosen.last then
    chosen.last = eventMs
    chosen.lastText = eventText
  end
else
  chosen = { id = candidate, firstText = eventText, lastText = eventText, first = eventMs, last = eventMs }
  spans[#spans + 1] = chosen
end

-- Most recently ended first; forget the oldest beyond the limit.
table.sort(spans, function(a, b) return a.last > b.last end)
local parts = {}
for i = 1, math.min(#spans, maxSpans) do
  local span = spans[i]
  parts[#parts + 1] = span.id .. '|' .. span.firstText .. '|' .. span.lastText
end
redis.call('SET', KEYS[1], table.concat(parts, ';'), 'PX', retentionMs)
return chosen.id
`;

/**
 * sp3n/rybbit fork: claim a trusted caller's event id, so a redelivered event
 * is recorded once (services/tracker/eventDedupe.ts).
 *
 * KEYS[1] dedupe key for one (site, event id)
 * ARGV[1] how long a claim stays pending, milliseconds
 *
 * A claim is "pending" while one delivery records the event, and "done" once
 * the event is stored. A pending claim expires on its own, so a delivery that
 * died mid-way does not block the retry for long.
 *
 * Returns "claimed" (this delivery records the event), "pending" (another
 * delivery is recording it now) or "done" (already recorded).
 */
export const CLAIM_EVENT_ID_LUA = `
if redis.call('SET', KEYS[1], 'pending', 'NX', 'PX', tonumber(ARGV[1])) then
  return 'claimed'
end
local state = redis.call('GET', KEYS[1])
if state == 'done' then
  return 'done'
end
return 'pending'
`;
