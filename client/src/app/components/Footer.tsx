import { useWhiteLabel } from "../../hooks/useIsWhiteLabel";

export function Footer() {
  const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION;
  const { isWhiteLabel } = useWhiteLabel();

  if (isWhiteLabel) {
    return null;
  }

  return (
    <footer className="border-t border-neutral-200 dark:border-neutral-850 bg-neutral-50 dark:bg-neutral-900">
      <div className="max-w-[1100px] mx-auto px-4 py-6">
        <div className="flex items-center gap-4 text-sm text-neutral-500 dark:text-neutral-400">
          <span>(c) {new Date().getFullYear()} Rybbit. All rights reserved.</span>
          <span>v{APP_VERSION}</span>
        </div>
      </div>
    </footer>
  );
}
