import { useEffect, useRef } from "react";

interface Star {
  x: number;
  y: number;
  r: number;
  base: number;
  /** How strongly it twinkles; "blinkers" fade almost out and back. */
  amp: number;
  speed: number;
  phase: number;
  /** Bright stars get a small four-point sparkle at their peak. */
  sparkle: boolean;
}

interface ShootingStar {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

const SHOOTING_STAR_EVERY_MS = 9000;

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/**
 * The space behind the app, on one canvas: twinkling stars (some blinking, a few with a sparkle), and now and
 * then a shooting star. Flat colours only.
 */
export function Starfield() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let stars: Star[] = [];
    let shooting: ShootingStar | null = null;
    let frame = 0;
    let last = performance.now();
    let nextShootingStar = performance.now() + 3000;

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const count = Math.round((width * height) / 3800);
      stars = Array.from({ length: count }, () => {
        const bright = Math.random() > 0.93;
        const blinker = Math.random() > 0.65;
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          r: bright ? rand(0.9, 1.6) : rand(0.3, 0.9),
          base: bright ? rand(0.55, 0.85) : rand(0.18, 0.55),
          amp: blinker ? rand(0.35, 0.55) : rand(0.08, 0.2),
          speed: blinker ? rand(0.0015, 0.004) : rand(0.0004, 0.0012),
          phase: Math.random() * Math.PI * 2,
          sparkle: bright && Math.random() > 0.4,
        };
      });
    };

    const drawStars = (time: number) => {
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#ffffff";
      for (const star of stars) {
        const wave = still ? 0 : Math.sin(time * star.speed + star.phase);
        const alpha = Math.min(1, Math.max(0.03, star.base + wave * star.amp));
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fill();
        // A small four-point sparkle at the brightest moment.
        if (star.sparkle && wave > 0.6) {
          const reach = star.r * 3.5 * (wave - 0.6) * 2.5;
          ctx.globalAlpha = alpha * 0.7;
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(star.x - reach, star.y);
          ctx.lineTo(star.x + reach, star.y);
          ctx.moveTo(star.x, star.y - reach);
          ctx.lineTo(star.x, star.y + reach);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    };

    /** A short bright streak with a fading tail, drawn as segments of falling opacity. */
    const drawShootingStar = (s: ShootingStar) => {
      const segments = 14;
      const length = 0.11;
      ctx.lineCap = "round";
      ctx.strokeStyle = "#ffffff";
      for (let i = 0; i < segments; i++) {
        const t0 = (i / segments) * length;
        const t1 = ((i + 1) / segments) * length;
        ctx.globalAlpha = (1 - i / segments) * Math.min(1, s.life * 2);
        ctx.lineWidth = 1.6 * (1 - i / segments);
        ctx.beginPath();
        ctx.moveTo(s.x - s.vx * t0, s.y - s.vy * t0);
        ctx.lineTo(s.x - s.vx * t1, s.y - s.vy * t1);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    const tick = (time: number) => {
      const dt = Math.min(0.05, (time - last) / 1000);
      last = time;
      ctx.clearRect(0, 0, width, height);
      drawStars(time);

      if (!shooting && time > nextShootingStar) {
        shooting = { x: rand(width * 0.2, width), y: rand(0, height * 0.35), vx: -rand(700, 1000), vy: rand(250, 420), life: 1 };
      }
      if (shooting) {
        shooting.x += shooting.vx * dt;
        shooting.y += shooting.vy * dt;
        shooting.life -= dt * 1.4;
        drawShootingStar(shooting);
        if (shooting.life <= 0) {
          shooting = null;
          nextShootingStar = time + rand(SHOOTING_STAR_EVERY_MS * 0.7, SHOOTING_STAR_EVERY_MS * 1.5);
        }
      }

      frame = requestAnimationFrame(tick);
    };

    resize();
    window.addEventListener("resize", resize);
    if (still) drawStars(0);
    else frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={ref} className="starfield" aria-hidden="true" />;
}
