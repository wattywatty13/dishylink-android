// The phone menu (Android): a button at the top left that opens a full-height
// sheet of large rows, in place of the desktop dock, which on a phone is too small
// to tap and sits under Android's navigation buttons.
//
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "motion/react";
import { LayoutDashboard, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { AppLogo } from "../../assets/icons/AppLogo";
import type { ToolbarItem, ToolbarItemId } from "./AppToolbar";

interface ToolbarMenuProps {
  items: ToolbarItem[];
  activeId: string | null;
  onSelect: (id: ToolbarItemId) => void;
  onHome: () => void;
  navLabel: string;
}

export function ToolbarMenu({ items, activeId, onSelect, onHome, navLabel }: ToolbarMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };

  const row = (active: boolean) =>
    cn(
      "flex h-[52px] w-full cursor-pointer items-center gap-4 rounded-2xl border-0 bg-transparent px-4 text-left text-[16px] font-medium text-ink-secondary transition-colors active:bg-[color-mix(in_srgb,var(--ink)_10%,transparent)]",
      active && "bg-[color-mix(in_srgb,var(--ink)_10%,transparent)] text-foreground",
    );

  return (
    <>
      <button
        type='button'
        aria-label={navLabel}
        aria-expanded={open}
        onClick={() => setOpen(true)}

        className='fixed top-[6px] left-[8px] max-sm:top-1.5 max-sm:left-2 z-30 flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--ink)_12%,transparent)] bg-[color-mix(in_srgb,var(--surface-raised)_70%,transparent)] text-foreground backdrop-blur-md'
      >
        <Menu size={22} />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key='scrim'
              aria-hidden
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className='fixed inset-0 z-[80] bg-black/55'
            />
            <motion.nav
              key='sheet'
              aria-label={navLabel}
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 420, damping: 40 }}
              className='fixed top-0 bottom-0 left-0 z-[90] flex flex-col border-r border-[color-mix(in_srgb,var(--ink)_10%,transparent)] bg-[var(--surface-raised)] shadow-2xl'
            >
              <div className='flex w-[280px] flex-1 flex-col overflow-y-auto p-3'>
                <div className='mb-3 flex items-center justify-between px-2 pt-1'>
                  <div className='flex items-center gap-2.5'>
                    <AppLogo size={26} />
                    <span className='text-[16px] font-bold tracking-[0.14em]'>Dishylink</span>
                  </div>
                  <button
                    type='button'
                    aria-label={t("common.close")}
                    onClick={() => setOpen(false)}
                    className='flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-ink-secondary'
                  >
                    <X size={22} />
                  </button>
                </div>

                <button
                  type='button'
                  onClick={() => choose(onHome)}
                  aria-current={activeId === null ? "page" : undefined}
                  className={row(activeId === null)}
                >
                  <LayoutDashboard size={22} className='flex-none' />
                  {t("navigation.dashboard")}
                </button>
                {items.map((item) => {
                  const active = activeId === item.id;
                  return (
                    <button
                      key={item.id}
                      type='button'
                      onClick={() => choose(() => onSelect(item.id))}
                      aria-current={active ? "page" : undefined}
                      className={row(active)}
                    >
                      <item.Icon size={22} className='flex-none' />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </motion.nav>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
