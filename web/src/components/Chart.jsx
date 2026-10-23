import { useEffect, useRef, useState } from 'preact/hooks';
import { Chart } from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';

Chart.register(annotationPlugin);

// A holiday pack can set the charts' text and grid colours (--chart-text and
// --chart-grid on <html>); otherwise Chart.js's own greys.
function applyChartColors() {
  const css = getComputedStyle(document.documentElement);
  Chart.defaults.color = css.getPropertyValue('--chart-text').trim() || '#666';
  Chart.defaults.borderColor = css.getPropertyValue('--chart-grid').trim() || 'rgba(0,0,0,0.1)';
}

// A chart box under this height (a theme's chart window on a phone, ~75 px) shows only the lines
// and the side numbers: the legend and the time labels took half of it (user 2026-10-07).
// Enlarged, the box is taller and they come back.
const COMPACT_BELOW_PX = 120;

// The chart's options with the legend and the time labels off (a copy: Chart.js rebuilds its
// options from the object it is given, so changing them in place was lost on update).
function compactOptions(options = {}, compact) {
  if (!compact) return options;
  return {
    ...options,
    plugins: { ...options.plugins, legend: { ...options.plugins?.legend, display: false } },
    scales: options.scales?.x
      ? {
          ...options.scales,
          x: { ...options.scales.x, ticks: { ...options.scales.x.ticks, display: false } },
        }
      : options.scales,
  };
}

export function ChartComponent({ data, className, chartClassName, style }) {
  const [chart, setChart] = useState(null);
  const [compact, setCompact] = useState(false);
  const ref = useRef();

  // The box's own size (not as a theme draws it scaled), small or not.
  useEffect(() => {
    const box = ref.current?.parentNode;
    if (!box || typeof ResizeObserver === 'undefined') return undefined;
    const check = () => setCompact(box.clientHeight > 0 && box.clientHeight < COMPACT_BELOW_PX);
    const ro = new ResizeObserver(check);
    ro.observe(box);
    check();
    return () => ro.disconnect();
  }, []);

  // Create chart on mount
  useEffect(() => {
    if (!ref.current) return;

    applyChartColors();
    const newChart = new Chart(ref.current, data);
    setChart(newChart);

    // Cleanup function to destroy chart on unmount
    return () => {
      if (newChart) {
        newChart.destroy();
      }
    };
  }, []); // Empty dependency array - only run on mount

  // Update chart data when history changes
  useEffect(() => {
    if (!chart) return;

    // Preserve dataset visibility state when updating data
    const hiddenDatasets = chart.data.datasets.map((dataset, index) => {
      return chart.getDatasetMeta(index).hidden;
    });

    chart.data = data.data;
    chart.options = compactOptions(data.options, compact);

    // Restore dataset visibility state
    chart.data.datasets.forEach((dataset, index) => {
      if (hiddenDatasets[index] !== undefined) {
        chart.getDatasetMeta(index).hidden = hiddenDatasets[index];
      }
    });

    applyChartColors();
    chart.update();
  }, [data, chart, compact]);

  // Add resize event listener to update chart options dynamically
  useEffect(() => {
    if (!chart) return;

    // Generic "get or create" helper for nested option objects.
    const ensure = (obj, key, def) => {
      if (!obj[key]) obj[key] = def;
      return obj[key];
    };

    // Walk a path (array of keys) under chart.options creating objects.
    // Guarantees a font object exists so we can safely assign size.
    const ensureFont = path => {
      const target = path.reduce((acc, key) => ensure(acc, key, {}), chart.options);
      if (!target.font) target.font = {}; // for scale tick objects that may embed font deeper
      return target;
    };

    const handleResize = () => {
      const isSmallScreen = window.innerWidth < 640;

      // Update legend font size
      ensureFont(['plugins', 'legend', 'labels']).font.size = isSmallScreen ? 10 : 12;

      // Update title font size
      ensureFont(['plugins', 'title']).font.size = isSmallScreen ? 14 : 16;

      // Update axis font sizes
      ensureFont(['scales', 'y', 'ticks']).font.size = isSmallScreen ? 10 : 12;
      ensureFont(['scales', 'y1', 'ticks']).font.size = isSmallScreen ? 10 : 12;
      ensureFont(['scales', 'x', 'ticks']).font.size = isSmallScreen ? 10 : 12;

      // Update maxTicksLimit for x-axis
      const xTicks = ensureFont(['scales', 'x', 'ticks']);
      xTicks.maxTicksLimit = isSmallScreen ? 5 : 10;

      // Force chart to resize and recalculate dimensions. With the box's own size: without
      // one, Chart.js measures the box as drawn, and a theme draws the chart's box scaled
      // down (customTheme.css --cz), so it was scaled twice and filled ~80 % of the window
      // on a tablet after any resize (full screen, a phone's address bar; user 2026-10-07).
      const box = chart.canvas.parentNode;
      chart.resize(box.clientWidth || undefined, box.clientHeight || undefined);

      // Update the chart to apply changes
      chart.update('none'); // Use 'none' mode for better performance
    };

    // Add event listeners for different orientation change scenarios
    window.addEventListener('resize', handleResize);

    // iOS PWA specific: orientationchange event
    const handleOrientationChange = () => {
      // Use a small delay to ensure the orientation change is complete
      setTimeout(handleResize, 100);
    };
    window.addEventListener('orientationchange', handleOrientationChange);

    // iOS PWA specific: visualViewport change (for newer iOS versions)
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize);
    }

    // Initial call to ensure correct sizing
    handleResize();

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleOrientationChange);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleResize);
      }
    };
  }, [chart]);

  return (
    <div className={className} style={style}>
      <canvas className={chartClassName} ref={ref} />
    </div>
  );
}
