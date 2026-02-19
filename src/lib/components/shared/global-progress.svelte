<script lang="ts">
  interface GlobalProgressProps {
    percentage: number;    // 0-100
    size?: number;         // Diameter in px, default: 28
    strokeWidth?: number;  // Circle stroke width in px, default: 3
    class?: string;        // Additional CSS classes
  }

  let {
    percentage,
    size = 28,
    strokeWidth = 3,
    class: className = '',
  }: GlobalProgressProps = $props();

  const radius = $derived((size - strokeWidth) / 2);
  const circumference = $derived(2 * Math.PI * radius);
  const dashOffset = $derived(circumference - (Math.min(Math.max(percentage, 0), 100) / 100) * circumference);
  const center = $derived(size / 2);
  const fontSize = $derived(Math.max(8, Math.round(size * 0.3)));
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 {size} {size}"
  class="shrink-0 {className}"
>
  <!-- Background track -->
  <circle
    cx={center}
    cy={center}
    r={radius}
    fill="none"
    stroke="currentColor"
    stroke-width={strokeWidth}
    class="text-muted"
  ></circle>

  <!-- Filled arc -->
  <circle
    cx={center}
    cy={center}
    r={radius}
    fill="none"
    stroke="currentColor"
    stroke-width={strokeWidth}
    stroke-dasharray={circumference}
    stroke-dashoffset={dashOffset}
    stroke-linecap="round"
    class="text-primary transition-[stroke-dashoffset] duration-300"
    transform="rotate(-90 {center} {center})"
  ></circle>

  <!-- Percentage text -->
  <text
    x={center}
    y={center}
    text-anchor="middle"
    dominant-baseline="central"
    font-size={fontSize}
    fill="currentColor"
    class="font-medium"
  >
    {Math.round(percentage)}%
  </text>
</svg>
