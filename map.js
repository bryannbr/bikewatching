import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';

const INPUT_BLUEBIKES_CSV_URL =
  'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';

const INPUT_BLUEBIKES_TRAFFIC_CSV_URL =
  'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';

const svg = d3.select('#map').select('svg');

// Check that Mapbox GL JS is loaded
console.log('Mapbox GL JS Loaded:', mapboxgl);

mapboxgl.accessToken =
  'pk.eyJ1IjoiYnJ5YW5uYnIiLCJhIjoiY21oem5mcnZuMG9rdDJsb3E1bWZpdDRvdiJ9.7xG9VXREDO0d3nebFdTi7Q';

// global time filter value
let timeFilter = -1;

// Helper to turn minutes-since-midnight into HH:MM AM/PM
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

// ---------- helpers from 5.3 ----------

// compute arrivals/departures/totalTraffic for each station
function computeStationTraffic(stations, trips) {
  const departures = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.start_station_id,
  );

  const arrivals = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.end_station_id,
  );

  return stations.map((station) => {
    const id = station.short_name;

    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;

    return station;
  });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// filter trips that start or end within ±60 minutes of timeFilter
function filterTripsByTime(trips, timeFilter) {
  if (timeFilter === -1) return trips;

  return trips.filter((trip) => {
    const startedMinutes = minutesSinceMidnight(trip.started_at);
    const endedMinutes = minutesSinceMidnight(trip.ended_at);

    return (
      Math.abs(startedMinutes - timeFilter) <= 60 ||
      Math.abs(endedMinutes - timeFilter) <= 60
    );
  });
}

// ---------- 6.1: quantize scale for flow ----------

const stationFlow = d3
  .scaleQuantize()
  .domain([0, 1])
  .range([0, 0.5, 1]);

// ---- main map functionality -----

map.on('load', async () => {
  // bike lanes
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addLayer({
    id: 'bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: {
      'line-color': 'green',
      'line-width': 4,
      'line-opacity': 0.5,
    },
  });

  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://data.cambridgema.gov/resource/82yq-6ksz.geojson',
  });

  map.addLayer({
    id: 'cambridge-lanes',
    type: 'line',
    source: 'cambridge_route',
    paint: {
      'line-color': 'green',
      'line-width': 4,
      'line-opacity': 0.5,
    },
  });

  // ---- load stations JSON ----
  let jsonData;
  try {
    jsonData = await d3.json(INPUT_BLUEBIKES_CSV_URL);
    console.log('Loaded JSON Data:', jsonData);
  } catch (error) {
    console.error('Error loading JSON:', error);
    return;
  }

  let stations = jsonData.data.stations;

  // ---- load trips CSV & parse dates ----
  let trips = [];
  try {
    trips = await d3.csv(INPUT_BLUEBIKES_TRAFFIC_CSV_URL, (trip) => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);
      return trip;
    });
    console.log('Loaded trips data:', trips);
  } catch (error) {
    console.error('Error loading trips CSV:', error);
    return;
  }

  // initial traffic using ALL trips
  stations = computeStationTraffic(stations, trips);
  console.log('Stations with traffic stats:', stations);

  // radius scale
  const radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, (d) => d.totalTraffic)])
    .range([0, 25]);

  // draw circles with tooltips
  let circles = svg
    .selectAll('circle')
    .data(stations, (d) => d.short_name)
    .enter()
    .append('circle')
    .attr('r', (d) => radiusScale(d.totalTraffic))
    // NOTE: no .attr('fill', ...) so CSS can control color
    .attr('stroke', 'white')
    .attr('stroke-width', 1)
    .attr('opacity', 0.8)
    // set CSS variable for departure ratio (6.1)
    .style('--departure-ratio', (d) => {
      const ratio = d.totalTraffic === 0 ? 0 : d.departures / d.totalTraffic;
      return stationFlow(ratio);
    })
    .each(function (d) {
      d3.select(this)
        .append('title')
        .text(
          `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
        );
    });

  function updatePositions() {
    circles
      .attr('cx', (d) => getCoords(d).cx)
      .attr('cy', (d) => getCoords(d).cy);
  }

  updatePositions();
  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  // ------- slider & labels (5.2) -------
  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  if (!timeSlider || !selectedTime || !anyTimeLabel) {
    console.error('Time slider or labels not found in the DOM');
    return;
  }

  // ------- update scatterplot (5.3 + 6.1) -------
  function updateScatterPlot(currentFilter) {
    // 1. Filter trips
    const filteredTrips = filterTripsByTime(trips, currentFilter);

    // 2. Recompute station traffic based on filtered trips
    const filteredStations = computeStationTraffic(
      jsonData.data.stations.map((d) => ({ ...d })), // fresh copy
      filteredTrips,
    );

    // 3. Update radius scale domain & range
    const maxTraffic = d3.max(filteredStations, (d) => d.totalTraffic) || 0;
    radiusScale.domain([0, maxTraffic]);

    if (currentFilter === -1) {
      radiusScale.range([0, 25]);
    } else {
      radiusScale.range([3, 50]);
    }

    // 4. Bind data + update radii + update color ratio
    circles = circles
      .data(filteredStations, (d) => d.short_name)
      .join('circle')
      .attr('r', (d) => radiusScale(d.totalTraffic))
      .attr('stroke', 'white')
      .attr('stroke-width', 1)
      .attr('opacity', 0.8)
      .style('--departure-ratio', (d) => {
        const ratio = d.totalTraffic === 0 ? 0 : d.departures / d.totalTraffic;
        return stationFlow(ratio);
      });

    // make sure new/updated circles are positioned correctly
    updatePositions();
  }

  function updateTimeDisplay() {
    timeFilter = Number(timeSlider.value);
    console.log('Slider moved, timeFilter =', timeFilter);

    if (timeFilter === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = 'none';
    }

    updateScatterPlot(timeFilter);
  }

  // react to slider movement
  timeSlider.addEventListener('input', updateTimeDisplay);
  timeSlider.addEventListener('change', updateTimeDisplay);

  // initial state
  updateTimeDisplay();
});
