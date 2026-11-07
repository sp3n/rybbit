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
 * ARGV[6] the caller's current time, epoch milliseconds, as integer text
 *
 * Value: "<id>|<firstMs>|<lastMs>|<usedMs>;..." - one span per session this
 * identity had recently, with when the span was last used (wall-clock).
 *
 * An event within the gap of a remembered span joins that session (the nearest
 * one, if two qualify) and widens its span; a span never shrinks, so a late,
 * older event cannot move a session's end backwards. An event near no span
 * starts a new session, which is remembered too, so delivery out of time order
 * (concurrent consumers, live traffic overtaking a backlog) still groups each
 * session's events together.
 *
 * When a widened span comes within the gap of another, they were one session
 * delivered out of order: the two are merged under the chosen id, so every
 * later event of that session gets one id. Events already stored under the
 * other id keep it; a bridge that delivers each identity in time order never
 * produces this.
 *
 * Past the limit, the span used longest ago (wall-clock) is forgotten, so a
 * replay of an older session is not forgotten the moment it starts.
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
local nowText = ARGV[6] or '0'

local spans = {}
local stored = redis.call('GET', KEYS[1])
if stored then
  for id, firstText, lastText, usedText in string.gmatch(stored, '([^|;]+)|(%d+)|(%d+)|?(%d*)') do
    if usedText == '' then usedText = '0' end
    spans[#spans + 1] = {
      id = id,
      firstText = firstText,
      lastText = lastText,
      usedText = usedText,
      first = tonumber(firstText),
      last = tonumber(lastText),
      used = tonumber(usedText),
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
chosen.usedText = nowText
chosen.used = tonumber(nowText)

-- Fold in every span the chosen one now reaches within the gap.
local merged = true
while merged do
  merged = false
  for i = #spans, 1, -1 do
    local span = spans[i]
    if span ~= chosen and span.first <= chosen.last + gapMs and span.last >= chosen.first - gapMs then
      if span.first < chosen.first then
        chosen.first = span.first
        chosen.firstText = span.firstText
      end
      if span.last > chosen.last then
        chosen.last = span.last
        chosen.lastText = span.lastText
      end
      table.remove(spans, i)
      merged = true
    end
  end
end

-- Most recently used first; forget the least recently used beyond the limit.
table.sort(spans, function(a, b)
  if a.used ~= b.used then return a.used > b.used end
  return a.last > b.last
end)
local parts = {}
for i = 1, math.min(#spans, maxSpans) do
  local span = spans[i]
  parts[#parts + 1] = span.id .. '|' .. span.firstText .. '|' .. span.lastText .. '|' .. span.usedText
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
 * ARGV[2] this delivery's claim token
 *
 * A claim is "pending:<token>" while one delivery records the event, and
 * "done" once the event is stored. A pending claim expires on its own, so a
 * delivery that died mid-way does not block the retry for long; its token lets
 * it give the claim back without ever removing another delivery's.
 *
 * Returns "claimed" (this delivery records the event), "pending" (another
 * delivery is recording it now) or "done" (already recorded).
 */
export const CLAIM_EVENT_ID_LUA = `
if redis.call('SET', KEYS[1], 'pending:' .. ARGV[2], 'NX', 'PX', tonumber(ARGV[1])) then
  return 'claimed'
end
local state = redis.call('GET', KEYS[1])
if state == 'done' then
  return 'done'
end
return 'pending'
`;

/**
 * sp3n/rybbit fork: mark a claimed event recorded, unless another delivery
 * now holds the claim (this one's lease expired and it took over).
 *
 * KEYS[1] dedupe key; ARGV[1] the claim token; ARGV[2] done retention, ms.
 * Returns 1 if marked done.
 */
export const COMPLETE_EVENT_ID_LUA = `
local state = redis.call('GET', KEYS[1])
if state == false or state == 'pending:' .. ARGV[1] then
  redis.call('SET', KEYS[1], 'done', 'PX', tonumber(ARGV[2]))
  return 1
end
return 0
`;

/**
 * sp3n/rybbit fork: give back a pending claim, only if it is still this
 * delivery's (CLAIM_EVENT_ID_LUA).
 *
 * KEYS[1] dedupe key; ARGV[1] the claim token. Returns 1 if released.
 */
export const RELEASE_EVENT_ID_LUA = `
if redis.call('GET', KEYS[1]) == 'pending:' .. ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;
