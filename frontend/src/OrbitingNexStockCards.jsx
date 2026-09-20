import { useEffect, useState } from "react";
import {
  Boxes,
  Package,
  Truck,
  ArrowLeftRight,
  ClipboardList,
  ChartNoAxesCombined,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
} from "lucide-react";

const DEFAULT_CARDS = [
  {
    id: "inventory",
    index: "01",
    title: "INVENTORY",
    eyebrow: "STOCK INTELLIGENCE",
    description: "See product availability, stock levels and reorder risk at a glance.",
    icon: Package,
    accent: "#58e7ff",
    action: "Inventory",
  },
  {
    id: "purchase-orders",
    index: "02",
    title: "PROCUREMENT",
    eyebrow: "PURCHASE ORDERS",
    description: "Follow incoming orders, supplier deliveries and receiving progress.",
    icon: ClipboardList,
    accent: "#a78bfa",
    action: "Purchase Orders",
  },
  {
    id: "suppliers",
    index: "03",
    title: "SUPPLIERS",
    eyebrow: "PARTNER NETWORK",
    description: "Keep supplier contacts and product relationships within reach.",
    icon: Truck,
    accent: "#5ee6b0",
    action: "Suppliers",
  },
  {
    id: "movement",
    index: "04",
    title: "STOCK FLOW",
    eyebrow: "MOVEMENT TRACKING",
    description: "Review stock-in and stock-out activity with a clear transaction trail.",
    icon: ArrowLeftRight,
    accent: "#ffbd6b",
    action: "Stock Movement",
  },
  {
    id: "analytics",
    index: "05",
    title: "ANALYTICS",
    eyebrow: "BUSINESS SIGNALS",
    description: "Turn inventory activity into useful reports and decisions.",
    icon: ChartNoAxesCombined,
    accent: "#ff7bb7",
    action: "Reports",
  },
];

function wrapIndex(index, length) {
  return ((index % length) + length) % length;
}

// Return the shortest signed distance around the circular carousel.
function shortestOffset(offset, length) {
  const half = length / 2;
  while (offset > half) offset -= length;
  while (offset < -half) offset += length;
  return offset;
}

export default function OrbitingNexStockCards({
  onNavigate = () => {},
  cards = DEFAULT_CARDS,
  autoRotate = true,
  // One card advances to the next focal position in about 14 seconds.
  rotationDuration = 14000,
}) {
  const [orbitPosition, setOrbitPosition] = useState(0);
  const [paused, setPaused] = useState(false);
  const length = cards.length;
  const activeIndex = length
    ? wrapIndex(Math.round(orbitPosition), length)
    : 0;

  useEffect(() => {
    if (!autoRotate || paused || length < 2 || rotationDuration <= 0) return undefined;

    // Rotate smoothly while running. Selecting a card pauses the orbit.
    const tickMs = 32;
    const step = length * (tickMs / rotationDuration);
    const timer = window.setInterval(() => {
      setOrbitPosition((position) => (position + step) % length);
    }, tickMs);

    return () => window.clearInterval(timer);
  }, [autoRotate, paused, length, rotationDuration]);

  if (!length) return null;

  const move = (step) => {
    // Snap to a stable position before moving so controls remain easy to use.
    setPaused(true);
    setOrbitPosition((position) => wrapIndex(Math.round(position) + step, length));
  };

  const focusCard = (index) => {
    // Stop the orbit on the selected card; this prevents it sliding away
    // between the first click (focus) and the second click (open).
    setPaused(true);
    setOrbitPosition(index);
  };

  return (
    <section className="nx-orbit-section" aria-label="NexStock quick navigation">
      <div className="nx-orbit-heading">
        <div>
          <span className="nx-orbit-kicker">NEXSTOCK / WORKSPACE MODULES</span>
          <h2>
            Navigate your inventory universe<span>.</span>
          </h2>
          {/* Removed the extra descriptive line to keep it clear of the cards. */}
        </div>
        {/* Removed the ORBITAL NAVIGATION badge. */}
      </div>

      <div className="nx-orbit-stage nx-orbit-stage-continuous">
        <div className="nx-orbit-halo" aria-hidden="true" />
        <div className="nx-orbit-floor" aria-hidden="true" />
        <div className="nx-orbit-cards" role="list">
          {cards.map((card, index) => {
            const offset = shortestOffset(index - orbitPosition, length);
            const distance = Math.abs(offset);
            const isActive = distance < 0.5;
            const Icon = card.icon || Boxes;
            const cardIndex = card.index || String(index + 1).padStart(2, "0");

            const style = {
              "--card-accent": card.accent || "#58e7ff",
              "--orbit-offset": offset,
              "--orbit-distance": distance,
              "--orbit-depth": `${distance * -88}px`,
              "--orbit-vertical": `${Math.min(160, distance * 18)}px`,
              "--orbit-scale": String(1 - Math.min(0.22, distance * 0.075)),
              // A wider orbit reduces collision as cards pass one another.
              "--orbit-spread": "clamp(205px, 22vw, 330px)",
            };

            return (
              <button
                type="button"
                role="listitem"
                key={card.id || card.title}
                className={`nx-orbit-card ${isActive ? "is-active" : ""} ${
                  distance > 2.05 ? "is-hidden" : ""
                }`}
                style={{ ...style, zIndex: String(Math.max(1, 100 - Math.round(distance * 10))) }}
                onClick={() => {
                  if (!isActive) focusCard(index);
                  else onNavigate(card.action);
                }}
                aria-label={isActive ? `Open ${card.title}` : `Focus ${card.title} card`}
                aria-current={isActive ? "true" : undefined}
                tabIndex={distance > 1.05 ? -1 : 0}
              >
                <div className="nx-orbit-card-glow" />
                <div className="nx-orbit-card-top">
                  <span className="nx-orbit-card-index">{cardIndex}</span>
                  <span className="nx-orbit-card-dot" />
                </div>

                <div className="nx-orbit-art" aria-hidden="true">
                  <div className="nx-orbit-art-ring ring-one" />
                  <div className="nx-orbit-art-ring ring-two" />
                  <div className="nx-orbit-art-core">
                    <Icon size={39} strokeWidth={1.45} />
                  </div>
                  <div className="nx-orbit-art-grid" />
                </div>

                <div className="nx-orbit-card-copy">
                  <span className="nx-orbit-card-eyebrow">{card.eyebrow}</span>
                  <strong>{card.title}</strong>
                  <p>{card.description}</p>
                </div>

                <div className="nx-orbit-card-bottom">
                  <span>
                    <i /> MODULE {cardIndex}
                  </span>
                  <span className="nx-orbit-open">
                    <ArrowUpRight size={17} />
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className="nx-orbit-control nx-orbit-prev"
          onClick={() => move(-1)}
          aria-label="Previous card"
        >
          <ChevronLeft size={20} />
        </button>
        <button
          type="button"
          className="nx-orbit-control nx-orbit-next"
          onClick={() => move(1)}
          aria-label="Next card"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      <div className="nx-orbit-footer">
        <button
          type="button"
          className="nx-orbit-resume"
          onClick={() => setPaused((value) => !value)}
          aria-pressed={!paused}
          title={paused ? "Resume automatic rotation" : "Pause automatic rotation"}
        >
          {paused ? "RESUME ORBIT" : "PAUSE ORBIT"}
        </button>
        <div className="nx-orbit-dots" aria-label="Choose a module">
          {cards.map((card, index) => (
            <button
              key={card.id || card.title}
              type="button"
              className={index === activeIndex ? "active" : ""}
              onClick={() => focusCard(index)}
              aria-label={`Show ${card.title}`}
              aria-pressed={index === activeIndex}
            />
          ))}
        </div>
        {/* Removed the instructional footer text. */}
      </div>
    </section>
  );
}
