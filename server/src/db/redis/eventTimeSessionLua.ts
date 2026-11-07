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
 * ARGV[2] event time, epoch milliseconds
 * ARGV[3] inactivity gap in milliseconds (30 minutes)
 * ARGV[4] key retention in milliseconds, wall-clock
 *
 * Value: "<sessionId>|<firstEventMs>|<lastEventMs>".
 *
 * An event within the gap of the stored session's [first, last] span joins it
 * and widens the span; the span never shrinks, so a late, older event cannot
 * move `last` backwards. An event more than the gap after `last` starts a new
 * session and replaces the stored one. An event more than the gap before
 * `first` belongs to an earlier session this key no longer describes: it gets
 * a session of its own and the stored session is left as it is. A bridge that
 * delivers each identity's events in time order never hits that last case.
 *
 * Retention is long (the queue's retention, not the gap) so that a session
 * open when an outage began is still known when the backlog drains. A long
 * retention cannot merge distant events, because membership is decided by the
 * event times, not by whether the key is still alive.
 *
 * Returns the session id for this event.
 */
export const EVENT_TIME_SESSION_LUA = `
local candidate = ARGV[1]
local eventText = ARGV[2]
local eventMs = tonumber(eventText)
local gapMs = tonumber(ARGV[3])
local retentionMs = ARGV[4]

-- Times are compared as numbers but stored as the decimal text they arrived
-- in, so no number is ever formatted back (epoch milliseconds are exact as
-- doubles, but not every Lua runtime formats them as integers).
local stored = redis.call('GET', KEYS[1])
if stored then
  local id, firstText, lastText = string.match(stored, '^([^|]+)|(%d+)|(%d+)$')
  if id then
    local first = tonumber(firstText)
    local last = tonumber(lastText)
    if eventMs >= first - gapMs and eventMs <= last + gapMs then
      if eventMs < first then firstText = eventText end
      if eventMs > last then lastText = eventText end
      redis.call('SET', KEYS[1], id .. '|' .. firstText .. '|' .. lastText, 'PX', retentionMs)
      return id
    end
    if eventMs < first - gapMs then
      return candidate
    end
  end
end

redis.call('SET', KEYS[1], candidate .. '|' .. eventText .. '|' .. eventText, 'PX', retentionMs)
return candidate
`;

/**
 * sp3n/rybbit fork: claim a trusted caller's event id, so a redelivered event
 * is recorded once.
 *
 * KEYS[1] dedupe key for one (site, event id)
 * ARGV[1] retention in milliseconds
 *
 * Returns 1 when this call claimed the id (record the event), 0 when it was
 * already claimed (drop it as a duplicate).
 */
export const CLAIM_EVENT_ID_LUA = `
if redis.call('SET', KEYS[1], '1', 'NX', 'PX', tonumber(ARGV[1])) then
  return 1
end
return 0
`;
