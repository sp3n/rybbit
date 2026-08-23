import { SiEpicgames, SiSteam, SiSteamdeck } from "@icons-pack/react-simple-icons";
import { Gamepad2, Monitor, Tablet, Wrench } from "lucide-react";
import { ComponentType, type MouseEvent } from "react";
import { OperatingSystem } from "@/app/[site]/components/shared/icons/OperatingSystem";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type GameFormFactor = "console" | "desktop" | "handheld" | "editor" | "unknown";

export type GamePlatformInfo = {
  code: string;
  label: string;
  shortLabel: string;
  family: string;
  model?: string;
  storefront?: string;
  formFactor: GameFormFactor;
};

const PLATFORM_INFO: Record<string, Omit<GamePlatformInfo, "code">> = {
  PS5: { label: "PlayStation 5", shortLabel: "PS5", family: "PlayStation", model: "PS5", formFactor: "console" },
  PS5Pro: {
    label: "PlayStation 5 Pro",
    shortLabel: "PS5 Pro",
    family: "PlayStation",
    model: "PS5 Pro",
    formFactor: "console",
  },
  PS5Eco: {
    label: "PlayStation 5 Eco",
    shortLabel: "PS5 Eco",
    family: "PlayStation",
    model: "PS5 Eco",
    formFactor: "console",
  },
  XSX: { label: "Xbox Series X", shortLabel: "Series X", family: "Xbox", model: "Series X", formFactor: "console" },
  XSS: { label: "Xbox Series S", shortLabel: "Series S", family: "Xbox", model: "Series S", formFactor: "console" },
  XboxPC: {
    label: "Xbox for PC · Desktop",
    shortLabel: "Xbox PC",
    family: "Xbox for PC",
    model: "Windows PC",
    storefront: "Microsoft Game Store",
    formFactor: "desktop",
  },
  XboxPCh: {
    label: "Xbox for PC · Handheld",
    shortLabel: "Xbox handheld",
    family: "Xbox for PC",
    model: "Windows handheld",
    storefront: "Microsoft Game Store",
    formFactor: "handheld",
  },
  Steam: { label: "Steam · PC", shortLabel: "Steam", family: "Windows", storefront: "Steam", formFactor: "desktop" },
  SteamDeck: {
    label: "Steam Deck",
    shortLabel: "Steam Deck",
    family: "Linux",
    model: "Steam Deck",
    storefront: "Steam",
    formFactor: "handheld",
  },
  EGS: { label: "Epic Games · PC", shortLabel: "Epic", family: "Windows", storefront: "Epic", formFactor: "desktop" },
  Editor: { label: "Game Editor", shortLabel: "Editor", family: "Development", formFactor: "editor" },
};

export function getGamePlatformInfo(code?: string): GamePlatformInfo {
  const normalizedCode = code?.trim() || "Unknown";
  return {
    code: normalizedCode,
    ...(PLATFORM_INFO[normalizedCode] ?? {
      label: normalizedCode,
      shortLabel: normalizedCode,
      family: "Unknown",
      formFactor: "unknown" as const,
    }),
  };
}

function BrandIcon({ icon: Icon, size }: { icon: ComponentType<{ size?: number }>; size: number }) {
  return <Icon size={size} />;
}

export function GamePlatformIcon({ code, size = 16 }: { code?: string; size?: number }) {
  switch (code) {
    case "Steam":
      return <BrandIcon icon={SiSteam} size={size} />;
    case "SteamDeck":
      return <BrandIcon icon={SiSteamdeck} size={size} />;
    case "EGS":
      return <BrandIcon icon={SiEpicgames} size={size} />;
    case "PS5":
    case "PS5Pro":
    case "PS5Eco":
      return <OperatingSystem os="PlayStation" size={size} />;
    case "XSX":
    case "XSS":
      return <OperatingSystem os="Xbox" size={size} />;
    case "XboxPC":
    case "XboxPCh":
      return <OperatingSystem os="Windows" size={size} />;
    case "Editor":
      return <Wrench width={size} height={size} />;
    default:
      return <Gamepad2 width={size} height={size} />;
  }
}

export function GameFormFactorIcon({ formFactor, size = 16 }: { formFactor: GameFormFactor; size?: number }) {
  if (formFactor === "desktop") return <Monitor width={size} height={size} />;
  if (formFactor === "handheld") return <Tablet width={size} height={size} />;
  if (formFactor === "editor") return <Wrench width={size} height={size} />;
  return <Gamepad2 width={size} height={size} />;
}

export function GamePlatformBadge({ code, onClick }: { code?: string; onClick?: (event: MouseEvent) => void }) {
  const platform = getGamePlatformInfo(code);
  const details = [platform.family, platform.model, platform.storefront, platform.formFactor]
    .filter(Boolean)
    .join(" · ");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          onClick={onClick}
        >
          <GamePlatformIcon code={platform.code} />
          <span>{platform.shortLabel}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <div className="font-medium">{platform.label}</div>
        <div className="text-xs text-muted-foreground">{details}</div>
      </TooltipContent>
    </Tooltip>
  );
}
