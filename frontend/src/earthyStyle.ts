import type { StyleSpecification } from "mapbox-gl";
export const earthyStyle: StyleSpecification = {
  version: 8,
  name: "Pudi Earth at Night",
  glyphs: "mapbox://fonts/mapbox/{fontstack}/{range}.pbf",
  sources: {
    streets: { type: "vector", url: "mapbox://mapbox.mapbox-streets-v8" },
  },
  layers: [
    {
      id: "ground",
      type: "background",
      paint: { "background-color": "#202820" },
    },
    {
      id: "land",
      type: "fill",
      source: "streets",
      "source-layer": "landuse",
      paint: { "fill-color": "#2F4030", "fill-opacity": 0.55 },
    },
    {
      id: "water",
      type: "fill",
      source: "streets",
      "source-layer": "water",
      paint: { "fill-color": "#253C42" },
    },
    {
      id: "roads",
      type: "line",
      source: "streets",
      "source-layer": "road",
      paint: {
        "line-color": "#AB9073",
        "line-opacity": 0.65,
        "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.4, 13, 2.2],
      },
    },
    {
      id: "places",
      type: "symbol",
      source: "streets",
      "source-layer": "place_label",
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 5, 11, 12, 15],
      },
      paint: {
        "text-color": "#F6F2E9",
        "text-halo-color": "#202820",
        "text-halo-width": 1.5,
      },
    },
  ],
};
