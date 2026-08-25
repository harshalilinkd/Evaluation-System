"use client";

/** The animated 3D field behind the sign-in card. Decoration only — never content. */

import * as React from "react";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";

/**
 * WHY CSS 3D AND NOT WEBGL.
 *
 * The ask was "3D moving components", and the obvious reach is three.js. It is
 * the wrong tool for THIS screen twice over: §2 pins the dependency list and
 * §17 forbids adding to it, and a WebGL runtime is roughly half a megabyte on
 * the one page every employee loads before they have any session at all —
 * most of them on a phone, on mobile data, in a factory. Everything below is a
 * genuine transform in a perspective space, at no added weight.
 *
 * WHAT THE FIRST VERSION GOT WRONG, since it is the reason for this one.
 * It floated six large glass rectangles across the viewport. They read as
 * scattered grey boxes rather than as depth — reported as gaudy, and fairly:
 * an object only reads as distant if it is FAINTER and SLOWER than the thing in
 * front of it, and those were neither. It also washed the whole viewport in a
 * flat lavender tint, which is the opposite of atmosphere; light has to fall
 * somewhere for anything to look lit.
 *
 * So: no rectangles. A slow orbital system of hairline rings behind the card —
 * geometry the eye reads as structure rather than as clutter — over a single
 * focused pool of light. The rings are the only things that move much, the card
 * sits at the bright centre, and everything else is a whisper.
 *
 * DECORATION, AND IT SAYS SO. `aria-hidden` and `pointer-events-none`: it must
 * never take a tap meant for the form in front of it, and it has nothing to
 * announce.
 *
 * THE HUE IS THE BRAND ACCENT, NOT A TIER. §13.1 reserves cyan, pink and indigo
 * for Self, Lead and Final and says they are never decorative — so the choice
 * needed making rather than assuming. This uses `--accent-primary`, the colour
 * of every primary button in the product including the Sign in button below it.
 * It shares indigo's value, and that is exactly why it is safe: this page
 * renders no rating, no layer and no score, so there is no tier to mistake.
 */

/** A hairline ring, lying in 3D space. Structure, not decoration-for-its-own-sake. */
type Ring = {
  /** px. The outer rings are fainter, which is what makes them read as further. */
  size: number;
  /** How far the ring is tipped away from the camera. */
  tilt: number;
  /** Its own lean, so no two rings share a plane. */
  yaw: number;
  /** Seconds for one full turn. Long, and none a multiple of another. */
  spin: number;
  /** Counter-rotating rings read as a mechanism; co-rotating reads as a wobble. */
  reverse?: boolean;
  opacity: number;
};

const RINGS: Ring[] = [
  { size: 420, tilt: 68, yaw: 0, spin: 46, opacity: 0.95 },
  { size: 620, tilt: 74, yaw: -22, spin: 67, reverse: true, opacity: 0.75 },
  { size: 880, tilt: 78, yaw: 16, spin: 97, opacity: 0.5 },
  { size: 1180, tilt: 81, yaw: -8, spin: 131, reverse: true, opacity: 0.3 },
];

/**
 * Motes of light.
 *
 * Written out rather than generated, because `Math.random()` at render gives
 * the server one field and the browser another, and React would report the
 * mismatch as a hydration error on the login page of all places. A fixed set is
 * also art-directable: these are placed to sit AROUND the card rather than
 * across it.
 */
const MOTES: Array<{ x: number; y: number; size: number; depth: number; duration: number; delay: number }> = [
  { x: 8, y: 18, size: 3, depth: -260, duration: 19, delay: 0 },
  { x: 17, y: 62, size: 2, depth: -140, duration: 24, delay: -7 },
  { x: 26, y: 34, size: 4, depth: -380, duration: 31, delay: -3 },
  { x: 12, y: 82, size: 2, depth: -200, duration: 27, delay: -14 },
  { x: 33, y: 88, size: 3, depth: -320, duration: 22, delay: -9 },
  { x: 72, y: 14, size: 3, depth: -180, duration: 29, delay: -5 },
  { x: 84, y: 44, size: 2, depth: -280, duration: 21, delay: -17 },
  { x: 91, y: 72, size: 4, depth: -420, duration: 34, delay: -11 },
  { x: 66, y: 84, size: 2, depth: -160, duration: 26, delay: -2 },
  { x: 78, y: 28, size: 2, depth: -340, duration: 37, delay: -21 },
  { x: 45, y: 8, size: 2, depth: -240, duration: 23, delay: -13 },
  { x: 55, y: 94, size: 3, depth: -300, duration: 30, delay: -6 },
];

export function AuthBackdrop() {
  const reduced = useReducedMotion();

  /* -- POINTER PARALLAX.
        Motion values rather than React state on purpose: a mousemove handler
        calling setState re-renders the whole field on every frame of a cursor
        sweep, which is exactly the workload a phone cannot spare. These write
        straight to the transform and never touch the render path.

        Springs, not raw values, because a stage pinned rigidly to the cursor
        feels like a toy. The low stiffness and high damping give the weight
        that reads as expensive. -- */
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const springs = { stiffness: 38, damping: 24, mass: 1.3 };
  const smoothX = useSpring(pointerX, springs);
  const smoothY = useSpring(pointerY, springs);

  // Small. Past a few degrees the rings stop reading as an orbit being viewed
  // and start reading as a widget being dragged.
  const rotateY = useTransform(smoothX, [-0.5, 0.5], [6, -6]);
  const rotateX = useTransform(smoothY, [-0.5, 0.5], [-4, 4]);
  // The motes shift the other way and further — opposed parallax is what
  // separates a near layer from a far one.
  const moteX = useTransform(smoothX, [-0.5, 0.5], [26, -26]);
  const moteY = useTransform(smoothY, [-0.5, 0.5], [18, -18]);

  React.useEffect(() => {
    if (reduced) return;
    // Coarse pointers have no hover to track, and a touch that moved the field
    // would fight the scroll. The field simply drifts on its own there.
    if (!window.matchMedia("(pointer: fine)").matches) return;

    const onMove = (event: PointerEvent) => {
      pointerX.set(event.clientX / window.innerWidth - 0.5);
      pointerY.set(event.clientY / window.innerHeight - 0.5);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [pointerX, pointerY, reduced]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* ---------- Ground ---------- */}
      {/*
        A DEEP CANVAS, and it is the decision the last two attempts got wrong in
        opposite directions.

        The first was gaudy; the second, pitched almost to invisible on a
        near-white page, read as plain. Both were really the same fault:
        CONTRAST. Nothing subtle survives on white — a hairline at 12% indigo on
        a #F7F8FB ground is not restrained, it is absent, so every bit of motion
        was being spent where it could not be seen.

        So the login page gets its own ground rather than the app's. Deliberately
        not theme-mapped — this is a fixed scene, the same way `print.css` is a
        fixed scene for paper (P15-2). The white card on a deep field is also
        the highest-contrast arrangement available, which is the point: the form
        is the brightest, most solid thing on screen and everything else is
        atmosphere behind it.
      */}
      <div className="auth-canvas" />

      {/* Slow light sweeping across the field. A single very wide conic, turning
          once every couple of minutes — the beam itself is never legible as a
          shape, only as the field brightening and dimming as it passes. */}
      <div className="auth-beams" />

      {/* Three morphing fronts on long mismatched cycles, so the colour is
          always moving and never repeats within a sitting. */}
      <div className="auth-aurora auth-aurora-a" />
      <div className="auth-aurora auth-aurora-b" />
      <div className="auth-aurora auth-aurora-c" />

      {/* The pool of light the card sits in, so the middle of the screen is
          lifted out of the deep ground. */}
      <div className="auth-spot" />

      {/* ---------- The orbital system ---------- */}
      {/*
        `perspective` on the parent and `preserve-3d` on the child is what makes
        this a real camera rather than a flat drawing of an ellipse: each ring's
        own tilt and yaw then decide how the stage's rotation moves it, so the
        parallax is correct by construction instead of six hand-tuned offsets.
      */}
      <div className="absolute inset-0 [perspective:1600px] [perspective-origin:50%_48%]">
        <motion.div
          className="absolute left-1/2 top-1/2 [transform-style:preserve-3d]"
          style={reduced ? undefined : { rotateX, rotateY }}
        >
          {RINGS.map((ring, index) => (
            <div
              key={index}
              className={ring.reverse ? "auth-ring auth-ring-reverse" : "auth-ring"}
              style={
                {
                  width: ring.size,
                  height: ring.size,
                  opacity: ring.opacity,
                  "--ring-tilt": `${ring.tilt}deg`,
                  "--ring-yaw": `${ring.yaw}deg`,
                  animationDuration: `${ring.spin}s`,
                } as React.CSSProperties
              }
            />
          ))}
        </motion.div>
      </div>

      {/* ---------- Motes ---------- */}
      <motion.div
        className="absolute inset-0"
        style={reduced ? undefined : { x: moteX, y: moteY }}
      >
        {MOTES.map((mote, index) => (
          <span
            key={index}
            className="auth-mote"
            style={
              {
                left: `${mote.x}%`,
                top: `${mote.y}%`,
                width: mote.size,
                height: mote.size,
                animationDuration: `${mote.duration}s`,
                animationDelay: `${mote.delay}s`,
              } as React.CSSProperties
            }
          />
        ))}
      </motion.div>

      {/* ---------- Structure ---------- */}
      {/* A blueprint grid, finer and fainter than a grid you are meant to
          notice, masked to an ellipse so it never reaches an edge and turns
          into a visible rectangle of lines. */}
      <div className="auth-grid" />

      {/* Reads as a lens rather than a filter: darkens the corners just enough
          that the card in the middle is the brightest thing on screen, which is
          what actually directs the eye. */}
      <div className="auth-vignette" />
    </div>
  );
}
