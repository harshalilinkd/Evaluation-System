"use client";

/** The topbar bell: a real feed, polled, with a sound when something arrives. */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Bell, BellOff, Check, Volume2, VolumeX } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
} from "@/lib/notify/inapp-actions";
import type { AppNotification, NotificationFeed } from "@/lib/notify/inapp";
import { formatDate } from "@/lib/utils/date";
import { cn } from "@/lib/utils";

/* ---------- The sound ---------- */

const SOUND_KEY = "appraise.notification-sound";

/**
 * A two-note chime, synthesised rather than shipped.
 *
 * No audio file, for two reasons. §2 pins the dependency list and §17 forbids
 * adding to it — but more to the point, a binary in `public/` is a request on
 * every page load for something most sessions never play, and the one thing it
 * buys (a richer timbre) is not what a notification needs. The Web Audio API is
 * in the browser already.
 *
 * Deliberately quiet and short: a rising major sixth at 0.06 gain over 260ms.
 * This fires while somebody is mid-sentence in a salary interview, so it has to
 * read as a tap on the shoulder rather than an alarm. DESIGN.md §5 says motion
 * confirms and never performs; the same restraint applies with the volume.
 */
let audioContext: AudioContext | null = null;

function unlockAudio() {
  // Browsers refuse to start an AudioContext without a user gesture, and a
  // notification arrives without one. So the context is created on the first
  // interaction of the session and stays open — by the time anything needs to
  // play, it is already unlocked.
  if (audioContext) {
    if (audioContext.state === "suspended") void audioContext.resume();
    return;
  }
  try {
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor) audioContext = new Ctor();
  } catch {
    // No audio in this browser or context. The badge still works — sound is the
    // second signal, never the only one (§13.8).
  }
}

function playChime() {
  if (!audioContext || audioContext.state !== "running") return;
  try {
    const now = audioContext.currentTime;
    for (const [index, frequency] of [587.33, 987.77].entries()) {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const at = now + index * 0.1;

      osc.type = "sine";
      osc.frequency.value = frequency;

      // An envelope, not a square-edged burst: an oscillator switched on and off
      // clicks at both ends, and the click is the part that sounds cheap.
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.06, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.26);

      osc.connect(gain).connect(audioContext.destination);
      osc.start(at);
      osc.stop(at + 0.28);
    }
  } catch {
    // Never let a chime break a page.
  }
}

/* ---------- The mute setting ---------- */

/**
 * Read through `useSyncExternalStore`, which is this codebase's settled way of
 * reading browser state (UI2-11, PC-7, F4-5). The value lives in localStorage;
 * copying it into component state would give the trigger and the menu item each
 * their own stale version of something one source owns.
 */
const soundStore = {
  listeners: new Set<() => void>(),
  subscribe(listener: () => void) {
    soundStore.listeners.add(listener);
    window.addEventListener("storage", listener);
    return () => {
      soundStore.listeners.delete(listener);
      window.removeEventListener("storage", listener);
    };
  },
  getSnapshot(): boolean {
    try {
      // On by default — the owner asked for sound, so silence is the opt-in.
      return window.localStorage.getItem(SOUND_KEY) !== "off";
    } catch {
      return true;
    }
  },
  // SSR and first paint agree, so there is no hydration mismatch on the icon.
  getServerSnapshot(): boolean {
    return true;
  },
  set(on: boolean) {
    try {
      window.localStorage.setItem(SOUND_KEY, on ? "on" : "off");
    } catch {
      /* Storage can throw — a private window, a full quota. Not worth a crash. */
    }
    for (const listener of soundStore.listeners) listener();
  },
};

/* ---------- Relative time ---------- */

/**
 * §0.10 fixes DD-MM-YYYY, and that is what anything older than a day gets. A
 * feed is the one place a relative reading is genuinely clearer: "2h ago" is
 * what somebody wants from a bell, and the date is what they want from a list.
 */
function ago(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return formatDate(iso);
}

/* ---------- The bell ---------- */

const POLL_MS = 45_000;

export function NotificationBell({ initial }: { initial: NotificationFeed }) {
  // Seeded from the server, not fetched on mount. Two things follow: the badge
  // is correct in the first frame rather than popping in, and there is no
  // `setState` in an effect body — the React compiler rule this codebase has
  // tripped over repeatedly (PC-4, P8-9, UI2-11, F4-5).
  const [items, setItems] = useState<AppNotification[]>(initial.items);
  const [unread, setUnread] = useState(initial.unread);
  const [open, setOpen] = useState(false);

  const soundOn = useSyncExternalStore(
    soundStore.subscribe,
    soundStore.getSnapshot,
    soundStore.getServerSnapshot,
  );

  // What we have already seen. A ref rather than state: `refresh` is what the
  // interval and the focus listener are keyed on, so putting this in its
  // dependency list would tear both down and restart the interval on every
  // poll — the same trap F3-3 records on the autosave flush.
  //
  // Seeded with the server's ids so the first poll cannot chime for something
  // that was already on screen when the page loaded.
  const seen = useRef<Set<string>>(new Set(initial.items.map((n) => n.id)));

  const refresh = useCallback(async () => {
    const result = await fetchNotifications();
    if (!result.ok) return;

    const { items: next, unread: nextUnread } = result.data;

    // NEW since the last poll, not "unread". Somebody who leaves a notification
    // unread must not be chimed at every 45 seconds for the rest of the day —
    // which is how a sound stops being a signal and starts being a reason to
    // mute the tab.
    const previous = seen.current;
    const arrived = next.some((n) => !previous.has(n.id) && n.readAt === null);
    // Asked of the store, not of a ref mirroring `soundOn` — a ref assigned
    // during render is rejected outright (F6-3), and mirroring is the wrong
    // shape anyway: the setting lives in localStorage and a copy of it is a
    // second version of something one source owns (UI2-11).
    if (arrived && soundStore.getSnapshot()) playChime();
    seen.current = new Set(next.map((n) => n.id));

    setItems(next);
    setUnread(nextUnread);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      // Nothing polls a hidden tab. A background tab that keeps asking is a
      // request every 45 seconds per open window, for a badge nobody is looking
      // at — and the focus handler below catches it up the moment they return.
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  // Unlock audio on the first interaction anywhere on the page — see unlockAudio.
  useEffect(() => {
    const once = () => unlockAudio();
    document.addEventListener("pointerdown", once, { once: true });
    document.addEventListener("keydown", once, { once: true });
    return () => {
      document.removeEventListener("pointerdown", once);
      document.removeEventListener("keydown", once);
    };
  }, []);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) return;

    unlockAudio();

    // Opening the bell IS reading it. Marking on open rather than on click-through
    // is what stops a badge that never clears: most notifications are read by
    // seeing them, and the ones worth opening are opened from here anyway.
    const unreadIds = items.filter((n) => n.readAt === null).map((n) => n.id);
    if (unreadIds.length === 0) return;

    const stamp = new Date().toISOString();
    setItems((current) => current.map((n) => (n.readAt ? n : { ...n, readAt: stamp })));
    setUnread(0);
    void markNotificationsRead(unreadIds);
  };

  const onMarkAll = async () => {
    const stamp = new Date().toISOString();
    setItems((current) => current.map((n) => (n.readAt ? n : { ...n, readAt: stamp })));
    setUnread(0);
    await markAllNotificationsRead();
  };

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative min-h-11 rounded-input"
          /* The count is IN the name, not only in the badge. A screen reader
             announcing "Notifications" on a bell with four waiting is announcing
             half the control (§13.8). */
          aria-label={
            unread === 0
              ? "Notifications"
              : `Notifications, ${unread} unread`
          }
        >
          <Bell className="size-5" aria-hidden />
          {unread > 0 ? (
            <span
              aria-hidden
              className={cn(
                "absolute -right-0.5 -top-0.5 flex min-w-[1.15rem] items-center justify-center",
                "rounded-pill bg-primary px-1 py-0.5 text-body-xs font-semibold leading-none",
                "tabular text-primary-foreground ring-2 ring-background",
              )}
            >
              {/* Past two digits the number stops being a count and becomes a
                  shape. Nobody acts differently on 47 than on 9+. */}
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between gap-2 border-b border-hairline px-4 py-3">
          <p className="font-sans text-body font-semibold text-ink">Notifications</p>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-input"
              aria-label={soundOn ? "Turn notification sound off" : "Turn notification sound on"}
              aria-pressed={soundOn}
              onClick={(event) => {
                // The menu must not close: this is a setting on the panel, and
                // a click that dismisses the thing it configures reads as a bug.
                event.preventDefault();
                const next = !soundOn;
                soundStore.set(next);
                if (next) {
                  unlockAudio();
                  playChime(); // Confirm it audibly — that IS the setting.
                }
              }}
            >
              {soundOn ? (
                <Volume2 className="size-4" aria-hidden />
              ) : (
                <VolumeX className="size-4" aria-hidden />
              )}
            </Button>

            {items.some((n) => n.readAt === null) ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 rounded-input px-2"
                onClick={(event) => {
                  event.preventDefault();
                  void onMarkAll();
                }}
              >
                <Check className="mr-1 size-3.5" aria-hidden />
                Mark read
              </Button>
            ) : null}
          </div>
        </div>

        <div className="max-h-[min(24rem,60vh)] overflow-y-auto">
          {items.length === 0 ? (
            /* §13.4: every list has an empty state, and it says what will
               eventually appear rather than only that nothing has. */
            <div className="px-4 py-8 text-center">
              <BellOff className="mx-auto mb-2 size-5 text-ink-muted" aria-hidden />
              <p className="font-sans text-body-sm text-ink-muted">
                Nothing yet. You will be told here when a form opens for you, when one is
                returned, and when a result is ready.
              </p>
            </div>
          ) : (
            <ul>
              {items.map((n) => {
                const inner = (
                  <>
                    <div className="flex items-start gap-2">
                      {/* Unread carries a dot AND the title's weight — never
                          colour alone (§13.8). */}
                      <span
                        aria-hidden
                        className={cn(
                          "mt-1.5 size-2 shrink-0 rounded-pill",
                          n.readAt === null ? "bg-primary" : "bg-transparent",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "font-sans text-body-sm text-ink",
                            n.readAt === null && "font-semibold",
                          )}
                        >
                          {n.title}
                          {n.readAt === null ? <span className="sr-only"> (unread)</span> : null}
                        </p>
                        <p className="mt-0.5 font-sans text-body-sm text-ink-muted">{n.body}</p>
                        <p className="mt-1 font-sans text-caption text-ink-muted">
                          {ago(n.createdAt)}
                        </p>
                      </div>
                    </div>
                  </>
                );

                return (
                  <li key={n.id} className="border-b border-hairline last:border-b-0">
                    {n.href ? (
                      <Link
                        href={n.href}
                        onClick={() => setOpen(false)}
                        className="block px-4 py-3 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                      >
                        {inner}
                      </Link>
                    ) : (
                      <div className="px-4 py-3">{inner}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
