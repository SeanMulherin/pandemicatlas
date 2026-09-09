"use client";

import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { atlasAssetUrl } from "./assetUrl";

interface CountyGeometry {
  state: string;
  path: string;
}

interface StateMapMetadata {
  geometry: {
    width: number;
    height: number;
    counties: CountyGeometry[];
    stateBordersPath: string;
    nationPath: string;
  };
}

export interface StateMapItem {
  name: string;
  abbr: string;
  value: number;
  displayValue: string;
}

interface StateIncidenceMapProps {
  states: StateMapItem[];
  selectedStates: string[];
  selectedDateLabel: string;
  unitLabel: string;
  maximum: number;
  isPlaying: boolean;
  onToggleState: (state: string) => void;
}

const STATE_COLORS = [
  "#edf3f3",
  "#d4e4e5",
  "#b7d2d4",
  "#91babe",
  "#669ea4",
  "#3d838b",
  "#176872",
  "#00505b",
  "#003943",
] as const;

function stateFill(value: number, maximum: number): string {
  if (!Number.isFinite(value) || value <= 0) return STATE_COLORS[0];
  const intensity = Math.sqrt(Math.min(1, value / Math.max(1, maximum)));
  const index = Math.max(
    1,
    Math.min(STATE_COLORS.length - 1, Math.ceil(intensity * (STATE_COLORS.length - 1))),
  );
  return STATE_COLORS[index];
}

function buildStatePaths(metadata: StateMapMetadata): Map<string, string> {
  const grouped = new Map<string, string[]>();
  metadata.geometry.counties.forEach((county) => {
    const paths = grouped.get(county.state) ?? [];
    paths.push(county.path);
    grouped.set(county.state, paths);
  });
  return new Map(Array.from(grouped, ([state, paths]) => [state, paths.join("")]));
}

function stateClipId(state: string): string {
  return `state-map-clip-${state.toLowerCase().replace(/[^a-z]+/g, "-")}`;
}

export default function StateIncidenceMap({
  states,
  selectedStates,
  selectedDateLabel,
  unitLabel,
  maximum,
  isPlaying,
  onToggleState,
}: StateIncidenceMapProps) {
  const [metadata, setMetadata] = useState<StateMapMetadata | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [hoveredState, setHoveredState] = useState("");
  const [focusedState, setFocusedState] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function loadMap() {
      try {
        const response = await fetch(atlasAssetUrl("data/county-incidence-map.json"), {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("The geographic state map could not be reached.");
        const nextMetadata = await response.json() as StateMapMetadata;
        const mappedStates = new Set(nextMetadata.geometry.counties.map((county) => county.state));
        if (mappedStates.size !== 51) {
          throw new Error("The geographic state map did not match the state archive.");
        }
        setMetadata(nextMetadata);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setLoadError(
          caught instanceof Error ? caught.message : "The geographic state map could not be loaded.",
        );
      }
    }

    void loadMap();
    return () => controller.abort();
  }, [loadAttempt]);

  const statePaths = useMemo(
    () => (metadata ? buildStatePaths(metadata) : new Map<string, string>()),
    [metadata],
  );
  const stateByName = useMemo(
    () => new Map(states.map((state) => [state.name, state])),
    [states],
  );
  const dailyHighState = useMemo(
    () => states.reduce<StateMapItem | undefined>(
      (highest, state) => !highest || state.value > highest.value ? state : highest,
      undefined,
    ),
    [states],
  );
  const detailState = stateByName.get(hoveredState || focusedState) ?? dailyHighState;

  function onStateKeyDown(event: ReactKeyboardEvent<SVGPathElement>, state: string) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onToggleState(state);
  }

  return (
    <div className="state-map">
      {!metadata && !loadError ? (
        <div className="state-map-status" role="status">
          <span aria-hidden="true" />
          Preparing the geographic state map…
        </div>
      ) : null}

      {loadError ? (
        <div className="state-map-status is-error" role="alert">
          <p>{loadError}</p>
          <button
            type="button"
            onClick={() => {
              setLoadError("");
              setLoadAttempt((attempt) => attempt + 1);
            }}
          >
            Try loading again
          </button>
        </div>
      ) : null}

      {metadata ? (
        <div className="state-map-frame">
          <div className="state-map-visual">
            <svg
              className="state-map-svg"
              viewBox={`0 0 ${metadata.geometry.width} ${metadata.geometry.height}`}
              role="group"
              aria-label={`Geographic U.S. state map for ${selectedDateLabel}. Darker blue indicates higher ${unitLabel}. Select up to ten states for comparison.`}
            >
              <defs>
                {states.map((state) => (
                  <clipPath key={state.name} id={stateClipId(state.name)}>
                    <path d={statePaths.get(state.name) ?? ""} />
                  </clipPath>
                ))}
              </defs>
              {states.map((state) => {
                const isSelected = selectedStates.includes(state.name);
                return (
                  <path
                    key={state.name}
                    className="state-map-shape"
                    d={statePaths.get(state.name) ?? ""}
                    fill={stateFill(state.value, maximum)}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    aria-label={`${state.name}: ${state.displayValue} ${unitLabel}. ${isSelected ? "Remove from" : "Add to"} comparison.`}
                    onClick={() => onToggleState(state.name)}
                    onKeyDown={(event) => onStateKeyDown(event, state.name)}
                    onPointerEnter={() => setHoveredState(state.name)}
                    onPointerLeave={() => setHoveredState("")}
                    onFocus={() => setFocusedState(state.name)}
                    onBlur={() => setFocusedState("")}
                  >
                    <title>{state.name}: {state.displayValue} {unitLabel}</title>
                  </path>
                );
              })}
              <path
                className="state-map-borders"
                d={metadata.geometry.stateBordersPath}
                aria-hidden="true"
              />
              <path
                className="state-map-nation"
                d={metadata.geometry.nationPath}
                aria-hidden="true"
              />
              {hoveredState || focusedState ? (
                <g
                  className="state-map-focus-outline"
                  clipPath={`url(#${stateClipId(hoveredState || focusedState)})`}
                  aria-hidden="true"
                >
                  <path d={metadata.geometry.stateBordersPath} />
                  <path d={metadata.geometry.nationPath} />
                </g>
              ) : null}
              {selectedStates.map((state) => (
                <g
                  key={state}
                  className="state-map-selected-outline"
                  clipPath={`url(#${stateClipId(state)})`}
                  aria-hidden="true"
                >
                  <path d={metadata.geometry.stateBordersPath} />
                  <path d={metadata.geometry.nationPath} />
                </g>
              ))}
            </svg>
            <div className="map-legend" aria-label="State incidence color legend">
              <span>Lower</span><i aria-hidden="true" /><span>Higher</span>
            </div>
          </div>

          <aside
            className="state-map-detail"
            aria-live={!isPlaying && focusedState && !hoveredState ? "polite" : "off"}
          >
            <span>{hoveredState ? "State under pointer" : focusedState ? "Focused state" : "Highest on this date"}</span>
            <h3>{detailState?.name ?? "No state highlighted"}</h3>
            <p>{detailState?.abbr}</p>
            <strong>{detailState?.displayValue ?? "—"}</strong>
            <small>{unitLabel}</small>
            <time>{selectedDateLabel}</time>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
