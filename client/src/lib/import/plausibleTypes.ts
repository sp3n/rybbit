export interface PlausibleSyntheticEvent {
  timestamp: string;
  session_id: string;
  user_id: string;
  hostname: string;
  pathname: string;
  querystring: string;
  referrer: string;
  browser: string;
  browser_version: string;
  operating_system: string;
  operating_system_version: string;
  device_type: string;
  country: string;
  region: string;
  city: string;
  type: "pageview" | "custom_event";
  event_name: string;
  props: string;
}
